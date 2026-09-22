import {
  BENCHMARK_RESOLUTIONS,
  CAMERA_DISTANCE,
  FIELD_OF_VIEW,
  PASS_FPS,
  TARGET_VERTEX_COUNT,
  VERTEX_STRIDE_FLOATS,
  chooseTessellation,
  createSphereMesh,
  decideRenderPath,
  isRenderedBlank,
  meanFpsAt,
  modelViewMatrix,
  perspectiveZeroToOne,
  summarizeFrames,
} from '../gpuBenchmark';

describe('chooseTessellation', () => {
  it('produces a grid at least as large as the requested vertex count', () => {
    for (const requested of [100_000, 4, 1_000, 250_000]) {
      const { segments, rings } = chooseTessellation(requested);
      expect((segments + 1) * (rings + 1)).toBeGreaterThanOrEqual(requested);
    }
  });

  it('keeps triangles roughly square rather than degenerating into slivers', () => {
    const { segments, rings } = chooseTessellation(TARGET_VERTEX_COUNT);
    expect(segments / rings).toBeGreaterThan(1);
    expect(segments / rings).toBeLessThan(2.5);
  });

  it('rejects a vertex count too small to tessellate', () => {
    expect(() => chooseTessellation(3)).toThrow(/minVertices/);
    expect(() => chooseTessellation(Number.NaN)).toThrow(/minVertices/);
  });
});

describe('createSphereMesh', () => {
  const mesh = createSphereMesh(TARGET_VERTEX_COUNT);

  it('carries at least the plan-mandated 100k vertices', () => {
    expect(mesh.vertexCount).toBeGreaterThanOrEqual(TARGET_VERTEX_COUNT);
  });

  it('sizes both buffers to match the reported counts', () => {
    expect(mesh.vertexData.length).toBe(mesh.vertexCount * VERTEX_STRIDE_FLOATS);
    expect(mesh.indexData.length).toBe(mesh.triangleCount * 3);
  });

  it('needs 32-bit indices, so every index still addresses a real vertex', () => {
    expect(mesh.vertexCount).toBeGreaterThan(0xffff);
    let maxIndex = 0;
    for (const index of mesh.indexData) {
      if (index > maxIndex) maxIndex = index;
    }
    expect(maxIndex).toBeLessThan(mesh.vertexCount);
  });

  it('places every vertex on the unit sphere with a matching unit normal', () => {
    for (let vertex = 0; vertex < mesh.vertexCount; vertex += 977) {
      const base = vertex * VERTEX_STRIDE_FLOATS;
      const x = mesh.vertexData[base] as number;
      const y = mesh.vertexData[base + 1] as number;
      const z = mesh.vertexData[base + 2] as number;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(mesh.vertexData[base + 3]).toBeCloseTo(x, 6);
      expect(mesh.vertexData[base + 4]).toBeCloseTo(y, 6);
      expect(mesh.vertexData[base + 5]).toBeCloseTo(z, 6);
    }
  });
});

describe('perspectiveZeroToOne', () => {
  // WebGPU clips to 0 <= z <= w. A GL-style [-1, 1] projection would clip the
  // near half of the mesh away on the WebGPU run only, making that backend look
  // faster than WebGL2 for a reason that has nothing to do with the GPU.
  const near = 0.1;
  const far = 100;
  const projection = perspectiveZeroToOne(FIELD_OF_VIEW, 16 / 9, near, far);

  const project = (viewZ: number) => {
    const clipZ = (projection[10] as number) * viewZ + (projection[14] as number);
    const clipW = (projection[11] as number) * viewZ;
    return clipZ / clipW;
  };

  it('maps the near plane to 0 and the far plane to 1', () => {
    expect(project(-near)).toBeCloseTo(0, 6);
    expect(project(-far)).toBeCloseTo(1, 6);
  });

  it('keeps the whole benchmark mesh inside the [0, 1] depth range', () => {
    // Unit-radius sphere centred at CAMERA_DISTANCE: nearest and farthest points.
    expect(project(-(CAMERA_DISTANCE - 1))).toBeGreaterThan(0);
    expect(project(-(CAMERA_DISTANCE + 1))).toBeLessThan(1);
  });

  it('applies the aspect correction to x only', () => {
    const wide = perspectiveZeroToOne(FIELD_OF_VIEW, 2, near, far);
    const square = perspectiveZeroToOne(FIELD_OF_VIEW, 1, near, far);
    expect(wide[0] as number).toBeCloseTo((square[0] as number) / 2, 6);
    expect(wide[5]).toBeCloseTo(square[5] as number, 6);
  });
});

describe('modelViewMatrix', () => {
  it('pushes the mesh down the view axis by the camera distance', () => {
    const matrix = modelViewMatrix(0.7, -0.2, CAMERA_DISTANCE);
    expect(matrix[12]).toBe(0);
    expect(matrix[13]).toBe(0);
    expect(matrix[14]).toBe(-CAMERA_DISTANCE);
    expect(matrix[15]).toBe(1);
  });

  it('keeps the upper-left 3x3 orthonormal, so it also transforms normals', () => {
    const matrix = modelViewMatrix(1.1, 0.4, CAMERA_DISTANCE);
    const columns = [
      [matrix[0] as number, matrix[1] as number, matrix[2] as number],
      [matrix[4] as number, matrix[5] as number, matrix[6] as number],
      [matrix[8] as number, matrix[9] as number, matrix[10] as number],
    ];
    for (const column of columns) {
      expect(Math.hypot(column[0] as number, column[1] as number, column[2] as number)).toBeCloseTo(
        1,
        6
      );
    }
    const dot = (a: number[], b: number[]) =>
      (a[0] as number) * (b[0] as number) +
      (a[1] as number) * (b[1] as number) +
      (a[2] as number) * (b[2] as number);
    expect(dot(columns[0] as number[], columns[1] as number[])).toBeCloseTo(0, 6);
    expect(dot(columns[1] as number[], columns[2] as number[])).toBeCloseTo(0, 6);
    expect(dot(columns[0] as number[], columns[2] as number[])).toBeCloseTo(0, 6);
  });
});

describe('summarizeFrames', () => {
  it('reports frames over wall time, not the mean of per-frame rates', () => {
    // Nine 10 ms frames and one 910 ms stall: 10 frames in 1000 ms is 10 fps.
    // Averaging per-frame rates would claim (9 * 100 + 1.1) / 10 ≈ 90 fps.
    const intervals = [...Array<number>(9).fill(10), 910];
    const stats = summarizeFrames(intervals);
    expect(stats.frames).toBe(10);
    expect(stats.elapsedMs).toBeCloseTo(1000, 6);
    expect(stats.meanFps).toBeCloseTo(10, 6);
  });

  it('derives min fps from the longest single frame', () => {
    const stats = summarizeFrames([16, 16, 50, 16]);
    expect(stats.longestFrameMs).toBe(50);
    expect(stats.minFps).toBeCloseTo(20, 6);
  });

  it('returns zeros rather than NaN for an empty run', () => {
    const stats = summarizeFrames([]);
    expect(stats).toEqual({
      frames: 0,
      elapsedMs: 0,
      meanFps: 0,
      minFps: 0,
      longestFrameMs: 0,
    });
  });
});

describe('meanFpsAt', () => {
  const runs = [
    { resolution: { key: '1440p' as const }, stats: { meanFps: 58.2 } },
    { resolution: { key: '2160p' as const }, stats: { meanFps: 31.4 } },
  ];

  it('selects the run for the requested resolution', () => {
    expect(meanFpsAt(runs, '1440p')).toBeCloseTo(58.2, 6);
    expect(meanFpsAt(runs, '2160p')).toBeCloseTo(31.4, 6);
  });

  it('returns null when the resolution was never measured', () => {
    expect(meanFpsAt([], '1440p')).toBeNull();
  });

  it('treats a zero or non-finite mean as no measurement', () => {
    expect(
      meanFpsAt([{ resolution: { key: '1440p' }, stats: { meanFps: 0 } }], '1440p')
    ).toBeNull();
    expect(
      meanFpsAt([{ resolution: { key: '1440p' }, stats: { meanFps: Number.NaN } }], '1440p')
    ).toBeNull();
  });
});

describe('isRenderedBlank', () => {
  it('discredits a run only when the readback positively found a flat canvas', () => {
    expect(isRenderedBlank({ status: 'blank' })).toBe(true);
  });

  it('does not discredit a run whose canvas could not be read back', () => {
    // Headless SwiftShader returns all-zero pixels for any WebGPU canvas, so
    // treating 'unavailable' as blank would veto a healthy backend on the
    // strength of a broken measuring tool.
    expect(isRenderedBlank({ status: 'unavailable' })).toBe(false);
    expect(isRenderedBlank(undefined)).toBe(false);
    expect(isRenderedBlank(null)).toBe(false);
  });

  it('does not discredit a run that rendered content', () => {
    expect(isRenderedBlank({ status: 'content' })).toBe(false);
  });
});

describe('decideRenderPath', () => {
  it('chooses WebGPU when an adapter is present and its own 1440p run clears the bar', () => {
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpuMeanFps1440: PASS_FPS,
      webgpuMeasurementFenced: true,
      webgpuRenderedBlank: false,
      webgl2MeanFps1440: 20,
    });
    expect(result.decision).toBe('webgpu');
    expect(result.reason).toContain('Browser WebGPU path');
  });

  it('does not credit WebGPU for a WebGL2 measurement when its own run produced nothing', () => {
    // An adapter that exists but could not be benchmarked is not evidence that
    // the WebGPU path holds 45 fps.
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpuMeanFps1440: null,
      webgpuMeasurementFenced: false,
      webgpuRenderedBlank: false,
      webgl2MeanFps1440: 58,
    });
    expect(result.decision).toBe('webgl2');
    expect(result.reason).toContain('produced no numbers');
  });

  it('does not credit an un-fenced WebGPU run that appears to clear the bar', () => {
    // The only case where the adapter is real, the fps reading is enormous, and
    // the answer is still "not WebGPU". Without a completion fence the frame
    // loop times submissions queued rather than work finished, so the number is
    // not evidence about the GPU no matter how large it is.
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpuMeanFps1440: 240,
      webgpuMeasurementFenced: false,
      webgpuRenderedBlank: false,
      webgl2MeanFps1440: PASS_FPS,
    });
    expect(result.decision).toBe('webgl2');
    expect(result.reason).toContain('counts submissions queued, not work done');
  });

  it('escalates on an un-fenced WebGPU run when WebGL2 also misses the bar', () => {
    // The un-fenced reading must not rescue the escalation either, and whoever
    // reads the ESCALATE line has to be told why the large WebGPU number
    // sitting in the JSON beside it was discarded.
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpuMeanFps1440: 240,
      webgpuMeasurementFenced: false,
      webgpuRenderedBlank: false,
      webgl2MeanFps1440: PASS_FPS - 0.1,
    });
    expect(result.decision).toBe('escalate');
    expect(result.reason).toContain('ESCALATE');
    expect(result.reason).toContain('submissions queued');
  });

  it('does not credit a fenced WebGPU run whose canvas read back blank', () => {
    // A pipeline that emits no fragments is the cheapest thing a GPU can do, so
    // a blank run posts the highest fps on the page. Everything else about this
    // input passes: real adapter, fenced measurement, way over the bar.
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpuMeanFps1440: 300,
      webgpuMeasurementFenced: true,
      webgpuRenderedBlank: true,
      webgl2MeanFps1440: PASS_FPS,
    });
    expect(result.decision).toBe('webgl2');
    expect(result.reason).toContain('read back blank');
  });

  it('still credits a WebGPU run when the canvas could not be read back at all', () => {
    // "We could not look" is not "we looked and it was empty" — headless
    // SwiftShader returns all-zero pixels for any WebGPU canvas, and treating
    // that as blank would veto a healthy backend on measurement-tool grounds.
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpuMeanFps1440: 90,
      webgpuMeasurementFenced: true,
      webgpuRenderedBlank: false,
      webgl2MeanFps1440: 50,
    });
    expect(result.decision).toBe('webgpu');
  });

  it('falls back to WebGL2 when the WebGPU run is below the bar', () => {
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpuMeanFps1440: PASS_FPS - 0.1,
      webgpuMeasurementFenced: true,
      webgpuRenderedBlank: false,
      webgl2MeanFps1440: PASS_FPS,
    });
    expect(result.decision).toBe('webgl2');
    expect(result.reason).toContain('44.9');
  });

  it('falls back to WebGL2 when there is no adapter at all', () => {
    const result = decideRenderPath({
      webgpuAdapterPresent: false,
      webgpuMeanFps1440: null,
      webgpuMeasurementFenced: false,
      webgpuRenderedBlank: false,
      webgl2MeanFps1440: 60,
    });
    expect(result.decision).toBe('webgl2');
    expect(result.reason).toContain('no WebGPU adapter');
  });

  it('escalates when WebGL2 is below the bar', () => {
    const result = decideRenderPath({
      webgpuAdapterPresent: false,
      webgpuMeanFps1440: null,
      webgpuMeasurementFenced: false,
      webgpuRenderedBlank: false,
      webgl2MeanFps1440: PASS_FPS - 0.1,
    });
    expect(result.decision).toBe('escalate');
    expect(result.reason).toContain('ESCALATE');
  });

  it('escalates when neither backend produced any numbers', () => {
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpuMeanFps1440: null,
      webgpuMeasurementFenced: false,
      webgpuRenderedBlank: false,
      webgl2MeanFps1440: null,
    });
    expect(result.decision).toBe('escalate');
    expect(result.reason).toContain('no numbers');
  });

  it('ignores a WebGPU fps reading when no adapter was reported', () => {
    // Guards against a caller that keeps a stale fps around after the adapter
    // probe failed: adapter presence is the gate, not the number beside it.
    const result = decideRenderPath({
      webgpuAdapterPresent: false,
      webgpuMeanFps1440: 120,
      webgpuMeasurementFenced: true,
      webgpuRenderedBlank: false,
      webgl2MeanFps1440: 50,
    });
    expect(result.decision).toBe('webgl2');
  });
});

describe('BENCHMARK_RESOLUTIONS', () => {
  it('measures exactly the two internal resolutions the plan names', () => {
    expect(BENCHMARK_RESOLUTIONS.map((entry) => [entry.width, entry.height])).toEqual([
      [2560, 1440],
      [3840, 2160],
    ]);
  });
});
