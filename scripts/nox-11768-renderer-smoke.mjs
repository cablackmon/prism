#!/usr/bin/env node
/**
 * NOX-11768 — executes the shipped /diag/gpu renderer modules in a real
 * browser.
 *
 * The unit suite covers the decision rule and the classifiers, none of which
 * touch a GPU. The measurement loop is the opposite: it is all browser
 * behaviour — the fence, the drawing-buffer allocation, the canvas readback,
 * the per-resolution verification — and a green unit suite says nothing about
 * any of it. This bundles the real `gpuRenderers.ts` (no reimplementation, no
 * mock renderer) and drives `runBackend` against Chromium's SwiftShader
 * adapter, then asserts on what comes back.
 *
 * The fps here is software rendering on a headless box and is NOT evidence
 * about the board's Radeon 840M. What it does prove is that the loop runs, the
 * numbers are shaped correctly, and the guards fire.
 *
 * Usage: node scripts/nox-11768-renderer-smoke.mjs
 *
 * Takes no arguments on purpose — see the note on the run length below.
 */

import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';

const OUT_DIR = 'proof/nox-11768';

// Smaller surfaces than the plan's, because SwiftShader draws 100k translucent
// vertices at 4K in the tens of seconds per frame. The point here is that the
// loop and its guards work, not what the fps is.
//
// The run length is deliberately NOT a knob. This script used to accept a
// `--duration-ms` flag, default 2000, thread it into the page and record it in
// the JSON — while `measureRun` breaks on the module constant
// `BENCHMARK_DURATION_MS` and never saw it. The artifact therefore filed a 10 s
// run under `"durationMs": 2000`, and the frame totals could not be reconciled
// against the budget they were supposedly taken under. The real constant is
// exported into the page instead, so the artifact reports what governed.
const ENTRY = `
import { runBackend, WEBGL2_BACKEND, WEBGPU_BACKEND, collectWebgl2Info, collectWebgpuInfo, inspectCanvasPixels } from './src/lib/diagnostics/gpuRenderers.ts';
import { createSphereMesh, backendEvidenceAt, decideRenderPath, classifyReadback, classifyReadbackControl, TARGET_VERTEX_COUNT, BENCHMARK_DURATION_MS, WARMUP_FRAMES } from './src/lib/diagnostics/gpuBenchmark.ts';
window.__nox = { runBackend, WEBGL2_BACKEND, WEBGPU_BACKEND, collectWebgl2Info, collectWebgpuInfo, inspectCanvasPixels, createSphereMesh, backendEvidenceAt, decideRenderPath, classifyReadback, classifyReadbackControl, TARGET_VERTEX_COUNT, BENCHMARK_DURATION_MS, WARMUP_FRAMES };
`;

const work = mkdtempSync(join(tmpdir(), 'nox-11768-'));
writeFileSync(join(work, 'entry.ts'), ENTRY);

await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: join(work, 'bundle.js'),
  logLevel: 'warning',
});

writeFileSync(
  join(work, 'index.html'),
  `<!doctype html><meta charset=utf-8><title>nox-11768 smoke</title><body><div id=host></div><script src="bundle.js"></script></body>`
);

const browser = await chromium.launch({
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(String(error)));
// Forwarded so a hang is attributable to a stage rather than guessed at.
page.on('console', (message) => console.log(`    [page] ${message.text()}`));
await page.goto(`file://${join(work, 'index.html')}`);

const result = await page.evaluate(async () => {
  const nox = window.__nox;
  const host = document.getElementById('host');
  const mount = (canvas) => {
    canvas.style.width = '320px';
    canvas.style.height = '180px';
    host.replaceChildren(canvas);
  };

  // Drive the real runBackend. Resolutions are scaled down from 2560x1440 /
  // 3840x2160 only because SwiftShader would take minutes per 4K frame; the
  // requested-vs-actual comparison this exercises is resolution-independent.
  const resolutions = [
    { key: '1440p', label: '640 x 360 (scaled stand-in for 2560x1440)', width: 640, height: 360 },
    { key: '2160p', label: '960 x 540 (scaled stand-in for 3840x2160)', width: 960, height: 540 },
  ];

  const t0 = performance.now();
  const mark = (label) => console.log(`${((performance.now() - t0) / 1000).toFixed(1)}s ${label}`);

  // Deliberately NOT the plan's 100k vertices. Measured here first: SwiftShader
  // (Subzero) cannot finish even the 30 warm-up frames of a 199k-triangle
  // translucent mesh inside several minutes, because software rasterisation is
  // geometry-bound and the real target is a hardware Radeon. Shrinking the mesh
  // is what makes the loop observable at all. The 100k figure is a property of
  // `createSphereMesh`, proven without a GPU in the unit suite; what needs a
  // real browser is the loop, the fence, the buffer allocation and the
  // readback, and all of those are mesh-size-independent.
  const SMOKE_VERTEX_COUNT = 4000;
  const mesh = nox.createSphereMesh(SMOKE_VERTEX_COUNT);
  const planMesh = nox.createSphereMesh(nox.TARGET_VERTEX_COUNT);
  mark(`mesh built: ${mesh.vertexCount} verts / ${mesh.triangleCount} tris (smoke size)`);
  const webgl2Info = nox.collectWebgl2Info();
  mark(`webgl2 probe: ${webgl2Info.unmaskedRenderer ?? webgl2Info.renderer}`);
  const webgpuInfo = await nox.collectWebgpuInfo();
  mark(`webgpu probe: adapterPresent=${webgpuInfo.adapterPresent} ${webgpuInfo.error ?? ''}`);

  const progress = (backend) => (run) =>
    mark(
      `${backend} ${run.resolution.key} done: ${run.stats.meanFps.toFixed(2)} fps, ` +
        `${run.stats.frames} frames, fenced=${run.gpuFenced}, pixels=${run.pixelCheck.status}`
    );

  const started = performance.now();
  const webgl2 = await nox.runBackend(
    nox.WEBGL2_BACKEND,
    mesh,
    resolutions,
    mount,
    progress('webgl2')
  );
  mark('webgl2 backend complete');
  const webgpu = webgpuInfo.adapterPresent
    ? await nox.runBackend(nox.WEBGPU_BACKEND, mesh, resolutions, mount, progress('webgpu'))
    : {
        backend: 'webgpu',
        available: false,
        error: webgpuInfo.error,
        runs: [],
        benchmarkedAdapter: null,
        readbackControl: 'untested',
      };
  mark('webgpu backend complete');
  const wallMs = performance.now() - started;

  const decision = nox.decideRenderPath({
    webgpuAdapterPresent: webgpuInfo.adapterPresent,
    webgpu: nox.backendEvidenceAt(webgpu.runs, '1440p'),
    webgl2: nox.backendEvidenceAt(webgl2.runs, '1440p'),
  });

  // A positive control for the blank-canvas guard: a canvas that was cleared
  // and never drawn into must classify as `blank`, not sail through.
  const blankCanvas = document.createElement('canvas');
  blankCanvas.width = 256;
  blankCanvas.height = 144;
  const blankGl = blankCanvas.getContext('webgl2');
  blankGl.clearColor(0.02, 0.03, 0.06, 1);
  blankGl.clear(blankGl.COLOR_BUFFER_BIT);
  blankGl.finish();
  const blankCheck = await nox.inspectCanvasPixels(blankCanvas);

  return {
    mesh: { vertexCount: mesh.vertexCount, triangleCount: mesh.triangleCount },
    planMesh: { vertexCount: planMesh.vertexCount, triangleCount: planMesh.triangleCount },
    webgl2Info,
    webgpuInfo,
    backends: [webgl2, webgpu],
    evidence: {
      webgl2: nox.backendEvidenceAt(webgl2.runs, '1440p'),
      webgpu: nox.backendEvidenceAt(webgpu.runs, '1440p'),
    },
    decision,
    blankControl: blankCheck,
    wallMs,
    // Read out of production, not chosen here, so the two can never disagree.
    benchmarkDurationMs: nox.BENCHMARK_DURATION_MS,
    warmupFrames: nox.WARMUP_FRAMES,
  };
});

await browser.close();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'renderer-smoke.json'), JSON.stringify(result, null, 2));

// ---------------------------------------------------------------------------
// Assertions — an empty or errored run must not read as a pass.
// ---------------------------------------------------------------------------
const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${condition ? '' : ` — ${detail}`}`);
};

check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.join('; '));
check(
  'createSphereMesh still meets the plan-mandated 100k vertices',
  result.planMesh.vertexCount >= 100_000,
  `got ${result.planMesh.vertexCount}`
);
console.log(
  `NOTE  benchmarked with a reduced ${result.mesh.vertexCount}-vertex mesh; SwiftShader cannot ` +
    `drive the ${result.planMesh.vertexCount}-vertex one. These fps are NOT plan-representative.`
);

const webgl2 = result.backends.find((entry) => entry.backend === 'webgl2');
check('webgl2 backend initialised', webgl2.available && !webgl2.error, String(webgl2.error));
check(
  'webgl2 produced a run per resolution',
  webgl2.runs.length === 2,
  `got ${webgl2.runs.length}`
);
check(
  'webgl2 reports the adapter that actually drew',
  typeof webgl2.benchmarkedAdapter === 'string' && webgl2.benchmarkedAdapter.length > 0,
  String(webgl2.benchmarkedAdapter)
);

for (const run of webgl2.runs) {
  const tag = `webgl2 ${run.resolution.key}`;
  check(`${tag} measured real frames`, run.stats.frames > 0, `frames=${run.stats.frames}`);
  check(`${tag} fenced`, run.gpuFenced === true, String(run.fenceError));
  check(
    `${tag} verified rendered content at its own resolution`,
    run.pixelCheck.status === 'content',
    `${run.pixelCheck.status} (${run.pixelCheck.error ?? 'no note'})`
  );
  check(
    `${tag} drawing buffer matched the request`,
    run.drawingBuffer.actualWidth === run.drawingBuffer.requestedWidth &&
      run.drawingBuffer.actualHeight === run.drawingBuffer.requestedHeight,
    `asked ${run.drawingBuffer.requestedWidth}x${run.drawingBuffer.requestedHeight}, got ${run.drawingBuffer.actualWidth}x${run.drawingBuffer.actualHeight}`
  );
  // The whole point of the loop rewrite: the recorded cost is GPU work, so it
  // must NOT be a multiple of a 16.7 ms refresh period the way an rAF-paced
  // loop's would be. On SwiftShader these frames are far slower than a refresh
  // anyway; what this asserts is that measured time is frame cost, not wall
  // time including idle.
  check(
    `${tag} GPU time is a strict subset of wall time`,
    run.stats.elapsedMs <= run.wallElapsedMs,
    `gpu=${run.stats.elapsedMs.toFixed(1)}ms wall=${run.wallElapsedMs.toFixed(1)}ms`
  );
  // Reconciles the run against the budget it was actually taken under. Without
  // this, the JSON's recorded duration was free to drift from the constant
  // `measureRun` breaks on — which is exactly what happened: a 10 s run filed
  // as a 2 s one, with frame totals that could not be made to add up.
  check(
    `${tag} ran for at least the recorded ${result.benchmarkDurationMs}ms budget`,
    run.wallElapsedMs >= result.benchmarkDurationMs,
    `wall=${run.wallElapsedMs.toFixed(1)}ms budget=${result.benchmarkDurationMs}ms`
  );
}

// The readback control is the sole reason an all-zero benchmark frame is ever
// credited, so the artifact must state which verdict each run got rather than
// leaving a reader to infer it from the pixel status.
for (const backend of result.backends) {
  if (!backend.available) continue;
  // The backend field is the gate-resolution summary shown on screen, not the
  // control any particular run was credited against — so this asserts only that
  // it is a real verdict and that it agrees with the run it claims to describe.
  check(
    `${backend.backend} recorded a readback-control verdict`,
    ['working', 'broken', 'untested'].includes(backend.readbackControl),
    String(backend.readbackControl)
  );
  const gateRun = backend.runs.find((entry) => entry.resolution.key === '1440p');
  if (gateRun) {
    check(
      `${backend.backend} backend-level control is the gate run's own verdict`,
      backend.readbackControl === gateRun.readbackControl,
      `backend=${backend.readbackControl} gateRun=${gateRun.readbackControl}`
    );
  }
  for (const run of backend.runs) {
    // The P1 from the round-2 review: a black frame may only be credited when
    // the control independently proved readback is broken.
    //
    // Against `run.readbackControl`, not `backend.readbackControl`. Once the
    // control became per-resolution, the backend field stopped being the control
    // for every run and became the gate-resolution (1440p) summary — so this was
    // checking 2160p's pixels against 1440p's control, a comparand that is real
    // and well-typed and simply belongs to a different run.
    //
    // Which direction that could actually break, measured rather than assumed:
    // NOT the crediting direction. `measureRun` hands each run's own control to
    // `inspectCanvasPixels`, and `classifyReadback` returns the creditable
    // `unavailable` verdict for an all-zero frame only when that control is
    // `broken` — so no run production refused could have been waved through
    // here. The reachable failure is the opposite one: a 2160p run whose own
    // control is `broken` (production credits it) while the gate run's control
    // read `working` fails this check, and a correct result is reported as a
    // violated invariant. Receipt on the issue thread.
    check(
      `${backend.backend} ${run.resolution.key} all-zero frame credited only on its own broken control`,
      run.pixelCheck.status !== 'unavailable' ||
        run.pixelCheck.uniqueColors === null ||
        run.readbackControl === 'broken',
      `pixels=${run.pixelCheck.status} control=${run.readbackControl}`
    );
    check(
      `${backend.backend} ${run.resolution.key} recorded its own readback-control verdict`,
      ['working', 'broken', 'untested'].includes(run.readbackControl),
      String(run.readbackControl)
    );
  }
}

check(
  'blank-canvas positive control classifies as blank',
  result.blankControl.status === 'blank',
  `${result.blankControl.status} (${result.blankControl.error ?? 'no note'})`
);

// Asserts the reason justifies the decision that was actually reached, not that
// it recites a fixed pair of names. The earlier form demanded "WebGL2" appear
// unconditionally and so failed the one outcome the plan most wants to see: a
// WebGPU win, whose reason correctly has nothing to say about the fallback.
const EXPECTED_REASON = {
  webgpu: /WebGPU/,
  webgl2: /WebGL2/,
  escalate: /WebGPU[\s\S]*WebGL2|WebGL2[\s\S]*WebGPU/,
};
check(
  `decision "${result.decision.decision}" is justified by a reason naming the backend it rests on`,
  EXPECTED_REASON[result.decision.decision]?.test(result.decision.reason) === true,
  result.decision.reason
);
// An escalation is the one outcome that must cite both, since it is a claim
// about both backends failing and is what gets escalated to a human.
if (result.decision.decision === 'escalate') {
  check(
    'escalation cites a measured number',
    /\d/.test(result.decision.reason),
    result.decision.reason
  );
}

console.log('\n--- adapters ---');
console.log('webgl2 probe :', result.webgl2Info.unmaskedRenderer ?? result.webgl2Info.renderer);
console.log('webgl2 bench :', webgl2.benchmarkedAdapter);
console.log(
  'webgpu       :',
  result.webgpuInfo.adapterPresent
    ? result.webgpuInfo.vendor + ' / ' + result.webgpuInfo.architecture
    : 'no adapter — ' + result.webgpuInfo.error
);
console.log('\n--- runs ---');
for (const backend of result.backends) {
  for (const run of backend.runs) {
    console.log(
      `${backend.backend} ${run.resolution.key}: ${run.stats.meanFps.toFixed(2)} fps mean, ` +
        `${run.stats.minFps.toFixed(2)} min, ${run.stats.frames} frames, fenced=${run.gpuFenced}, ` +
        `pixels=${run.pixelCheck.status}, control=${run.readbackControl}, ` +
        `buffer=${run.drawingBuffer.actualWidth}x${run.drawingBuffer.actualHeight}`
    );
  }
  if (backend.runs.length === 0) console.log(`${backend.backend}: no runs — ${backend.error}`);
}
console.log('\ndecision:', result.decision.decision);
console.log('reason  :', result.decision.reason);
console.log(
  `\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`} — report at ${OUT_DIR}/renderer-smoke.json`
);
process.exit(failures.length === 0 ? 0 : 1);
