/**
 * Minimal ambient WebGPU declarations.
 *
 * TypeScript's `dom` lib does not yet ship WebGPU, and the only consumer in this
 * repo is the `/diag/gpu` capability gate (NOX-11768). Rather than add the
 * `@webgpu/types` dependency — which drags an unrelated `package-lock.json`
 * re-resolve into the diff — this declares exactly the surface that
 * `src/lib/diagnostics/gpuRenderers.ts` touches, and nothing else.
 *
 * These names are intentionally prefixed `WebGpuMin` rather than `GPUDevice`
 * etc. so that if `@webgpu/types` is ever added for a richer feature, the real
 * declarations win and this file can be deleted without a rename cascade. The
 * two exceptions are the `GPUBufferUsage` / `GPUShaderStage` flag namespaces,
 * which exist as real globals at runtime and are read, never constructed.
 */

type WebGpuMinAdapterInfo = {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
};

type WebGpuMinBuffer = {
  destroy(): void;
};

type WebGpuMinQueue = {
  /**
   * The spec's `GPUAllowSharedBufferSource`, which — unlike the DOM's
   * `BufferSource` — also admits views backed by a `SharedArrayBuffer`.
   */
  writeBuffer(
    buffer: WebGpuMinBuffer,
    offset: number,
    data: ArrayBufferView<ArrayBufferLike> | ArrayBufferLike
  ): void;
  submit(commandBuffers: readonly WebGpuMinCommandBuffer[]): void;
  onSubmittedWorkDone(): Promise<void>;
};

type WebGpuMinCommandBuffer = { readonly __brand?: 'GPUCommandBuffer' };

type WebGpuMinTextureView = { readonly __brand?: 'GPUTextureView' };

type WebGpuMinTexture = {
  createView(): WebGpuMinTextureView;
};

type WebGpuMinRenderPassEncoder = {
  setPipeline(pipeline: WebGpuMinRenderPipeline): void;
  setBindGroup(index: number, bindGroup: WebGpuMinBindGroup): void;
  setVertexBuffer(slot: number, buffer: WebGpuMinBuffer): void;
  setIndexBuffer(buffer: WebGpuMinBuffer, format: 'uint16' | 'uint32'): void;
  drawIndexed(indexCount: number): void;
  end(): void;
};

type WebGpuMinCommandEncoder = {
  beginRenderPass(descriptor: {
    colorAttachments: readonly {
      view: WebGpuMinTextureView;
      clearValue: { r: number; g: number; b: number; a: number };
      loadOp: 'clear' | 'load';
      storeOp: 'store' | 'discard';
    }[];
  }): WebGpuMinRenderPassEncoder;
  finish(): WebGpuMinCommandBuffer;
};

type WebGpuMinBindGroupLayout = { readonly __brand?: 'GPUBindGroupLayout' };

type WebGpuMinBindGroup = { readonly __brand?: 'GPUBindGroup' };

type WebGpuMinRenderPipeline = {
  getBindGroupLayout(index: number): WebGpuMinBindGroupLayout;
};

type WebGpuMinShaderModule = { readonly __brand?: 'GPUShaderModule' };

type WebGpuMinDevice = {
  readonly queue: WebGpuMinQueue;
  readonly lost: Promise<{ reason: string; message: string }>;
  createShaderModule(descriptor: { code: string }): WebGpuMinShaderModule;
  createBuffer(descriptor: { size: number; usage: number; label?: string }): WebGpuMinBuffer;
  createRenderPipeline(descriptor: {
    layout: 'auto';
    vertex: {
      module: WebGpuMinShaderModule;
      entryPoint: string;
      buffers: readonly {
        arrayStride: number;
        attributes: readonly { shaderLocation: number; offset: number; format: string }[];
      }[];
    };
    fragment: {
      module: WebGpuMinShaderModule;
      entryPoint: string;
      targets: readonly {
        format: string;
        blend?: {
          color: { srcFactor: string; dstFactor: string; operation: string };
          alpha: { srcFactor: string; dstFactor: string; operation: string };
        };
      }[];
    };
    primitive: { topology: 'triangle-list'; cullMode: 'none' | 'front' | 'back' };
  }): WebGpuMinRenderPipeline;
  createBindGroup(descriptor: {
    layout: WebGpuMinBindGroupLayout;
    entries: readonly { binding: number; resource: { buffer: WebGpuMinBuffer } }[];
  }): WebGpuMinBindGroup;
  createCommandEncoder(): WebGpuMinCommandEncoder;
  destroy(): void;
};

type WebGpuMinAdapter = {
  /** Present on Chromium 128+; older builds expose `requestAdapterInfo()` instead. */
  readonly info?: WebGpuMinAdapterInfo;
  readonly isFallbackAdapter?: boolean;
  requestAdapterInfo?: () => Promise<WebGpuMinAdapterInfo>;
  requestDevice(): Promise<WebGpuMinDevice>;
};

type WebGpuMinCanvasContext = {
  configure(descriptor: {
    device: WebGpuMinDevice;
    format: string;
    alphaMode: 'opaque' | 'premultiplied';
  }): void;
  unconfigure(): void;
  getCurrentTexture(): WebGpuMinTexture;
};

type WebGpuMinGpu = {
  requestAdapter(options?: {
    powerPreference?: 'low-power' | 'high-performance';
  }): Promise<WebGpuMinAdapter | null>;
  getPreferredCanvasFormat(): string;
};

// Must be an `interface`: adding `gpu` to the DOM's Navigator relies on
// declaration merging, which a type alias cannot do.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface Navigator {
  readonly gpu?: WebGpuMinGpu;
}

declare const GPUBufferUsage: {
  readonly VERTEX: number;
  readonly INDEX: number;
  readonly UNIFORM: number;
  readonly COPY_DST: number;
};

declare const GPUShaderStage: {
  readonly VERTEX: number;
  readonly FRAGMENT: number;
};
