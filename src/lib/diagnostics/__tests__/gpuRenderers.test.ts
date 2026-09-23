/**
 * @jest-environment jsdom
 */

/**
 * Covers the parts of the capability gate that are not pure geometry: the
 * clear-only readback control, and how `runBackend` treats a cancelled run.
 *
 * jsdom has no `createImageBitmap`, so the real `sampleCanvas` can only throw
 * here. That is used deliberately: the "control threw" branch — the one that
 * regressed — is exercised against the production sampler through the
 * production two-argument call, and the injected sampler is used only for the
 * branches that need real pixels.
 */

import {
  BenchmarkCancelledError,
  isBenchmarkCancelled,
  probeReadbackControl,
  runBackend,
  type BackendFactory,
  type BenchRenderer,
} from '../gpuRenderers';
import { BENCHMARK_RESOLUTIONS, createSphereMesh, type Mesh } from '../gpuBenchmark';

// jsdom 30 does not expose MessageChannel, which the measurement loop uses to
// yield between frames. Node's is the same primitive — a real task round trip —
// and it is infrastructure here, not the thing under test: these tests are about
// which branch `runBackend` takes when a run is cancelled.
if (typeof globalThis.MessageChannel === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  globalThis.MessageChannel = require('node:worker_threads').MessageChannel;
}

const canvas = () => document.createElement('canvas');

/** A renderer that does nothing, quickly. Each test spoils one behaviour. */
function fakeRenderer(overrides: Partial<BenchRenderer> = {}): BenchRenderer {
  return {
    resize: () => {},
    drawFrame: () => {},
    drawControlFrame: () => {},
    waitForGpuIdle: async () => {},
    drawingBufferSize: () => ({ width: 2560, height: 1440 }),
    describeAdapter: () => 'fake adapter',
    dispose: () => {},
    ...overrides,
  };
}

const sampleOf = (uniqueColors: number, flatColor: { r: number; g: number; b: number } | null) =>
  async () => ({ uniqueColors, flatColor, meanLuma: 0 });

describe('probeReadbackControl', () => {
  it('reports untested when the control could not be observed at all', async () => {
    // Through the production two-argument call, so the real `sampleCanvas`
    // runs and throws on jsdom's missing `createImageBitmap`.
    //
    // This previously returned 'broken', which is a positive claim that the
    // readback mechanism is the faulty part — and that claim is exactly what
    // converts an all-zero benchmark frame into a creditable 'unavailable'. A
    // transient throw would have licensed a renderer that drew nothing.
    await expect(probeReadbackControl(fakeRenderer(), canvas())).resolves.toBe('untested');
  });

  it('reports untested when the control drew but its clear never completed', async () => {
    // A rejected fence means the clear was never confirmed to have executed, so
    // a black read afterwards may be the submission that failed rather than the
    // readback. Not evidence of broken readback.
    const verdict = await probeReadbackControl(
      fakeRenderer({
        waitForGpuIdle: async () => {
          throw new Error('device lost');
        },
      }),
      canvas(),
      sampleOf(1, { r: 0, g: 0, b: 0 })
    );
    expect(verdict).toBe('untested');
  });

  it('reports broken only when a completed clear read back black', async () => {
    const verdict = await probeReadbackControl(
      fakeRenderer(),
      canvas(),
      sampleOf(1, { r: 0, g: 0, b: 0 })
    );
    expect(verdict).toBe('broken');
  });

  it('still reports working after a fence failure when real pixels came back', async () => {
    // The positive direction survives a broken fence: pixels arrived, so
    // readback demonstrably works whatever happened to the submission.
    const verdict = await probeReadbackControl(
      fakeRenderer({
        waitForGpuIdle: async () => {
          throw new Error('device lost');
        },
      }),
      canvas(),
      sampleOf(4, { r: 5, g: 8, b: 15 })
    );
    expect(verdict).toBe('working');
  });
});

describe('runBackend cancellation', () => {
  const mesh: Mesh = createSphereMesh(64);

  const factory = (renderer: BenchRenderer): BackendFactory => ({
    backend: 'webgl2',
    create: () => renderer,
  });

  it('propagates cancellation instead of returning a partial report', async () => {
    // The P1: swallowed into `report.error`, the caller never enters its
    // cancellation-aware catch. It runs the remaining backend and publishes a
    // "complete" decision built from a half-finished measurement — and if the
    // abort landed during 2160p, the retained 1440p run is enough to make that
    // decision look creditable.
    const controller = new AbortController();
    const renderer = fakeRenderer({
      // Abort on the first drawn frame so the run is cancelled mid-flight
      // rather than before it starts.
      drawFrame: () => controller.abort(),
    });

    const thrown = await runBackend(
      factory(renderer),
      mesh,
      BENCHMARK_RESOLUTIONS,
      () => {},
      undefined,
      controller.signal
    ).then(
      (report) => report,
      (error: unknown) => error
    );

    expect(isBenchmarkCancelled(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(BenchmarkCancelledError);
  });

  it('disposes the renderer even though the cancellation propagates', async () => {
    const controller = new AbortController();
    let disposed = false;
    const renderer = fakeRenderer({
      drawFrame: () => controller.abort(),
      dispose: () => {
        disposed = true;
      },
    });

    await expect(
      runBackend(
        factory(renderer),
        mesh,
        BENCHMARK_RESOLUTIONS,
        () => {},
        undefined,
        controller.signal
      )
    ).rejects.toBeInstanceOf(BenchmarkCancelledError);
    expect(disposed).toBe(true);
  });

  it('draws the control after each resize, so it validates the measured surface', async () => {
    // The P2: probed once per backend on the 16x9 canvas, the verdict was then
    // reused at 2560x1440 and 3840x2160. A readback path that works on a tiny
    // surface but returns zeroes after the 4K allocation would be misclassified
    // in the creditable direction — at the only size where it matters.
    const calls: string[] = [];
    const renderer = fakeRenderer({
      resize: (width: number, height: number) => calls.push(`resize:${width}x${height}`),
      drawControlFrame: () => calls.push('control'),
      drawFrame: () => {
        throw new Error('stop after the control');
      },
    });

    await runBackend(factory(renderer), mesh, BENCHMARK_RESOLUTIONS, () => {});

    // Control follows the resize, not the 16x9 canvas creation that precedes it.
    expect(calls).toEqual(['resize:2560x1440', 'control']);
  });

  it('still reports an ordinary run failure as a report rather than a throw', async () => {
    // The other side of the same branch: only cancellation propagates. A real
    // failure must still come back as a report, because "WebGL2 cleared the
    // bar" has to remain reachable when WebGPU dies.
    const renderer = fakeRenderer({
      drawFrame: () => {
        throw new Error('context lost');
      },
    });

    const report = await runBackend(factory(renderer), mesh, BENCHMARK_RESOLUTIONS, () => {});
    expect(report.available).toBe(true);
    expect(report.error).toContain('context lost');
  });
});
