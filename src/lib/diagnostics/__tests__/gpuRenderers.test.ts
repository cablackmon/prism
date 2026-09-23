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
import {
  BENCHMARK_DURATION_MS,
  BENCHMARK_RESOLUTIONS,
  createSphereMesh,
  type Mesh,
} from '../gpuBenchmark';

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

/**
 * Runs the measurement clock far faster than real time.
 *
 * `measureRun` breaks on the exported `BENCHMARK_DURATION_MS` (10 s), which is
 * read from production on purpose — a test that passed its own shorter budget in
 * would be measuring a knob nothing enforces. Advancing the clock instead lets
 * the real constant expire while the loop still executes every stage in order.
 * Returns its own restorer so a failing expectation cannot leak a stubbed clock
 * into the next test.
 */
function fastClock(stepMs = BENCHMARK_DURATION_MS): () => void {
  let elapsed = 0;
  const spy = jest.spyOn(performance, 'now').mockImplementation(() => {
    elapsed += stepMs;
    return elapsed;
  });
  return () => spy.mockRestore();
}

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

  it('rejects when the abort lands during the final run’s canvas readback', async () => {
    // The round-4 P2. The per-frame guard fires *before* the verification frame,
    // and the per-resolution guard fires before the next `measureRun` — so on
    // the last resolution an abort arriving during the closing readback had
    // nothing left to notice it. `measureRun` returned a complete-looking run,
    // `runBackend` returned a complete-looking report, and the caller published
    // it to state and localStorage from an unmounted page.
    //
    // A single resolution is passed so this run *is* the final one; the fast
    // clock lets the 10 s budget expire without spending it.
    const controller = new AbortController();
    const completed: string[] = [];
    const restoreClock = fastClock();

    // Which readback the abort lands on is the whole test, so it is anchored to
    // an observable stage rather than to a call count. `drawingBufferSize` is
    // called exactly once per run, immediately before the verification readback
    // and after the last timed frame — so this flag turns on precisely in the
    // window under test.
    //
    // Written against a call count first, and it was vacuous: the abort landed
    // on `probeReadbackControl`'s sampler at the *top* of `measureRun`, the
    // existing per-frame guard caught it, and the test passed with the fix
    // removed. It was asserting that some guard fires, not that this one does.
    let inVerificationReadback = false;
    const renderer = fakeRenderer({
      drawingBufferSize: () => {
        inVerificationReadback = true;
        return { width: 2560, height: 1440 };
      },
    });

    // Aborts while the readback is genuinely in flight: `inspectCanvasPixels` is
    // already awaiting the production sampler when the signal fires. The throw
    // afterwards is what jsdom's missing `createImageBitmap` produces anyway, so
    // the readback still resolves to `unavailable` and the run reaches its
    // return statement exactly as it did before — nothing is short-circuited.
    const globals = globalThis as { createImageBitmap?: unknown };
    const priorCreateImageBitmap = globals.createImageBitmap;
    globals.createImageBitmap = async () => {
      if (inVerificationReadback) controller.abort();
      throw new Error('createImageBitmap is unavailable');
    };

    try {
      const thrown = await runBackend(
        factory(renderer),
        mesh,
        // One resolution, so this run is unambiguously the final one — the case
        // where no later guard exists to catch the abort.
        BENCHMARK_RESOLUTIONS.slice(0, 1),
        () => {},
        (run) => completed.push(run.resolution.key),
        controller.signal
      ).then(
        (report) => report,
        (error: unknown) => error
      );

      // Guards the anchor itself: had the abort fired before the timed frames
      // the run would never have reached `drawingBufferSize`, and this test
      // would be re-proving the per-frame guard instead.
      expect(inVerificationReadback).toBe(true);

      expect(isBenchmarkCancelled(thrown)).toBe(true);
      // The run must not reach the progress callback either: that is a React
      // state setter at the real call site, invoked after unmount.
      expect(completed).toEqual([]);
    } finally {
      if (priorCreateImageBitmap === undefined) delete globals.createImageBitmap;
      else globals.createImageBitmap = priorCreateImageBitmap;
      restoreClock();
    }
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
