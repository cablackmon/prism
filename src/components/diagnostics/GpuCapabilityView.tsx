'use client';

/**
 * `/diag/gpu` — NOX hologram avatar Phase 0 capability gate (NOX-11768).
 *
 * Reachable only by typing the URL; nothing links here and it is behind the
 * household wall like every other non-public path. It runs automatically on
 * mount because the only way it gets observed on the board is the kiosk
 * screenshot lane, which can show a URL but cannot click a button.
 *
 * On screen: large plain text (readable in a 4K screenshot from across the
 * kitchen) plus the full machine-readable report in a <pre>. The same report is
 * mirrored into localStorage so an operator with file access to the kiosk's
 * Edge profile can recover it without transcribing from a PNG.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BENCHMARK_DURATION_MS,
  BENCHMARK_RESOLUTIONS,
  MESH_ALPHA,
  PASS_FPS,
  TARGET_VERTEX_COUNT,
  WARMUP_FRAMES,
  backendEvidenceAt,
  classifyResolution,
  createSphereMesh,
  decideRenderPath,
  type DecisionResult,
} from '@/lib/diagnostics/gpuBenchmark';
import {
  WEBGL2_BACKEND,
  WEBGPU_BACKEND,
  collectDisplayInfo,
  collectWebgl2Info,
  collectWebgpuInfo,
  describeError,
  measureDisplayRefreshHz,
  runBackend,
  type BackendReport,
  type BackendRun,
  type DisplayInfo,
  type Webgl2Info,
  type WebgpuInfo,
} from '@/lib/diagnostics/gpuRenderers';

export const REPORT_SCHEMA = 'nox.diag.gpu/1';
export const REPORT_STORAGE_KEY = 'nox-diag-gpu-last-report';

type GpuReport = {
  schema: typeof REPORT_SCHEMA;
  issue: 'NOX-11768';
  startedAt: string;
  completedAt: string;
  display: DisplayInfo;
  webgl2: Webgl2Info;
  webgpu: WebgpuInfo;
  benchmark: {
    durationMsPerRun: number;
    warmupFrames: number;
    requestedVertexCount: number;
    vertexCount: number;
    triangleCount: number;
    alpha: number;
    passFps: number;
    /**
     * Every frame asks to wait for GPU completion. Whether the wait actually
     * held is per-run (`gpuFenced`); a backend that rejects the wait is
     * reported un-fenced rather than silently timed against the clock.
     */
    gpuFenceRequested: true;
  };
  backends: BackendReport[];
  decision: DecisionResult;
};

type Phase = 'idle' | 'probing' | 'running' | 'done' | 'failed';

const DECISION_LABEL: Record<DecisionResult['decision'], string> = {
  webgpu: 'PROCEED — browser WebGPU path',
  webgl2: 'PROCEED — browser WebGL2 path',
  escalate: 'ESCALATE — neither backend clears the bar',
};

const DECISION_CLASS: Record<DecisionResult['decision'], string> = {
  webgpu: 'text-emerald-300',
  webgl2: 'text-amber-300',
  escalate: 'text-rose-300',
};

function formatFps(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
}

/** Renders the requested-versus-allocated drawing buffer, and whether it held. */
function describeDrawingBuffer(buffer: BackendRun['drawingBuffer']): {
  ok: boolean;
  text: string;
} {
  const status = classifyResolution(
    { width: buffer.requestedWidth, height: buffer.requestedHeight },
    { width: buffer.actualWidth, height: buffer.actualHeight }
  );
  if (status === 'unverified') return { ok: true, text: 'size not readable' };
  const actual = `${buffer.actualWidth}x${buffer.actualHeight}`;
  return status === 'matched'
    ? { ok: true, text: `${actual} as asked` }
    : {
        ok: false,
        text: `CLAMPED to ${actual} from ${buffer.requestedWidth}x${buffer.requestedHeight}`,
      };
}

export function GpuCapabilityView() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('Preparing…');
  const [report, setReport] = useState<GpuReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    // React 18 StrictMode mounts effects twice in development; a second
    // concurrent run would contend for the GPU and halve both results.
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase('probing');
    setFailure(null);
    setReport(null);

    const startedAt = new Date().toISOString();
    try {
      setStatus('Probing adapters…');
      const webgl2 = collectWebgl2Info();
      const webgpu = await collectWebgpuInfo();

      setStatus('Measuring display refresh…');
      const refreshHz = await measureDisplayRefreshHz();
      const display = collectDisplayInfo(refreshHz);

      setStatus(`Building ${TARGET_VERTEX_COUNT.toLocaleString()}-vertex mesh…`);
      const mesh = createSphereMesh(TARGET_VERTEX_COUNT);

      const mountCanvas = (canvas: HTMLCanvasElement) => {
        canvas.className = 'h-full w-full rounded-md bg-slate-900';
        canvasHostRef.current?.replaceChildren(canvas);
      };

      setPhase('running');
      const backends: BackendReport[] = [];

      for (const factory of [WEBGL2_BACKEND, WEBGPU_BACKEND]) {
        if (factory.backend === 'webgpu' && !webgpu.adapterPresent) {
          backends.push({
            backend: 'webgpu',
            available: false,
            error: webgpu.error ?? 'no WebGPU adapter',
            runs: [],
            benchmarkedAdapter: null,
          });
          continue;
        }
        setStatus(`${factory.backend}: starting…`);
        const backendReport = await runBackend(
          factory,
          mesh,
          BENCHMARK_RESOLUTIONS,
          mountCanvas,
          (completed) => {
            setStatus(
              `${factory.backend} ${completed.resolution.label}: ` +
                `${completed.stats.meanFps.toFixed(1)} fps mean, ` +
                `${completed.stats.minFps.toFixed(1)} fps min`
            );
          }
        );
        backends.push(backendReport);
      }

      canvasHostRef.current?.replaceChildren();

      const webgl2Runs = backends.find((entry) => entry.backend === 'webgl2')?.runs ?? [];
      const webgpuRuns = backends.find((entry) => entry.backend === 'webgpu')?.runs ?? [];
      // Both backends go through the same collector. Assembling these fields by
      // hand per backend is how the WebGL2 fallback came to be chosen on fps
      // alone while WebGPU was held to four separate validity checks.
      const decision = decideRenderPath({
        webgpuAdapterPresent: webgpu.adapterPresent,
        webgpu: backendEvidenceAt(webgpuRuns, '1440p'),
        webgl2: backendEvidenceAt(webgl2Runs, '1440p'),
      });

      const finished: GpuReport = {
        schema: REPORT_SCHEMA,
        issue: 'NOX-11768',
        startedAt,
        completedAt: new Date().toISOString(),
        display,
        webgl2,
        webgpu,
        benchmark: {
          durationMsPerRun: BENCHMARK_DURATION_MS,
          warmupFrames: WARMUP_FRAMES,
          requestedVertexCount: TARGET_VERTEX_COUNT,
          vertexCount: mesh.vertexCount,
          triangleCount: mesh.triangleCount,
          alpha: MESH_ALPHA,
          passFps: PASS_FPS,
          gpuFenceRequested: true,
        },
        backends,
        decision,
      };

      setReport(finished);
      setPhase('done');
      setStatus('Complete.');
      try {
        window.localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(finished));
      } catch {
        // Private-mode or a full quota must not void a completed measurement.
      }
    } catch (error) {
      setFailure(describeError(error));
      setPhase('failed');
      setStatus('Failed.');
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const webgl2Report = report?.backends.find((entry) => entry.backend === 'webgl2');
  const webgpuReport = report?.backends.find((entry) => entry.backend === 'webgpu');

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-50">
      <h1 className="text-5xl font-bold tracking-tight">GPU capability gate — /diag/gpu</h1>
      <p className="mt-2 text-2xl text-slate-300">
        NOX-11768 · hologram avatar Phase 0 · {BENCHMARK_DURATION_MS / 1000}s per run,{' '}
        {WARMUP_FRAMES} warm-up frames discarded · bar {PASS_FPS} fps mean at 1440p
      </p>
      <p className="mt-1 max-w-6xl text-xl text-slate-400">
        fps is 1000 / (draw → GPU completion), measured frame by frame with the queue drained each
        time. It is not a requestAnimationFrame cadence: an rAF-paced loop rounds every result to
        the display refresh, so a 58 fps GPU would read as 30 and this bar would behave like a 60
        fps one.
      </p>

      <p role="status" aria-live="polite" className="mt-6 text-3xl font-semibold text-sky-300">
        {phase === 'done' ? 'Benchmark complete' : status}
      </p>

      {failure ? (
        <p className="mt-4 text-3xl font-semibold text-rose-300">Run failed: {failure}</p>
      ) : null}

      <div
        ref={canvasHostRef}
        aria-hidden="true"
        className="mt-6 h-48 w-80 overflow-hidden rounded-md border border-slate-700"
      />

      {report ? (
        <>
          <p className={`mt-8 text-5xl font-bold ${DECISION_CLASS[report.decision.decision]}`}>
            {DECISION_LABEL[report.decision.decision]}
          </p>
          <p className="mt-2 max-w-6xl text-2xl text-slate-200">{report.decision.reason}</p>

          <dl className="mt-8 grid max-w-6xl grid-cols-1 gap-x-10 gap-y-3 text-2xl md:grid-cols-2">
            <div className="flex justify-between border-b border-slate-800 py-1">
              <dt className="text-slate-300">WebGPU adapter</dt>
              <dd className="font-semibold">
                {report.webgpu.adapterPresent
                  ? `${report.webgpu.vendor ?? '?'} / ${report.webgpu.architecture ?? '?'} / ${
                      report.webgpu.device || report.webgpu.description || '?'
                    }${report.webgpu.isFallbackAdapter ? ' (FALLBACK)' : ''}`
                  : `no WebGPU — ${report.webgpu.error ?? 'unknown reason'}`}
              </dd>
            </div>
            <div className="flex justify-between border-b border-slate-800 py-1">
              <dt className="text-slate-300">WebGL2 renderer</dt>
              <dd className="font-semibold">
                {report.webgl2.unmaskedRenderer ?? report.webgl2.renderer ?? 'unavailable'}
              </dd>
            </div>
            <div className="flex justify-between border-b border-slate-800 py-1">
              <dt className="text-slate-300">devicePixelRatio / screen</dt>
              <dd className="font-semibold">
                {report.display.devicePixelRatio} · {report.display.screenWidth}x
                {report.display.screenHeight} CSS · {report.display.physicalWidth}x
                {report.display.physicalHeight} physical
              </dd>
            </div>
            <div className="flex justify-between border-b border-slate-800 py-1">
              <dt className="text-slate-300">Display refresh (rAF ceiling)</dt>
              <dd className="font-semibold">{formatFps(report.display.refreshHz)} Hz</dd>
            </div>
            <div className="flex justify-between border-b border-slate-800 py-1">
              <dt className="text-slate-300">Mesh</dt>
              <dd className="font-semibold">
                {report.benchmark.vertexCount.toLocaleString()} verts ·{' '}
                {report.benchmark.triangleCount.toLocaleString()} tris · alpha{' '}
                {report.benchmark.alpha}
              </dd>
            </div>
          </dl>

          <table className="mt-8 max-w-6xl text-2xl">
            <caption className="sr-only">
              Mean and minimum frames per second by backend and resolution
            </caption>
            <thead>
              <tr className="text-left text-slate-300">
                <th scope="col" className="py-1 pr-10">
                  Backend
                </th>
                <th scope="col" className="py-1 pr-10">
                  Resolution
                </th>
                <th scope="col" className="py-1 pr-10">
                  Mean fps
                </th>
                <th scope="col" className="py-1 pr-10">
                  Min fps
                </th>
                <th scope="col" className="py-1 pr-10">
                  Frames
                </th>
                <th scope="col" className="py-1">
                  GPU-fenced
                </th>
              </tr>
            </thead>
            <tbody>
              {[webgl2Report, webgpuReport].map((entry) =>
                entry && entry.runs.length > 0 ? (
                  entry.runs.map((completed) => (
                    <tr
                      key={`${entry.backend}-${completed.resolution.key}`}
                      className="border-t border-slate-800"
                    >
                      <td className="py-1 pr-10 font-semibold">{entry.backend}</td>
                      <td className="py-1 pr-10">{completed.resolution.label}</td>
                      <td
                        className={`py-1 pr-10 font-bold ${
                          completed.stats.meanFps >= PASS_FPS ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {formatFps(completed.stats.meanFps)}
                      </td>
                      <td className="py-1 pr-10">{formatFps(completed.stats.minFps)}</td>
                      <td className="py-1 pr-10">
                        {completed.stats.frames}
                        {completed.interruptedByVisibilityChange ? ' (tab hidden — invalid)' : ''}
                      </td>
                      <td
                        className={`py-1 font-semibold ${
                          completed.gpuFenced ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {completed.gpuFenced ? 'yes' : 'NO — counts submissions, not work'}
                      </td>
                    </tr>
                  ))
                ) : entry ? (
                  <tr key={`${entry.backend}-none`} className="border-t border-slate-800">
                    <td className="py-1 pr-10 font-semibold">{entry.backend}</td>
                    <td className="py-1" colSpan={5}>
                      no runs — {entry.error ?? 'unavailable'}
                    </td>
                  </tr>
                ) : null
              )}
            </tbody>
          </table>

          {/* Frame rate is meaningless if the backend drew nothing, and a blank
              canvas is the *fastest* result a GPU can produce. Equally, an fps
              taken from a buffer the driver quietly shrank is not a measurement
              of the resolution it is filed under. Both are shown per run, next
              to the numbers, so the screenshot carries the caveats with the
              reading rather than leaving them in the JSON. */}
          <ul className="mt-6 max-w-6xl space-y-1 text-2xl">
            {[webgl2Report, webgpuReport].map((entry) =>
              entry
                ? entry.runs.map((completed) => (
                    <li key={`${entry.backend}-${completed.resolution.key}-pixels`}>
                      <span className="font-semibold">{entry.backend}</span>{' '}
                      {completed.resolution.label} — rendered content:{' '}
                      <span
                        className={
                          completed.pixelCheck.status === 'content'
                            ? 'font-semibold text-emerald-300'
                            : completed.pixelCheck.status === 'blank'
                              ? 'font-semibold text-rose-300'
                              : 'font-semibold text-amber-300'
                        }
                      >
                        {completed.pixelCheck.status === 'content'
                          ? `yes — ${completed.pixelCheck.uniqueColors} distinct colours`
                          : completed.pixelCheck.status === 'blank'
                            ? 'NO — canvas read back flat, the fps timed an empty frame'
                            : `not verified — ${completed.pixelCheck.error ?? 'readback unavailable'}`}
                      </span>
                      {'; buffer: '}
                      <span
                        className={
                          describeDrawingBuffer(completed.drawingBuffer).ok
                            ? 'font-semibold text-emerald-300'
                            : 'font-semibold text-rose-300'
                        }
                      >
                        {describeDrawingBuffer(completed.drawingBuffer).text}
                      </span>
                    </li>
                  ))
                : null
            )}
          </ul>

          <h2 className="mt-8 text-3xl font-semibold">Report JSON</h2>
          <pre className="mt-2 max-h-[32rem] max-w-full overflow-auto rounded-md border border-slate-700 bg-slate-900 p-4 text-lg leading-snug text-slate-100">
            {JSON.stringify(report, null, 2)}
          </pre>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => void run()}
        disabled={phase === 'probing' || phase === 'running'}
        className="mt-8 rounded-md bg-sky-300 px-6 py-3 text-2xl font-semibold text-slate-950 disabled:opacity-50"
      >
        Run again
      </button>
    </main>
  );
}
