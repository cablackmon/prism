/**
 * GPU capability gate — browser-side renderers and measurement loop.
 *
 * Draws the same translucent, additively-rimmed mesh through WebGL2 and (when
 * an adapter exists) WebGPU, at two internal resolutions, and reports frame
 * statistics for each. Pure logic — geometry, matrices, statistics, decision
 * rule — lives in `gpuBenchmark.ts` and is unit tested there.
 *
 * Both backends deliberately share:
 *   - the same vertex buffer and index buffer contents,
 *   - the same zero-to-one depth projection,
 *   - premultiplied `one / one-minus-src-alpha` blending with depth test and
 *     face culling off, so every triangle pays fill cost twice per silhouette
 *     exactly as a hologram shell would,
 *   - anti-aliasing off.
 * Anything that differed would make the two numbers incomparable, which is the
 * one thing this page exists to produce.
 */

import {
  BENCHMARK_DURATION_MS,
  CAMERA_DISTANCE,
  FIELD_OF_VIEW,
  MESH_ALPHA,
  WARMUP_FRAMES,
  modelViewMatrix,
  perspectiveZeroToOne,
  summarizeFrames,
  type BenchmarkResolution,
  type FrameStats,
  type Mesh,
  VERTEX_STRIDE_BYTES,
} from './gpuBenchmark';

const ALPHA_LITERAL = MESH_ALPHA.toFixed(2);

/** Amber hologram body and rim, matching the look0N direction closely enough to be representative. */
const BODY_COLOR = '0.98, 0.72, 0.35';
const RIM_COLOR = '1.00, 0.86, 0.60';
const RIM_GAIN = '1.5';

const YAW_RADIANS_PER_SECOND = 0.9;
const PITCH_RADIANS_PER_SECOND = 0.35;

// ---------------------------------------------------------------------------
// Shared renderer shape
// ---------------------------------------------------------------------------

type BenchRenderer = {
  resize(width: number, height: number): void;
  drawFrame(elapsedSeconds: number): void;
  /**
   * Resolves once the GPU has finished the work `drawFrame` submitted.
   *
   * This is load-bearing, not hygiene. Timing a plain requestAnimationFrame
   * cadence assumes the backend applies backpressure when the GPU falls behind.
   * WebGL2 does. WebGPU, measured here on 2026-09-22, does not: a SwiftShader
   * software adapter that managed 10.8 fps through WebGL2 at 2160p reported a
   * flat 60.0 fps through WebGPU at both resolutions, identical to the idle rAF
   * ceiling, because submissions simply queued and the loop measured the clock.
   * Phase 0 would have returned "WebGPU clears the bar" from a number that had
   * nothing to do with the GPU. Fencing every frame makes both backends report
   * work actually completed.
   */
  waitForGpuIdle(): Promise<void>;
  dispose(): void;
};

export type BackendKey = 'webgl2' | 'webgpu';

export type BackendRun = {
  resolution: BenchmarkResolution;
  stats: FrameStats;
  /** True when the document was hidden at any point during the run, which stalls rAF. */
  interruptedByVisibilityChange: boolean;
  /**
   * False when the GPU-completion wait rejected and the run continued without
   * it. The fps is then submission cadence, not completed work, and the
   * decision rule refuses to credit it.
   */
  gpuFenced: boolean;
  /** Verbatim rejection from the first failed GPU wait, when `gpuFenced` is false. */
  fenceError: string | null;
};

/**
 * Did the backend actually put the mesh on the canvas?
 *
 * Frame rate alone cannot tell a fast renderer from one that draws nothing:
 * a pipeline that silently produces no fragments is the *cheapest* thing a GPU
 * can do, so a broken backend reports the best number on the page and wins the
 * decision. `status` is deliberately three-valued — a readback that cannot run
 * is not evidence that the canvas was empty, and must not be treated as such.
 */
export type CanvasPixelCheck = {
  /** `blank` only when the readback succeeded AND found a single flat colour. */
  status: 'content' | 'blank' | 'unavailable';
  uniqueColors: number | null;
  meanLuma: number | null;
  /** Verbatim reason the readback could not run, when `status` is `unavailable`. */
  error: string | null;
};

export type BackendReport = {
  backend: BackendKey;
  available: boolean;
  /** Populated when the backend could not be initialised or a run threw. */
  error: string | null;
  runs: BackendRun[];
  /** Rendered-content verification, taken once after the timed runs. */
  pixelCheck: CanvasPixelCheck;
};

export type Webgl2Info = {
  /** `WEBGL_debug_renderer_info` UNMASKED_RENDERER_WEBGL — the string the plan asks for. */
  unmaskedRenderer: string | null;
  unmaskedVendor: string | null;
  /** Chromium now returns the real device from plain RENDERER; kept as a cross-check. */
  renderer: string | null;
  vendor: string | null;
  version: string | null;
  shadingLanguageVersion: string | null;
  maxTextureSize: number | null;
};

export type WebgpuInfo = {
  supported: boolean;
  adapterPresent: boolean;
  vendor: string | null;
  architecture: string | null;
  device: string | null;
  description: string | null;
  isFallbackAdapter: boolean | null;
  preferredCanvasFormat: string | null;
  error: string | null;
};

export type DisplayInfo = {
  devicePixelRatio: number;
  screenWidth: number;
  screenHeight: number;
  availWidth: number;
  availHeight: number;
  innerWidth: number;
  innerHeight: number;
  /** Physical pixels implied by CSS size x DPR — what the panel is actually asked to show. */
  physicalWidth: number;
  physicalHeight: number;
  colorDepth: number;
  refreshHz: number | null;
  userAgent: string;
};

// ---------------------------------------------------------------------------
// Capability probes
// ---------------------------------------------------------------------------

export function collectDisplayInfo(refreshHz: number | null): DisplayInfo {
  const dpr = window.devicePixelRatio;
  return {
    devicePixelRatio: dpr,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    availWidth: window.screen.availWidth,
    availHeight: window.screen.availHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    physicalWidth: Math.round(window.screen.width * dpr),
    physicalHeight: Math.round(window.screen.height * dpr),
    colorDepth: window.screen.colorDepth,
    refreshHz,
    userAgent: navigator.userAgent,
  };
}

export function collectWebgl2Info(): Webgl2Info {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    return {
      unmaskedRenderer: null,
      unmaskedVendor: null,
      renderer: null,
      vendor: null,
      version: null,
      shadingLanguageVersion: null,
      maxTextureSize: null,
    };
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const readString = (parameter: number): string | null => {
    const value: unknown = gl.getParameter(parameter);
    return typeof value === 'string' ? value : null;
  };

  const info: Webgl2Info = {
    unmaskedRenderer: debugInfo ? readString(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
    unmaskedVendor: debugInfo ? readString(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
    renderer: readString(gl.RENDERER),
    vendor: readString(gl.VENDOR),
    version: readString(gl.VERSION),
    shadingLanguageVersion: readString(gl.SHADING_LANGUAGE_VERSION),
    maxTextureSize:
      typeof gl.getParameter(gl.MAX_TEXTURE_SIZE) === 'number'
        ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)
        : null,
  };

  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return info;
}

export async function collectWebgpuInfo(): Promise<WebgpuInfo> {
  const empty: WebgpuInfo = {
    supported: false,
    adapterPresent: false,
    vendor: null,
    architecture: null,
    device: null,
    description: null,
    isFallbackAdapter: null,
    preferredCanvasFormat: null,
    error: null,
  };

  const gpu = navigator.gpu;
  if (!gpu) {
    return {
      ...empty,
      error: window.isSecureContext
        ? 'navigator.gpu is undefined (no WebGPU in this browser build)'
        : 'navigator.gpu is undefined because this page is not a secure context',
    };
  }

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return {
        ...empty,
        supported: true,
        preferredCanvasFormat: gpu.getPreferredCanvasFormat(),
        error: 'navigator.gpu exists but requestAdapter() returned null',
      };
    }

    // Chromium 128+ exposes the adapter `info` property synchronously; older
    // builds only had the async `requestAdapterInfo()`. Read whichever exists.
    const adapterInfo =
      adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : undefined);

    return {
      supported: true,
      adapterPresent: true,
      vendor: adapterInfo?.vendor ?? null,
      architecture: adapterInfo?.architecture ?? null,
      device: adapterInfo?.device ?? null,
      description: adapterInfo?.description ?? null,
      isFallbackAdapter: adapter.isFallbackAdapter ?? null,
      preferredCanvasFormat: gpu.getPreferredCanvasFormat(),
      error: null,
    };
  } catch (error) {
    return { ...empty, supported: true, error: describeError(error) };
  }
}

/**
 * Times a bare rAF loop so the report can say whether a ~60 fps result is the
 * GPU's ceiling or the panel's. Without this a vsync-capped 60.0 and a
 * GPU-limited 60.0 are indistinguishable, and the first is far better news.
 */
export function measureDisplayRefreshHz(durationMs = 1000): Promise<number | null> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let previous: number | null = null;
    let elapsed = 0;
    const tick = (now: number) => {
      if (previous !== null) {
        const delta = now - previous;
        intervals.push(delta);
        elapsed += delta;
      }
      previous = now;
      if (elapsed >= durationMs) {
        resolve(intervals.length > 0 ? summarizeFrames(intervals).meanFps : null);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ---------------------------------------------------------------------------
// WebGL2 renderer
// ---------------------------------------------------------------------------

const WEBGL2_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uModelView;
uniform mat4 uProjection;
out vec3 vNormal;
out vec3 vViewDir;
void main() {
  vec4 viewPosition = uModelView * vec4(aPosition, 1.0);
  // uModelView's upper-left 3x3 is a pure rotation, so it transforms normals directly.
  vNormal = mat3(uModelView) * aNormal;
  vViewDir = -viewPosition.xyz;
  gl_Position = uProjection * viewPosition;
}`;

const WEBGL2_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vViewDir;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vViewDir);
  float facing = abs(dot(n, v));
  float rim = pow(1.0 - facing, 3.0);
  vec3 body = vec3(${BODY_COLOR}) * (0.25 + 0.75 * facing);
  // Premultiplied output: the body is attenuated by alpha, the rim is not, so
  // the rim reads as an additive glow over whatever is behind it.
  vec3 premultiplied = body * ${ALPHA_LITERAL} + vec3(${RIM_COLOR}) * rim * ${RIM_GAIN};
  fragColor = vec4(premultiplied, ${ALPHA_LITERAL});
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('gl.createShader returned null');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function createWebgl2Renderer(canvas: HTMLCanvasElement, mesh: Mesh): BenchRenderer {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    desynchronized: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('canvas.getContext("webgl2") returned null');

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, WEBGL2_VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, WEBGL2_FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error('gl.createProgram returned null');
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(
      `program link failed: ${gl.getProgramInfoLog(program) ?? 'unknown link error'}`
    );
  }
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertexData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_STRIDE_BYTES, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VERTEX_STRIDE_BYTES, 12);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indexData, gl.STATIC_DRAW);

  const modelViewLocation = gl.getUniformLocation(program, 'uModelView');
  const projectionLocation = gl.getUniformLocation(program, 'uProjection');

  gl.useProgram(program);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0.02, 0.03, 0.06, 1);

  let projection = perspectiveZeroToOne(FIELD_OF_VIEW, 1, 0.1, 100);
  const indexCount = mesh.triangleCount * 3;

  return {
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      projection = perspectiveZeroToOne(FIELD_OF_VIEW, width / height, 0.1, 100);
    },
    drawFrame(elapsedSeconds) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniformMatrix4fv(
        modelViewLocation,
        false,
        modelViewMatrix(
          elapsedSeconds * YAW_RADIANS_PER_SECOND,
          Math.sin(elapsedSeconds * PITCH_RADIANS_PER_SECOND) * 0.4,
          CAMERA_DISTANCE
        )
      );
      gl.uniformMatrix4fv(projectionLocation, false, projection);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
    },
    async waitForGpuIdle() {
      // A blocking finish() rather than a fenceSync + clientWaitSync poll: the
      // poll would have to come back through setTimeout, whose nested clamp of
      // ~4 ms is a quarter of a 60 Hz frame and would depress the result.
      gl.finish();
    },
    dispose() {
      gl.deleteBuffer(vertexBuffer);
      gl.deleteBuffer(indexBuffer);
      gl.deleteVertexArray(vertexArray);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

// ---------------------------------------------------------------------------
// WebGPU renderer
// ---------------------------------------------------------------------------

const WEBGPU_SHADER = `
struct Uniforms {
  modelView : mat4x4<f32>,
  projection : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexOutput {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) normal : vec3<f32>,
  @location(1) viewDir : vec3<f32>,
};

@vertex
fn vertexMain(
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>
) -> VertexOutput {
  let viewPosition = uniforms.modelView * vec4<f32>(position, 1.0);
  var output : VertexOutput;
  output.clipPosition = uniforms.projection * viewPosition;
  // modelView's upper-left 3x3 is a pure rotation, so w = 0 transforms the normal.
  output.normal = (uniforms.modelView * vec4<f32>(normal, 0.0)).xyz;
  output.viewDir = -viewPosition.xyz;
  return output;
}

@fragment
fn fragmentMain(fragment : VertexOutput) -> @location(0) vec4<f32> {
  let n = normalize(fragment.normal);
  let v = normalize(fragment.viewDir);
  let facing = abs(dot(n, v));
  let rim = pow(1.0 - facing, 3.0);
  let body = vec3<f32>(${BODY_COLOR}) * (0.25 + 0.75 * facing);
  let premultiplied = body * ${ALPHA_LITERAL} + vec3<f32>(${RIM_COLOR}) * rim * ${RIM_GAIN};
  return vec4<f32>(premultiplied, ${ALPHA_LITERAL});
}`;

const UNIFORM_BUFFER_BYTES = 128; // two column-major mat4x4<f32>

async function createWebgpuRenderer(canvas: HTMLCanvasElement, mesh: Mesh): Promise<BenchRenderer> {
  const gpu = navigator.gpu;
  if (!gpu) throw new Error('navigator.gpu is undefined');

  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('requestAdapter() returned null');
  const device = await adapter.requestDevice();

  const context = canvas.getContext('webgpu') as unknown as WebGpuMinCanvasContext | null;
  if (!context) throw new Error('canvas.getContext("webgpu") returned null');

  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const shaderModule = device.createShaderModule({ code: WEBGPU_SHADER });

  const vertexBuffer = device.createBuffer({
    size: mesh.vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    label: 'diag-gpu-vertices',
  });
  device.queue.writeBuffer(vertexBuffer, 0, mesh.vertexData);

  const indexBuffer = device.createBuffer({
    size: mesh.indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    label: 'diag-gpu-indices',
  });
  device.queue.writeBuffer(indexBuffer, 0, mesh.indexData);

  const uniformBuffer = device.createBuffer({
    size: UNIFORM_BUFFER_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: 'diag-gpu-uniforms',
  });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
      buffers: [
        {
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const uniformData = new Float32Array(UNIFORM_BUFFER_BYTES / 4);
  let projection = perspectiveZeroToOne(FIELD_OF_VIEW, 1, 0.1, 100);
  const indexCount = mesh.triangleCount * 3;

  return {
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      projection = perspectiveZeroToOne(FIELD_OF_VIEW, width / height, 0.1, 100);
    },
    drawFrame(elapsedSeconds) {
      uniformData.set(
        modelViewMatrix(
          elapsedSeconds * YAW_RADIANS_PER_SECOND,
          Math.sin(elapsedSeconds * PITCH_RADIANS_PER_SECOND) * 0.4,
          CAMERA_DISTANCE
        ),
        0
      );
      uniformData.set(projection, 16);
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.02, g: 0.03, b: 0.06, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.setIndexBuffer(indexBuffer, 'uint32');
      pass.drawIndexed(indexCount);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    waitForGpuIdle() {
      return device.queue.onSubmittedWorkDone();
    },
    dispose() {
      vertexBuffer.destroy();
      indexBuffer.destroy();
      uniformBuffer.destroy();
      context.unconfigure();
      device.destroy();
    },
  };
}

// ---------------------------------------------------------------------------
// Measurement loop
// ---------------------------------------------------------------------------

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Downsample target for the readback — enough detail to see a lit sphere, cheap at 4K. */
const PIXEL_CHECK_WIDTH = 64;
const PIXEL_CHECK_HEIGHT = 36;

/**
 * Reads the canvas back through `createImageBitmap` and reports whether it
 * holds an image or a single flat colour.
 *
 * Call this immediately after a `drawFrame` + `waitForGpuIdle` pair and before
 * yielding to the compositor: a WebGL2 context without `preserveDrawingBuffer`
 * loses its drawing buffer once the frame is presented, and a check scheduled a
 * frame later would report a blank canvas for a perfectly healthy renderer.
 *
 * Environment note (measured 2026-09-22): headless Chromium on a SwiftShader
 * adapter returns all-zero pixels for *any* WebGPU canvas — a bare clear-to-red
 * with no shaders reads back black too. That is why `blank` is reported rather
 * than assumed fatal, and why the decision rule only refuses to credit a run
 * that is positively blank on hardware that can read itself back.
 */
export async function inspectCanvasPixels(canvas: HTMLCanvasElement): Promise<CanvasPixelCheck> {
  const unavailable = (error: unknown): CanvasPixelCheck => ({
    status: 'unavailable',
    uniqueColors: null,
    meanLuma: null,
    error: describeError(error),
  });

  try {
    if (typeof createImageBitmap !== 'function') {
      throw new Error('createImageBitmap is unavailable');
    }
    const bitmap = await createImageBitmap(canvas, {
      resizeWidth: PIXEL_CHECK_WIDTH,
      resizeHeight: PIXEL_CHECK_HEIGHT,
      resizeQuality: 'low',
    });
    const target = document.createElement('canvas');
    target.width = bitmap.width;
    target.height = bitmap.height;
    const context = target.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2d context for readback returned null');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();

    const { data } = context.getImageData(0, 0, target.width, target.height);
    const seen = new Set<number>();
    let lumaSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      seen.add((r << 16) | (g << 8) | b);
      lumaSum += (r + g + b) / 3;
    }
    const pixels = data.length / 4;
    return {
      // A correct frame carries the clear colour, the lit body and the rim, so
      // even a downsampled readback has many distinct colours. One colour means
      // the clear happened and nothing was drawn — or nothing happened at all.
      status: seen.size > 1 ? 'content' : 'blank',
      uniqueColors: seen.size,
      meanLuma: pixels > 0 ? lumaSum / pixels : null,
      error: null,
    };
  } catch (error) {
    return unavailable(error);
  }
}

function measureRun(renderer: BenchRenderer, resolution: BenchmarkResolution): Promise<BackendRun> {
  renderer.resize(resolution.width, resolution.height);

  return new Promise<BackendRun>((resolve, reject) => {
    const intervals: number[] = [];
    let warmupRemaining = WARMUP_FRAMES;
    let previous: number | null = null;
    let measuredMs = 0;
    let hidden = document.visibilityState === 'hidden';
    let gpuFenced = true;
    let fenceError: string | null = null;
    const start = performance.now();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') hidden = true;
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const finish = (run: BackendRun) => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      resolve(run);
    };
    const fail = (error: unknown) => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reject(error instanceof Error ? error : new Error(describeError(error)));
    };

    // The next frame is only scheduled once the GPU has drained, so the gap
    // between consecutive rAF timestamps contains the previous frame's full
    // draw-and-complete cost rather than just its submission cost.
    const schedule = () => requestAnimationFrame((now) => void tick(now));

    const tick = async (now: number) => {
      try {
        renderer.drawFrame((now - start) / 1000);
      } catch (error) {
        fail(error);
        return;
      }

      if (gpuFenced) {
        try {
          await renderer.waitForGpuIdle();
        } catch (error) {
          // Degrade rather than abandon the run: an un-fenceable backend still
          // has a number worth showing, it just stops being creditable. The
          // decision rule reads `gpuFenced`, so an un-fenced WebGPU result can
          // never be mistaken for proof that the GPU held the frame rate.
          gpuFenced = false;
          fenceError = describeError(error);
          intervals.length = 0;
          measuredMs = 0;
          previous = null;
          warmupRemaining = WARMUP_FRAMES;
        }
      }

      if (warmupRemaining > 0) {
        warmupRemaining -= 1;
        // Keep `previous` unset so the first measured interval spans two
        // steady-state frames rather than straddling the warm-up boundary.
        previous = null;
        schedule();
        return;
      }

      if (previous !== null) {
        const delta = now - previous;
        intervals.push(delta);
        measuredMs += delta;
      }
      previous = now;

      if (measuredMs >= BENCHMARK_DURATION_MS) {
        finish({
          resolution,
          stats: summarizeFrames(intervals),
          interruptedByVisibilityChange: hidden,
          gpuFenced,
          fenceError,
        });
        return;
      }
      schedule();
    };

    schedule();
  });
}

export type BackendFactory = {
  backend: BackendKey;
  create: (canvas: HTMLCanvasElement, mesh: Mesh) => BenchRenderer | Promise<BenchRenderer>;
};

export const WEBGL2_BACKEND: BackendFactory = { backend: 'webgl2', create: createWebgl2Renderer };
export const WEBGPU_BACKEND: BackendFactory = { backend: 'webgpu', create: createWebgpuRenderer };

/**
 * Runs one backend across every resolution, on a fresh canvas.
 *
 * A failure to initialise is reported rather than thrown: a board with no
 * WebGPU must still produce its WebGL2 numbers, because "WebGL2 cleared the
 * bar" is a shippable answer and "the page crashed" is not.
 */
export async function runBackend(
  factory: BackendFactory,
  mesh: Mesh,
  resolutions: readonly BenchmarkResolution[],
  mountCanvas: (canvas: HTMLCanvasElement) => void,
  onRunComplete?: (run: BackendRun) => void
): Promise<BackendReport> {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 9;
  mountCanvas(canvas);

  let renderer: BenchRenderer;
  try {
    renderer = await factory.create(canvas, mesh);
  } catch (error) {
    canvas.remove();
    return {
      backend: factory.backend,
      available: false,
      error: describeError(error),
      runs: [],
      pixelCheck: {
        status: 'unavailable',
        uniqueColors: null,
        meanLuma: null,
        error: 'backend never initialised',
      },
    };
  }

  const runs: BackendRun[] = [];
  let error: string | null = null;
  let pixelCheck: CanvasPixelCheck = {
    status: 'unavailable',
    uniqueColors: null,
    meanLuma: null,
    error: 'verification frame never ran',
  };
  try {
    for (const resolution of resolutions) {
      const run = await measureRun(renderer, resolution);
      runs.push(run);
      onRunComplete?.(run);
    }

    // Verification frame. Drawn at a small size — this checks that the pipeline
    // produces fragments, which is resolution-independent, and a 4K readback
    // would cost more than the thing it is checking. It must be its own draw
    // rather than a look at the last timed frame, because the readback has to
    // happen before the compositor takes the drawing buffer away.
    renderer.resize(PIXEL_CHECK_WIDTH * 4, PIXEL_CHECK_HEIGHT * 4);
    renderer.drawFrame(1);
    await renderer.waitForGpuIdle().catch(() => {
      // An un-fenceable backend is already recorded per-run; the readback below
      // still reports whatever reached the canvas.
    });
    pixelCheck = await inspectCanvasPixels(canvas);
  } catch (runError) {
    error = describeError(runError);
  } finally {
    try {
      renderer.dispose();
    } catch {
      // A disposal failure must not discard measurements that already succeeded.
    }
    canvas.remove();
  }

  return { backend: factory.backend, available: true, error, runs, pixelCheck };
}
