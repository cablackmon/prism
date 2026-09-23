/**
 * GPU capability gate — pure logic.
 *
 * NOX hologram avatar Phase 0 (NOX-11768). The board has to decide whether a
 * translucent, additively-rimmed avatar mesh can be driven in the existing Edge
 * kiosk tab, and on which backend. Everything in this file is deterministic and
 * browser-free so the geometry sizing, the frame statistics and — most
 * importantly — the decision rule can be unit tested without a GPU.
 *
 * The WebGL2/WebGPU renderers live in `gpuRenderers.ts`.
 */

/** Each resolution is measured for this long, after warm-up frames are discarded. */
export const BENCHMARK_DURATION_MS = 10_000;

/**
 * Frames discarded at the start of every run. The first frames after a context
 * is created and the drawing buffer is resized include shader compilation,
 * buffer upload and the driver's first allocation of a 4K render target; they
 * are startup cost, not steady-state cost, and a single 300 ms first frame
 * would otherwise dominate `minFps`.
 */
export const WARMUP_FRAMES = 30;

/** Plan constant: the mesh must carry at least this many vertices. */
export const TARGET_VERTEX_COUNT = 100_000;

/** Plan constant: the mesh is drawn at this alpha. */
export const MESH_ALPHA = 0.5;

/** Plan decision rule: 1440p must hold at least this mean fps. */
export const PASS_FPS = 45;

/** Camera distance in sphere radii — chosen so the mesh nearly fills frame height. */
export const CAMERA_DISTANCE = 2.5;

/** Vertical field of view, radians. */
export const FIELD_OF_VIEW = (50 * Math.PI) / 180;

export type BenchmarkResolution = {
  /** Stable key used in the JSON blob and in the decision rule. */
  key: '1440p' | '2160p';
  label: string;
  width: number;
  height: number;
};

/**
 * Internal (drawing buffer) resolutions, not CSS sizes. The canvas is laid out
 * small on screen; `width`/`height` below are what the GPU actually rasterises.
 */
export const BENCHMARK_RESOLUTIONS: readonly BenchmarkResolution[] = [
  { key: '1440p', label: '2560 x 1440', width: 2560, height: 1440 },
  { key: '2160p', label: '3840 x 2160', width: 3840, height: 2160 },
] as const;

/**
 * The resolution the plan's 45 fps bar is read at. Named once because three
 * call sites need it and a literal that drifted in one of them would compare
 * the bar against a run it does not describe.
 */
export const GATE_RESOLUTION_KEY: BenchmarkResolution['key'] = '1440p';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type Mesh = {
  /** Interleaved position(3) + normal(3), 6 floats / 24 bytes per vertex. */
  vertexData: Float32Array;
  indexData: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  segments: number;
  rings: number;
};

export const VERTEX_STRIDE_FLOATS = 6;
export const VERTEX_STRIDE_BYTES = VERTEX_STRIDE_FLOATS * 4;

/**
 * Picks a UV-sphere tessellation with at least `minVertices` vertices while
 * staying close to a 1.6:1 segment:ring ratio, so the triangles stay roughly
 * square rather than degenerating into slivers.
 *
 * Returned counts are the *sphere* parameters; the vertex grid is
 * `(segments + 1) * (rings + 1)` because the seam column and both poles are
 * duplicated to keep normals and the index grid uniform.
 */
export function chooseTessellation(minVertices: number): { segments: number; rings: number } {
  if (!Number.isFinite(minVertices) || minVertices < 4) {
    throw new Error(`minVertices must be a finite number >= 4, got ${minVertices}`);
  }
  const rings = Math.max(2, Math.ceil(Math.sqrt(minVertices / 1.6)));
  const segments = Math.max(3, Math.ceil(minVertices / (rings + 1)) - 1);
  return { segments, rings };
}

/**
 * Builds a unit-radius UV sphere. Position and normal are identical for a unit
 * sphere, but both are written so the vertex layout matches what a real skinned
 * avatar mesh would stream, and so the vertex fetch cost is representative.
 */
export function createSphereMesh(minVertices: number = TARGET_VERTEX_COUNT): Mesh {
  const { segments, rings } = chooseTessellation(minVertices);
  const vertexCount = (segments + 1) * (rings + 1);
  const triangleCount = segments * rings * 2;

  const vertexData = new Float32Array(vertexCount * VERTEX_STRIDE_FLOATS);
  const indexData = new Uint32Array(triangleCount * 3);

  let v = 0;
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let segment = 0; segment <= segments; segment += 1) {
      const theta = (segment / segments) * Math.PI * 2;
      const x = sinPhi * Math.cos(theta);
      const y = cosPhi;
      const z = sinPhi * Math.sin(theta);
      vertexData[v] = x;
      vertexData[v + 1] = y;
      vertexData[v + 2] = z;
      vertexData[v + 3] = x;
      vertexData[v + 4] = y;
      vertexData[v + 5] = z;
      v += VERTEX_STRIDE_FLOATS;
    }
  }

  let i = 0;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      indexData[i] = a;
      indexData[i + 1] = b;
      indexData[i + 2] = a + 1;
      indexData[i + 3] = a + 1;
      indexData[i + 4] = b;
      indexData[i + 5] = b + 1;
      i += 6;
    }
  }

  return { vertexData, indexData, vertexCount, triangleCount, segments, rings };
}

// ---------------------------------------------------------------------------
// Matrices (column-major, as both GLSL and WGSL expect)
// ---------------------------------------------------------------------------

/**
 * Right-handed perspective projection mapping the depth range to [0, 1].
 *
 * Zero-to-one depth is required by WebGPU (it clips to `0 <= z <= w`) and is
 * equally valid under WebGL2, whose [-w, w] clip volume contains it. Using one
 * projection for both backends keeps the two runs pixel-comparable; a
 * GL-style [-1, 1] projection would have silently clipped the near half of the
 * sphere away on the WebGPU run and made it look faster.
 */
export function perspectiveZeroToOne(
  fovY: number,
  aspect: number,
  near: number,
  far: number
): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (far * near) / (near - far);
  return out;
}

/** Rotation about Y then X, as a column-major mat4 with no translation. */
export function rotationMatrix(yaw: number, pitch: number): Float32Array {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  const out = new Float32Array(16);
  // column 0
  out[0] = cy;
  out[1] = sx * sy;
  out[2] = -cx * sy;
  // column 1
  out[4] = 0;
  out[5] = cx;
  out[6] = sx;
  // column 2
  out[8] = sy;
  out[9] = -sx * cy;
  out[10] = cx * cy;
  out[15] = 1;
  return out;
}

/**
 * Model-view for the benchmark: rotate the mesh, then push it `distance` down
 * the view axis. Because the view transform is a pure translation, the upper
 * 3x3 of this matrix is the rotation itself and doubles as the normal matrix.
 */
export function modelViewMatrix(yaw: number, pitch: number, distance: number): Float32Array {
  const out = rotationMatrix(yaw, pitch);
  out[14] = -distance;
  return out;
}

// ---------------------------------------------------------------------------
// Frame statistics
// ---------------------------------------------------------------------------

export type FrameStats = {
  frames: number;
  elapsedMs: number;
  meanFps: number;
  /** Worst single frame expressed as fps, i.e. 1000 / longest frame interval. */
  minFps: number;
  longestFrameMs: number;
};

/**
 * Summarises a run from its per-frame costs.
 *
 * Each entry is one frame's draw-to-GPU-completion time, *not* the gap between
 * two `requestAnimationFrame` timestamps. Timing rAF-to-rAF quantises every
 * result to the display cadence: because the next frame is only scheduled once
 * the fence resolves, a frame whose real cost is 17 ms misses the next 60 Hz
 * callback and is recorded as 33 ms, so a GPU sustaining a genuine 58 fps
 * reports 30 and the 45 fps bar silently becomes a 60 fps bar. Measuring the
 * fence directly reports the GPU's cost with the idle wait for the next refresh
 * boundary excluded.
 *
 * `meanFps` is frames over total cost rather than the mean of per-frame rates:
 * averaging rates over-weights the cheap frames and would report a stutter-prone
 * run as comfortably passing.
 */
export function summarizeFrames(intervalsMs: readonly number[]): FrameStats {
  if (intervalsMs.length === 0) {
    return { frames: 0, elapsedMs: 0, meanFps: 0, minFps: 0, longestFrameMs: 0 };
  }
  let elapsedMs = 0;
  let longestFrameMs = 0;
  for (const interval of intervalsMs) {
    elapsedMs += interval;
    if (interval > longestFrameMs) longestFrameMs = interval;
  }
  return {
    frames: intervalsMs.length,
    elapsedMs,
    meanFps: elapsedMs > 0 ? (intervalsMs.length * 1000) / elapsedMs : 0,
    minFps: longestFrameMs > 0 ? 1000 / longestFrameMs : 0,
    longestFrameMs,
  };
}

/** Structural view of a completed run — satisfied by `BackendRun` in `gpuRenderers.ts`. */
export type MeasuredRun = {
  resolution: { key: BenchmarkResolution['key'] };
  stats: { meanFps: number };
};

/** Mean fps for one resolution of one backend, or null when that run never produced numbers. */
export function meanFpsAt(
  runs: readonly MeasuredRun[],
  key: BenchmarkResolution['key']
): number | null {
  const match = runs.find((run) => run.resolution.key === key);
  if (!match) return null;
  return Number.isFinite(match.stats.meanFps) && match.stats.meanFps > 0
    ? match.stats.meanFps
    : null;
}

// ---------------------------------------------------------------------------
// Readback classification
// ---------------------------------------------------------------------------

/**
 * The colour both backends clear to before drawing. Deliberately dark but
 * *not* black, which is what makes an all-zero readback diagnosable: see
 * `classifyReadback`.
 */
export const CLEAR_COLOR = { r: 0.02, g: 0.03, b: 0.06 } as const;

/** Three-valued because "could not look" and "looked and it was empty" differ. */
export type PixelCheckStatus = 'content' | 'blank' | 'unavailable';

export type ReadbackVerdict = { status: PixelCheckStatus; note: string | null };

/**
 * What a clear-only control frame proved about the readback mechanism itself.
 *
 * `working` — the control read back as a real non-black colour, so readback
 * functions on this backend. `broken` — the control read back as zeroes or not
 * at all, even though it only cleared; readback cannot be trusted here.
 * `untested` — no control result, so nothing is proven either way.
 */
export type ReadbackControl = 'working' | 'broken' | 'untested';

/**
 * Classifies the clear-only control frame.
 *
 * The control binds no pipeline and draws no geometry, so its expected pixels
 * are `CLEAR_COLOR` regardless of what is wrong with the mesh path. That is
 * what makes it independent evidence about readback rather than about
 * rendering.
 */
export function classifyReadbackControl(
  uniqueColors: number,
  flatColor: { r: number; g: number; b: number } | null
): ReadbackControl {
  if (uniqueColors === 0 || flatColor === null) return 'broken';
  if (flatColor.r === 0 && flatColor.g === 0 && flatColor.b === 0) return 'broken';
  return 'working';
}

/**
 * Turns a canvas readback into a three-valued verdict.
 *
 * More than one colour means the mesh reached the canvas. One flat colour is
 * ambiguous, and the ambiguity is not cosmetic in either direction:
 *
 *   - Headless Chromium on a SwiftShader adapter returns all-zero pixels for
 *     *any* WebGPU canvas — a bare clear-to-red with no shaders and no pipeline
 *     reads back black too. Calling that `blank` vetoes a healthy backend.
 *   - But WebGPU validation can also fail before the clear executes (an invalid
 *     shader, pipeline or command buffer) while `onSubmittedWorkDone()` still
 *     resolves having done no work. That canvas is *genuinely* black, and
 *     calling it `unavailable` credits a broken backend with the high fps that
 *     drawing nothing produces — the fastest result a GPU can post.
 *
 * A non-black clear colour proves black was not a *successful* frame, but on
 * its own it cannot say which of those two happened. So the clear-only control
 * decides it: if the control reads back, readback works and an all-zero
 * benchmark frame means rendering failed (`blank`, not creditable). If the
 * control also comes back black, the readback is the broken part
 * (`unavailable`, still creditable).
 *
 * With no control, this fails closed to `blank`. Crediting an unproven all-zero
 * frame is the error that ships a backend which draws nothing.
 */
export function classifyReadback(
  uniqueColors: number,
  flatColor: { r: number; g: number; b: number } | null,
  control: ReadbackControl = 'untested'
): ReadbackVerdict {
  if (uniqueColors > 1) return { status: 'content', note: null };
  if (uniqueColors === 0 || flatColor === null) {
    // No pixels came back at all, which is the readback failing rather than
    // the canvas being empty.
    return { status: 'unavailable', note: 'readback produced no pixels to inspect' };
  }
  if (flatColor.r === 0 && flatColor.g === 0 && flatColor.b === 0) {
    if (control === 'broken') {
      return {
        status: 'unavailable',
        note:
          'readback returned uniform zeroes, and the clear-only control frame came back ' +
          'black too — readback is broken on this backend, so the canvas could not be ' +
          'read rather than being empty',
      };
    }
    return {
      status: 'blank',
      note:
        control === 'working'
          ? 'readback returned uniform zeroes while the clear-only control read back ' +
            'correctly, so readback works and the benchmark frame genuinely rendered ' +
            'nothing — the configured clear colour is not black'
          : 'readback returned uniform zeroes and no clear-only control proved readback ' +
            'works, so this is treated as an empty frame rather than credited',
    };
  }
  return {
    status: 'blank',
    note: 'readback succeeded and found a single flat colour, so no fragments were drawn',
  };
}

// ---------------------------------------------------------------------------
// Per-backend evidence
// ---------------------------------------------------------------------------

/** Three-valued for the same reason as the pixel check: an unread size is not a clamped one. */
export type ResolutionStatus = 'matched' | 'clamped' | 'unverified';

/**
 * Compares the drawing buffer the GPU actually allocated against the one the
 * run asked for.
 *
 * A browser that clamps a 3840x2160 request down to its maximum renders fewer
 * pixels than the label claims and posts an inflated fps for a resolution it
 * never measured. `null` dimensions mean the size could not be read, which is
 * not evidence of clamping and must not veto the run.
 */
export function classifyResolution(
  requested: { width: number; height: number },
  actual: { width: number | null; height: number | null }
): ResolutionStatus {
  if (actual.width === null || actual.height === null) return 'unverified';
  return actual.width >= requested.width && actual.height >= requested.height
    ? 'matched'
    : 'clamped';
}

/**
 * Whether a run's canvas content may be credited, and why.
 *
 * `verified` — pixels came back and held more than one colour, so the mesh
 * reached the canvas. `blank` — pixels came back flat, so nothing was drawn.
 * `unverified` — the canvas could not be read and nothing proved *why*.
 * `readbackBroken` — the canvas could not be read and the clear-only control
 * could not be read either, so the readback mechanism is the faulty part.
 *
 * Only `verified` and `readbackBroken` are creditable.
 */
export type ContentCredit = 'verified' | 'blank' | 'unverified' | 'readbackBroken';

/**
 * Maps a canvas readback plus its control to the decision rule's content input.
 *
 * A small function with its own test on purpose: the call site in
 * `GpuCapabilityView` is not unit tested, so writing the comparison inline let a
 * mutation to `status !== 'content'` typecheck and pass the whole suite. That
 * mutant vetoes every backend whose canvas simply cannot be read back — which
 * is exactly what headless SwiftShader does — and would have turned an
 * unreadable canvas into a fake "renders nothing" verdict.
 *
 * The `unavailable` branch is the one that has bitten twice, in both
 * directions. Crediting it unconditionally — as this did — lets a backend whose
 * *rendering* failed be selected: `inspectCanvasPixels` reports `unavailable`
 * for a thrown `createImageBitmap`/`getImageData` just as readily as for a
 * genuinely unreadable surface, and a backend that draws nothing posts the
 * fastest number on the page. Refusing it unconditionally vetoes healthy
 * hardware whose canvas merely cannot be sampled. So it is creditable only when
 * the control — which binds no pipeline and draws no geometry, and so cannot
 * fail for a rendering reason — *also* failed to read back.
 */
export function classifyContentCredit(
  pixelCheck: { status: PixelCheckStatus } | null | undefined,
  control: ReadbackControl = 'untested'
): ContentCredit {
  if (pixelCheck?.status === 'content') return 'verified';
  if (pixelCheck?.status === 'blank') return 'blank';
  return control === 'broken' ? 'readbackBroken' : 'unverified';
}

/** The two credits that let a run's fps stand as evidence about the GPU. */
export function isContentCreditable(credit: ContentCredit): boolean {
  return credit === 'verified' || credit === 'readbackBroken';
}

/** Everything the decision rule needs to know about one backend at one resolution. */
export type BackendEvidence = {
  /** Mean fps of this backend's run at the gate resolution, or null when it produced none. */
  meanFps: number | null;
  /**
   * False when the run could not wait on GPU completion, which makes its fps a
   * count of submissions queued rather than work finished.
   */
  measurementFenced: boolean;
  /** Whether this run's canvas proved it drew the mesh, and why if it did not. */
  contentCredit: ContentCredit;
  /** `clamped` means the fps belongs to a smaller buffer than the one named. */
  resolutionStatus: ResolutionStatus;
  /**
   * Set when the sample itself is invalid regardless of what it says — a hidden
   * tab stalls the loop and the recorded frame costs stop describing the GPU.
   */
  sampleInvalidReason: string | null;
};

/** Structural view of a run carrying everything the gate reads. */
export type EvidenceRun = MeasuredRun & {
  interruptedByVisibilityChange: boolean;
  gpuFenced: boolean;
  pixelCheck: { status: PixelCheckStatus };
  /**
   * The clear-only control taken at *this* run's resolution. Per-run rather
   * than per-backend: a control that passed on the 16x9 canvas says nothing
   * about a readback path that fails only after a 3840x2160 allocation, which
   * is exactly the size where a misread canvas would matter most.
   */
  readbackControl: ReadbackControl;
  drawingBuffer: {
    requestedWidth: number;
    requestedHeight: number;
    actualWidth: number | null;
    actualHeight: number | null;
  };
};

/**
 * Collects one backend's evidence at one resolution.
 *
 * Pure and tested because the alternative — assembling these five fields inline
 * at the single untested call site in `GpuCapabilityView` — is how the WebGL2
 * fallback came to be selected on fps alone while WebGPU was held to four
 * separate validity checks.
 */
export function backendEvidenceAt(
  runs: readonly EvidenceRun[],
  key: BenchmarkResolution['key']
): BackendEvidence {
  const match = runs.find((run) => run.resolution.key === key);
  if (!match) {
    return {
      meanFps: null,
      measurementFenced: false,
      contentCredit: 'unverified',
      resolutionStatus: 'unverified',
      sampleInvalidReason: null,
    };
  }
  return {
    meanFps: meanFpsAt(runs, key),
    measurementFenced: match.gpuFenced,
    contentCredit: classifyContentCredit(match.pixelCheck, match.readbackControl),
    resolutionStatus: classifyResolution(
      { width: match.drawingBuffer.requestedWidth, height: match.drawingBuffer.requestedHeight },
      { width: match.drawingBuffer.actualWidth, height: match.drawingBuffer.actualHeight }
    ),
    sampleInvalidReason: match.interruptedByVisibilityChange
      ? 'the tab was hidden during the run, which stalls the frame loop and invalidates the sample'
      : null,
  };
}

// ---------------------------------------------------------------------------
// Decision rule
// ---------------------------------------------------------------------------

export type RenderPathDecision = 'webgpu' | 'webgl2' | 'escalate';

export type DecisionInput = {
  /** True only when `navigator.gpu.requestAdapter()` actually returned an adapter. */
  webgpuAdapterPresent: boolean;
  webgpu: BackendEvidence;
  webgl2: BackendEvidence;
};

export type DecisionResult = {
  decision: RenderPathDecision;
  /** Human-readable justification, rendered on screen and copied into the issue. */
  reason: string;
};

/**
 * Whether one backend's run may be credited with clearing the bar, and the
 * sentence explaining the answer either way.
 *
 * Applied identically to both backends. The asymmetric version of this rule —
 * four validity checks on WebGPU and a bare fps comparison on the WebGL2
 * fallback — was the gate's worst failure mode, because a broken pipeline is
 * *more* likely to clear an fps bar than a working one: drawing nothing is the
 * cheapest thing a GPU can do. A blank or un-fenced WebGL2 run would have been
 * selected as the path for Phase 2 on the strength of that.
 *
 * Order matters. Each check answers "is this number about the GPU at all?" and
 * only the last one asks whether the number is big enough; reporting "only held
 * 300 fps" would be absurd, so validity is settled first.
 */
function evaluateBackend(
  label: string,
  evidence: BackendEvidence
): { clears: boolean; detail: string } {
  const { meanFps, measurementFenced, contentCredit, resolutionStatus, sampleInvalidReason } =
    evidence;

  if (sampleInvalidReason !== null) {
    return {
      clears: false,
      detail: `the ${label} run is not a valid sample: ${sampleInvalidReason}`,
    };
  }
  if (meanFps === null) {
    return { clears: false, detail: `the ${label} run produced no numbers` };
  }
  const fps = meanFps.toFixed(1);
  if (!measurementFenced) {
    return {
      clears: false,
      detail:
        `the ${label} run could not wait on GPU completion, so its ${fps} fps counts ` +
        `submissions queued, not work done, and is not creditable`,
    };
  }
  if (contentCredit === 'blank') {
    return {
      clears: false,
      detail:
        `the ${label} run reported ${fps} fps but its canvas read back blank, so it was ` +
        `timing an empty frame, not the mesh`,
    };
  }
  if (contentCredit === 'unverified') {
    return {
      clears: false,
      detail:
        `the ${label} run reported ${fps} fps but its canvas could not be read back, and no ` +
        `clear-only control proved the readback itself was at fault, so nothing rules out the ` +
        `renderer having drawn nothing — the cheapest thing a GPU can do and the fastest ` +
        `number on this page`,
    };
  }
  if (resolutionStatus === 'clamped') {
    return {
      clears: false,
      detail:
        `the ${label} run reported ${fps} fps but the drawing buffer it got was smaller ` +
        `than the one it asked for, so the number is not a measurement of this resolution`,
    };
  }
  if (meanFps < PASS_FPS) {
    return { clears: false, detail: `the ${label} run only held ${fps} fps at 1440p` };
  }
  return { clears: true, detail: `the ${label} run held ${fps} fps at 1440p` };
}

/**
 * The plan's rule (BOARD_INTEGRATION_PLAN.md § Phases, Phase 0):
 *   "WebGPU adapter present and >= 45 fps at 1440p = proceed in browser;
 *    otherwise WebGL2 path; if WebGL2 also fails the bar, escalate."
 *
 * Two things the prose leaves implicit and this implementation fixes:
 *
 * 1. The fps in each clause is that backend's *own* measured fps, and only when
 *    the measurement is evidence about the GPU — fenced, non-blank, taken at the
 *    resolution it names, and not interrupted. An adapter that exists but could
 *    not be validly benchmarked is not evidence that its path holds 45 fps.
 * 2. The bar is read against mean fps. `minFps` is reported alongside because a
 *    run that means 60 and mins 12 is a stutter problem the mean cannot show,
 *    but it is not what gates the path choice.
 */
export function decideRenderPath(input: DecisionInput): DecisionResult {
  const { webgpuAdapterPresent, webgpu, webgl2 } = input;

  // Why WebGPU was or was not taken. Computed once and reported on every path:
  // an ESCALATE that named only WebGL2 would leave the reader to find a large
  // WebGPU fps in the JSON blob with nothing saying it was discarded.
  const webgpuVerdict = webgpuAdapterPresent
    ? evaluateBackend('WebGPU', webgpu)
    : { clears: false, detail: 'no WebGPU adapter' };

  if (webgpuVerdict.clears) {
    return {
      decision: 'webgpu',
      reason:
        `WebGPU adapter present and ${webgpuVerdict.detail} (bar ${PASS_FPS}). ` +
        `Browser WebGPU path.`,
    };
  }

  const webgl2Verdict = evaluateBackend('WebGL2', webgl2);
  if (webgl2Verdict.clears) {
    return {
      decision: 'webgl2',
      reason: `${webgpuVerdict.detail}; ${webgl2Verdict.detail} (bar ${PASS_FPS}). WebGL2 path.`,
    };
  }

  return {
    decision: 'escalate',
    reason:
      `Neither backend cleared ${PASS_FPS} fps at 1440p: ${webgpuVerdict.detail}; ` +
      `${webgl2Verdict.detail}. ESCALATE.`,
  };
}
