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
 * Summarises a run from its inter-frame intervals.
 *
 * `meanFps` is frames over wall time rather than the mean of per-frame rates:
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
// Decision rule
// ---------------------------------------------------------------------------

/** Three-valued because "could not look" and "looked and it was empty" differ. */
export type PixelCheckStatus = 'content' | 'blank' | 'unavailable';

/**
 * Maps a canvas readback to the decision rule's `webgpuRenderedBlank` input.
 *
 * A one-line predicate with its own test on purpose: the call site in
 * `GpuCapabilityView` is not unit tested, so writing the comparison inline let a
 * mutation to `status !== 'content'` typecheck and pass the whole suite. That
 * mutant vetoes every backend whose canvas simply cannot be read back — which
 * is exactly what headless SwiftShader does — and would have turned an
 * unreadable canvas into a fake "WebGPU renders nothing" verdict.
 */
export function isRenderedBlank(pixelCheck?: { status: PixelCheckStatus } | null): boolean {
  return pixelCheck?.status === 'blank';
}

export type RenderPathDecision = 'webgpu' | 'webgl2' | 'escalate';

export type DecisionInput = {
  /** True only when `navigator.gpu.requestAdapter()` actually returned an adapter. */
  webgpuAdapterPresent: boolean;
  /** Mean fps of the WebGPU run at 1440p, or null when that run did not produce numbers. */
  webgpuMeanFps1440: number | null;
  /**
   * False when the WebGPU run could not wait on GPU completion, which makes its
   * fps a count of submissions queued rather than work finished. Such a number
   * is not evidence about the GPU and must not decide the render path.
   */
  webgpuMeasurementFenced: boolean;
  /**
   * True only when the canvas was read back successfully and held a single flat
   * colour. A pipeline that emits no fragments is the cheapest thing a GPU can
   * do, so a blank WebGPU run posts the best fps on the page; crediting it would
   * send Phase 2 down the WebGPU path on a backend that renders nothing.
   *
   * A readback that could not run leaves this false: "we could not look" is not
   * the same claim as "we looked and it was empty".
   */
  webgpuRenderedBlank: boolean;
  /** Mean fps of the WebGL2 run at 1440p, or null when that run did not produce numbers. */
  webgl2MeanFps1440: number | null;
};

export type DecisionResult = {
  decision: RenderPathDecision;
  /** Human-readable justification, rendered on screen and copied into the issue. */
  reason: string;
};

/**
 * The plan's rule (BOARD_INTEGRATION_PLAN.md § Phases, Phase 0):
 *   "WebGPU adapter present and >= 45 fps at 1440p = proceed in browser;
 *    otherwise WebGL2 path; if WebGL2 also fails the bar, escalate."
 *
 * Two things the prose leaves implicit and this implementation fixes:
 *
 * 1. The fps in the WebGPU clause is the *WebGPU-measured* fps, and only when
 *    that measurement waited on GPU completion. An adapter that exists but
 *    could not be benchmarked — or was benchmarked without a fence, which times
 *    the clock rather than the GPU — is not evidence that the WebGPU path holds
 *    45 fps, so it falls through to WebGL2 rather than being credited.
 * 2. The bar is read against mean fps. `minFps` is reported alongside because a
 *    run that means 60 and mins 12 is a stutter problem the mean cannot show,
 *    but it is not what gates the path choice.
 */
export function decideRenderPath(input: DecisionInput): DecisionResult {
  const {
    webgpuAdapterPresent,
    webgpuMeanFps1440,
    webgpuMeasurementFenced,
    webgpuRenderedBlank,
    webgl2MeanFps1440,
  } = input;

  if (
    webgpuAdapterPresent &&
    webgpuMeanFps1440 !== null &&
    webgpuMeasurementFenced &&
    !webgpuRenderedBlank &&
    webgpuMeanFps1440 >= PASS_FPS
  ) {
    return {
      decision: 'webgpu',
      reason:
        `WebGPU adapter present and the WebGPU run held ${webgpuMeanFps1440.toFixed(1)} fps ` +
        `at 1440p (bar ${PASS_FPS}). Browser WebGPU path.`,
    };
  }

  // Why WebGPU was not taken. Computed once and reported on both remaining
  // paths: an ESCALATE that named only WebGL2 would leave the reader to find a
  // large WebGPU fps in the JSON blob with nothing saying it was discarded.
  const webgpuDetail = !webgpuAdapterPresent
    ? 'no WebGPU adapter'
    : webgpuMeanFps1440 === null
      ? 'WebGPU adapter present but its run produced no numbers'
      : !webgpuMeasurementFenced
        ? `WebGPU run could not wait on GPU completion, so its ` +
          `${webgpuMeanFps1440.toFixed(1)} fps counts submissions queued, not work done, ` +
          `and is not creditable`
        : webgpuRenderedBlank
          ? `WebGPU run reported ${webgpuMeanFps1440.toFixed(1)} fps but its canvas read ` +
            `back blank, so it was timing an empty frame, not the mesh`
          : `WebGPU run only held ${webgpuMeanFps1440.toFixed(1)} fps at 1440p`;

  if (webgl2MeanFps1440 !== null && webgl2MeanFps1440 >= PASS_FPS) {
    return {
      decision: 'webgl2',
      reason:
        `${webgpuDetail}; the WebGL2 run held ${webgl2MeanFps1440.toFixed(1)} fps at 1440p ` +
        `(bar ${PASS_FPS}). WebGL2 path.`,
    };
  }

  const webgl2Detail =
    webgl2MeanFps1440 === null
      ? 'the WebGL2 run produced no numbers'
      : `the WebGL2 run only held ${webgl2MeanFps1440.toFixed(1)} fps at 1440p`;
  return {
    decision: 'escalate',
    reason:
      `Neither backend cleared ${PASS_FPS} fps at 1440p: ${webgpuDetail}; ` +
      `${webgl2Detail}. ESCALATE.`,
  };
}
