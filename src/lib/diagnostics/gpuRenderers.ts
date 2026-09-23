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
  CLEAR_COLOR,
  FIELD_OF_VIEW,
  GATE_RESOLUTION_KEY,
  MESH_ALPHA,
  WARMUP_FRAMES,
  classifyReadback,
  classifyReadbackControl,
  modelViewMatrix,
  perspectiveZeroToOne,
  summarizeFrames,
  type BenchmarkResolution,
  type FrameStats,
  type Mesh,
  type PixelCheckStatus,
  type ReadbackControl,
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

export type BenchRenderer = {
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
  /**
   * The drawing buffer the GPU actually allocated, which is not necessarily the
   * one `resize` asked for: a 3840x2160 request can be clamped by the
   * implementation's maximum, and the run would then report the frame rate of a
   * smaller surface under a 2160p label. `null` means the size could not be
   * read — not evidence that it was clamped.
   */
  drawingBufferSize(): { width: number | null; height: number | null };
  /**
   * Clears the canvas and ends the frame without binding the mesh pipeline or
   * drawing geometry. Reading this back is independent evidence about whether
   * the readback mechanism works, because its expected pixels are CLEAR_COLOR
   * no matter what is wrong with the rendering path.
   */
  drawControlFrame(): void;
  /** Adapter strings read from the context that is doing the drawing. */
  describeAdapter(): string | null;
  dispose(): void;
};

/** The minimal renderer surface the readback control needs. */
type BenchRendererLike = Pick<BenchRenderer, 'drawControlFrame' | 'waitForGpuIdle'>;

export type BackendKey = 'webgl2' | 'webgpu';

export type BackendRun = {
  resolution: BenchmarkResolution;
  stats: FrameStats;
  /** Wall time the run occupied, as against `stats.elapsedMs`, which is GPU time. */
  wallElapsedMs: number;
  /** True when the document was hidden at any point during the run, which stalls the loop. */
  interruptedByVisibilityChange: boolean;
  /**
   * False when the GPU-completion wait rejected and the run continued without
   * it. The fps is then submission cadence, not completed work, and the
   * decision rule refuses to credit it.
   */
  gpuFenced: boolean;
  /** Verbatim rejection from the first failed GPU wait, when `gpuFenced` is false. */
  fenceError: string | null;
  /**
   * Verification taken at *this* resolution, immediately after its timed
   * frames. Per-run rather than once per backend: a single check at a small
   * size cannot speak for a 2160p buffer the implementation may have clamped or
   * failed to allocate, and that is precisely the case where the fps inflates.
   */
  pixelCheck: CanvasPixelCheck;
  /**
   * The clear-only control taken at this resolution, after the resize and
   * before the timed frames. Per-run because a readback path can work on the
   * 16x9 canvas and fail only after the 3840x2160 allocation — and it is this
   * value that decides whether an unreadable canvas is creditable.
   */
  readbackControl: ReadbackControl;
  /** What was asked for against what the implementation actually allocated. */
  drawingBuffer: {
    requestedWidth: number;
    requestedHeight: number;
    actualWidth: number | null;
    actualHeight: number | null;
  };
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
  /** `blank` only when the readback succeeded AND found a single non-black flat colour. */
  status: PixelCheckStatus;
  uniqueColors: number | null;
  meanLuma: number | null;
  /** Verbatim reason the readback could not run or could not be trusted. */
  error: string | null;
};

export type BackendReport = {
  backend: BackendKey;
  available: boolean;
  /** Populated when the backend could not be initialised or a run threw. */
  error: string | null;
  runs: BackendRun[];
  /**
   * The adapter as named by the context that actually drew, so the renderer
   * string in this report cannot describe a different GPU from the fps.
   */
  benchmarkedAdapter: string | null;
  /**
   * What the clear-only control frame proved about readback on this backend.
   * Recorded because it is the reason an all-zero benchmark frame was or was
   * not credited — without it, a reader cannot tell a healthy backend with a
   * broken readback from one that simply drew nothing.
   */
  readbackControl: ReadbackControl;
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

/**
 * The one set of context attributes used for *both* the capability probe and
 * the benchmark.
 *
 * Shared rather than duplicated because `powerPreference` participates in GPU
 * selection: on a hybrid-GPU machine a default-preference probe context and a
 * `high-performance` benchmark context can land on different adapters, and the
 * report would then print the integrated GPU's renderer string above the
 * discrete GPU's frame rate — a mismatch nothing on the page could reveal.
 * `readWebgl2Info` is additionally called against the benchmark context itself
 * so the reported adapter is the measured adapter by construction.
 */
export const WEBGL2_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  desynchronized: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
};

const EMPTY_WEBGL2_INFO: Webgl2Info = {
  unmaskedRenderer: null,
  unmaskedVendor: null,
  renderer: null,
  vendor: null,
  version: null,
  shadingLanguageVersion: null,
  maxTextureSize: null,
};

/** Reads the adapter strings out of a live context — the one that did the drawing. */
export function readWebgl2Info(gl: WebGL2RenderingContext): Webgl2Info {
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const readString = (parameter: number): string | null => {
    const value: unknown = gl.getParameter(parameter);
    return typeof value === 'string' ? value : null;
  };
  const maxTextureSize: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  return {
    unmaskedRenderer: debugInfo ? readString(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
    unmaskedVendor: debugInfo ? readString(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
    renderer: readString(gl.RENDERER),
    vendor: readString(gl.VENDOR),
    version: readString(gl.VERSION),
    shadingLanguageVersion: readString(gl.SHADING_LANGUAGE_VERSION),
    maxTextureSize: typeof maxTextureSize === 'number' ? maxTextureSize : null,
  };
}

export function collectWebgl2Info(): Webgl2Info {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext('webgl2', WEBGL2_CONTEXT_ATTRIBUTES);
  if (!gl) return EMPTY_WEBGL2_INFO;

  const info = readWebgl2Info(gl);
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
  const gl = canvas.getContext('webgl2', WEBGL2_CONTEXT_ATTRIBUTES);
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
  gl.clearColor(CLEAR_COLOR.r, CLEAR_COLOR.g, CLEAR_COLOR.b, 1);

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
    drawControlFrame() {
      // Clear only — no shader, no pipeline, no geometry. That is the whole
      // point: this frame's expected pixels are CLEAR_COLOR no matter what is
      // wrong with the mesh path, so reading it back tells us whether readback
      // works *independently* of whether rendering works.
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    async waitForGpuIdle() {
      // A blocking finish() rather than a fenceSync + clientWaitSync poll: the
      // poll would have to come back through setTimeout, whose nested clamp of
      // ~4 ms is a quarter of a 60 Hz frame and would depress the result.
      gl.finish();
    },
    drawingBufferSize() {
      // Not canvas.width/height — those echo back whatever was assigned. These
      // two are what the implementation actually allocated after any clamping.
      return { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
    },
    describeAdapter() {
      const info = readWebgl2Info(gl);
      return info.unmaskedRenderer ?? info.renderer;
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

  const adapterInfo =
    adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : undefined);

  // Recorded from the texture actually rendered into, rather than from
  // canvas.width: the swap-chain texture is what the implementation allocated,
  // and a clamped one is how an inflated "2160p" number gets produced.
  let renderedWidth: number | null = null;
  let renderedHeight: number | null = null;

  return {
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      renderedWidth = null;
      renderedHeight = null;
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
      const texture = context.getCurrentTexture();
      renderedWidth = typeof texture.width === 'number' ? texture.width : null;
      renderedHeight = typeof texture.height === 'number' ? texture.height : null;
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: texture.createView(),
            clearValue: { ...CLEAR_COLOR, a: 1 },
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
    drawControlFrame() {
      // A render pass that clears and ends without binding the pipeline. It
      // shares nothing with the mesh path except the device and the swap chain,
      // so if this reads back as CLEAR_COLOR the readback mechanism works, and
      // an all-zero *benchmark* frame is a rendering failure rather than a
      // readback one. That is the distinction the P1 turns on.
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { ...CLEAR_COLOR, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    waitForGpuIdle() {
      return device.queue.onSubmittedWorkDone();
    },
    drawingBufferSize() {
      return { width: renderedWidth, height: renderedHeight };
    },
    describeAdapter() {
      const parts = [adapterInfo?.vendor, adapterInfo?.architecture, adapterInfo?.device]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(' / ');
      return parts || (adapterInfo?.description ?? null);
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
type CanvasSample = {
  uniqueColors: number;
  flatColor: { r: number; g: number; b: number } | null;
  meanLuma: number | null;
};

/**
 * Reads the canvas back and reduces it to the three facts the classifiers need.
 * Extracted so the clear-only control frame and the benchmark frame go through
 * exactly the same readback path — a control read a different way would not be
 * evidence about the benchmark's readback.
 */
async function sampleCanvas(canvas: HTMLCanvasElement): Promise<CanvasSample> {
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
  let firstR: number | null = null;
  let firstG: number | null = null;
  let firstB: number | null = null;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    if (firstR === null) {
      firstR = r;
      firstG = g;
      firstB = b;
    }
    seen.add((r << 16) | (g << 8) | b);
    lumaSum += (r + g + b) / 3;
  }
  const pixels = data.length / 4;
  return {
    uniqueColors: seen.size,
    flatColor: firstR === null ? null : { r: firstR, g: firstG as number, b: firstB as number },
    meanLuma: pixels > 0 ? lumaSum / pixels : null,
  };
}

/**
 * Draws the clear-only control frame and reports what it proves about readback.
 *
 * Run once per *resolution*, immediately after the resize and before the timed
 * frames, so the surface it validates is the same size as the one the benchmark
 * frame will be read from. A control taken on the 16x9 canvas cannot speak for
 * a readback path that only fails after a 3840x2160 allocation.
 *
 * `broken` is a positive claim — "the readback mechanism is the faulty part" —
 * and it is the claim that makes an all-zero benchmark frame creditable, so it
 * is only returned on evidence:
 *
 *   - A throw means the control was never observed at all. That is `untested`.
 *     Returning `broken` here would have the control convict the readback on
 *     the strength of its own failure, and a transient `createImageBitmap`
 *     throw would then license the mesh path to be credited while drawing
 *     nothing.
 *   - A fence rejection means the clear was never confirmed to have executed,
 *     so a black read afterwards may be the *submission* that failed rather
 *     than the readback. Also `untested`. The positive direction still stands:
 *     if real pixels came back, readback demonstrably works whatever the fence
 *     did.
 */
export async function probeReadbackControl(
  renderer: BenchRendererLike,
  canvas: HTMLCanvasElement,
  // Seam for the branches a headless test environment cannot produce: jsdom has
  // no `createImageBitmap`, so the real sampler can only ever throw there. The
  // production call sites pass two arguments and take the default, and the
  // throw branch — the one that regressed — is covered against the real
  // sampler rather than this one.
  sample: (target: HTMLCanvasElement) => Promise<CanvasSample> = sampleCanvas
): Promise<ReadbackControl> {
  let clearConfirmed = true;
  try {
    renderer.drawControlFrame();
    try {
      await renderer.waitForGpuIdle();
    } catch {
      clearConfirmed = false;
    }
    const observed = await sample(canvas);
    const verdict = classifyReadbackControl(observed.uniqueColors, observed.flatColor);
    if (verdict === 'broken' && !clearConfirmed) return 'untested';
    return verdict;
  } catch {
    return 'untested';
  }
}

export async function inspectCanvasPixels(
  canvas: HTMLCanvasElement,
  control: ReadbackControl = 'untested'
): Promise<CanvasPixelCheck> {
  const unavailable = (error: unknown): CanvasPixelCheck => ({
    status: 'unavailable',
    uniqueColors: null,
    meanLuma: null,
    error: describeError(error),
  });

  try {
    const sample = await sampleCanvas(canvas);
    // A correct frame carries the clear colour, the lit body and the rim, so
    // even a downsampled readback has many distinct colours. One colour is
    // ambiguous between "nothing was drawn" and "nothing could be read", and
    // the clear-only control decides which, because its expected pixels do not
    // depend on the rendering path being healthy.
    const verdict = classifyReadback(sample.uniqueColors, sample.flatColor, control);
    return {
      status: verdict.status,
      uniqueColors: sample.uniqueColors,
      meanLuma: sample.meanLuma,
      error: verdict.note,
    };
  } catch (error) {
    return unavailable(error);
  }
}

/**
 * Hands control back to the event loop for one task.
 *
 * `setTimeout(0)` would be the obvious choice and is wrong here: nested
 * timeouts are clamped to ~4 ms, a quarter of a 60 Hz frame, which would be
 * paid between every pair of frames. A `MessageChannel` round trip is a real
 * task with no clamp, so the compositor and React still get their turn while
 * the run keeps the GPU busy.
 */
function yieldToEventLoop(port: MessagePort, target: MessagePort): Promise<void> {
  return new Promise((resolve) => {
    port.onmessage = () => resolve();
    target.postMessage(null);
  });
}

/**
 * Measures one backend at one resolution, then verifies that it drew something
 * *at that resolution* before the numbers are handed on.
 *
 * Two deliberate departures from the obvious requestAnimationFrame loop:
 *
 * 1. **The recorded cost is draw-to-fence, not rAF-to-rAF.** Because the next
 *    frame can only be scheduled once the fence resolves, an rAF-paced loop
 *    quantises every result to the display cadence: a frame genuinely costing
 *    17 ms misses the next 60 Hz callback and lands on the one after, recording
 *    33 ms. A GPU sustaining 58 fps would report 30, and the plan's 45 fps bar
 *    would silently have become a 60 fps bar — the gate would fail hardware
 *    that comfortably clears it.
 * 2. **Frames run back to back rather than once per refresh.** Following from
 *    the above, waiting for a vsync boundary between frames only adds idle time
 *    that is excluded from the measurement anyway, and would stretch a 10 s
 *    sample over a minute or more of wall clock on a fast GPU.
 *
 * The cost this reports is therefore the GPU's own frame time with the CPU/GPU
 * overlap of a pipelined renderer deliberately removed — a real renderer that
 * does not fence every frame has *more* headroom than these numbers, not less.
 */
async function measureRun(
  renderer: BenchRenderer,
  canvas: HTMLCanvasElement,
  resolution: BenchmarkResolution,
  signal?: AbortSignal
): Promise<BackendRun> {
  renderer.resize(resolution.width, resolution.height);

  // Taken here, after the resize and before any timed frame, so it validates a
  // surface the same size as the one the verification frame is read from. Run
  // once per backend on the 16x9 canvas — as this was — its verdict would be
  // reused across both resolutions, and a readback that works on a tiny surface
  // but returns zeroes after the 4K allocation would be misclassified in the
  // creditable direction.
  const readbackControl = await probeReadbackControl(renderer, canvas);

  const channel = new MessageChannel();
  const intervals: number[] = [];
  let warmupRemaining = WARMUP_FRAMES;
  let hidden = document.visibilityState === 'hidden';
  let gpuFenced = true;
  let fenceError: string | null = null;

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') hidden = true;
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const start = performance.now();
  // Set once warm-up ends, so the 10 s budget is 10 s of *measurement*. Timing
  // it from the first warm-up frame instead would let a slow backend — the one
  // whose numbers matter most — spend its whole budget on shader compilation
  // and the first 4K allocation, and return a run with no measured frames at
  // all, which the gate reads as "produced no numbers".
  let measureStart: number | null = null;
  try {
    for (;;) {
      const frameStart = performance.now();
      renderer.drawFrame((frameStart - start) / 1000);

      if (gpuFenced) {
        try {
          await renderer.waitForGpuIdle();
        } catch (error) {
          // Degrade rather than abandon the run: an un-fenceable backend still
          // has a number worth showing, it just stops being creditable. The
          // decision rule reads `gpuFenced`, so an un-fenced result can never be
          // mistaken for proof that the GPU held the frame rate.
          gpuFenced = false;
          fenceError = describeError(error);
          intervals.length = 0;
          warmupRemaining = WARMUP_FRAMES;
          measureStart = null;
        }
      }
      const frameCostMs = performance.now() - frameStart;

      if (warmupRemaining > 0) {
        warmupRemaining -= 1;
      } else {
        if (measureStart === null) measureStart = frameStart;
        intervals.push(frameCostMs);
        if (performance.now() - measureStart >= BENCHMARK_DURATION_MS) break;
      }

      await yieldToEventLoop(channel.port1, channel.port2);

      // Checked once per frame, between submissions, so an abandoned page stops
      // at a frame boundary instead of running four measurement loops into
      // detached canvases. Thrown rather than broken out of: a partial run must
      // not reach the gate, and `runBackend` records the abort as the reason
      // this backend has no numbers.
      if (signal?.aborted) throw new BenchmarkCancelledError();
    }

    // Verification frame, drawn at the resolution just measured and read back
    // before anything else touches the canvas. Checking only a small frame
    // after the fact — as this did originally — cannot see a 2560x1440 buffer
    // the implementation clamped or failed to allocate, and that is exactly the
    // case where the timed draws become cheap and the fps inflates.
    renderer.drawFrame(1);
    try {
      await renderer.waitForGpuIdle();
    } catch (error) {
      // Recorded, not swallowed. A device lost after the last timed frame
      // rejects here and nowhere else; leaving `gpuFenced` true would let a run
      // whose verification submission never completed be credited on the
      // strength of a readback that can only be showing the *previous* frame.
      gpuFenced = false;
      fenceError = describeError(error);
    }
    const drawingBufferSize = renderer.drawingBufferSize();
    const pixelCheck = await inspectCanvasPixels(canvas, readbackControl);

    return {
      resolution,
      stats: summarizeFrames(intervals),
      wallElapsedMs: performance.now() - start,
      interruptedByVisibilityChange: hidden,
      gpuFenced,
      fenceError,
      pixelCheck,
      readbackControl,
      drawingBuffer: {
        requestedWidth: resolution.width,
        requestedHeight: resolution.height,
        actualWidth: drawingBufferSize.width,
        actualHeight: drawingBufferSize.height,
      },
    };
  } finally {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    channel.port1.close();
    channel.port2.close();
  }
}

/**
 * Thrown when an abort signal fires mid-run, and distinguishable on purpose.
 *
 * A cancelled run and a failed one look identical once both are reduced to a
 * string, and the caller must treat them differently: a failure is reportable,
 * a cancellation means the numbers are incomplete and nothing may be published
 * from them.
 */
export class BenchmarkCancelledError extends Error {
  constructor() {
    super('benchmark cancelled');
    this.name = 'BenchmarkCancelledError';
  }
}

export function isBenchmarkCancelled(error: unknown): error is BenchmarkCancelledError {
  return error instanceof BenchmarkCancelledError;
}

/**
 * The control that belongs to the resolution the gate actually reads.
 *
 * The per-run controls are the ones that decide creditability; this is the
 * backend-level summary shown on screen, and it names the gate resolution so a
 * reader is never shown a 2160p control next to a decision made at 1440p.
 */
function gateReadbackControl(runs: readonly BackendRun[]): ReadbackControl {
  const gate = runs.find((run) => run.resolution.key === GATE_RESOLUTION_KEY);
  return (gate ?? runs[0])?.readbackControl ?? 'untested';
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
  onRunComplete?: (run: BackendRun) => void,
  signal?: AbortSignal
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
      benchmarkedAdapter: null,
      readbackControl: 'untested',
    };
  }

  const runs: BackendRun[] = [];
  let error: string | null = null;
  let benchmarkedAdapter: string | null = null;
  try {
    benchmarkedAdapter = renderer.describeAdapter();
    for (const resolution of resolutions) {
      if (signal?.aborted) throw new BenchmarkCancelledError();
      const run = await measureRun(renderer, canvas, resolution, signal);
      runs.push(run);
      onRunComplete?.(run);
    }
  } catch (runError) {
    // Cancellation is not a backend failure and must not be flattened into
    // `report.error`. Swallowed here — as this did — the caller sees an ordinary
    // report, never enters its cancellation-aware catch, goes on to run the
    // remaining backend and publishes a "complete" decision built from a
    // half-finished measurement. If the abort landed during the 2160p run, the
    // retained 1440p run is enough to make that decision look creditable.
    // `finally` below still disposes the renderer before this propagates.
    if (isBenchmarkCancelled(runError)) throw runError;
    error = describeError(runError);
  } finally {
    try {
      renderer.dispose();
    } catch {
      // A disposal failure must not discard measurements that already succeeded.
    }
    canvas.remove();
  }

  return {
    backend: factory.backend,
    available: true,
    error,
    runs,
    benchmarkedAdapter,
    readbackControl: gateReadbackControl(runs),
  };
}
