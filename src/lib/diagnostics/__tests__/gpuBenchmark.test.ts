import {
  BENCHMARK_RESOLUTIONS,
  CAMERA_DISTANCE,
  CLEAR_COLOR,
  FIELD_OF_VIEW,
  PASS_FPS,
  TARGET_VERTEX_COUNT,
  VERTEX_STRIDE_FLOATS,
  backendEvidenceAt,
  chooseTessellation,
  classifyReadback,
  classifyResolution,
  createSphereMesh,
  decideRenderPath,
  isRenderedBlank,
  meanFpsAt,
  modelViewMatrix,
  perspectiveZeroToOne,
  summarizeFrames,
  type BackendEvidence,
  type EvidenceRun,
} from '../gpuBenchmark';

/** A backend whose run is valid in every respect; each test spoils one thing. */
const evidence = (overrides: Partial<BackendEvidence> = {}): BackendEvidence => ({
  meanFps: 60,
  measurementFenced: true,
  renderedBlank: false,
  resolutionStatus: 'matched',
  sampleInvalidReason: null,
  ...overrides,
});

const noRun = (): BackendEvidence => evidence({ meanFps: null, measurementFenced: false });

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
      webgpu: evidence({ meanFps: PASS_FPS }),
      webgl2: evidence({ meanFps: 20 }),
    });
    expect(result.decision).toBe('webgpu');
    expect(result.reason).toContain('Browser WebGPU path');
  });

  it('does not credit WebGPU for a WebGL2 measurement when its own run produced nothing', () => {
    // An adapter that exists but could not be benchmarked is not evidence that
    // the WebGPU path holds 45 fps.
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpu: noRun(),
      webgl2: evidence({ meanFps: 58 }),
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
      webgpu: evidence({ meanFps: 240, measurementFenced: false }),
      webgl2: evidence({ meanFps: PASS_FPS }),
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
      webgpu: evidence({ meanFps: 240, measurementFenced: false }),
      webgl2: evidence({ meanFps: PASS_FPS - 0.1 }),
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
      webgpu: evidence({ meanFps: 300, renderedBlank: true }),
      webgl2: evidence({ meanFps: PASS_FPS }),
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
      webgpu: evidence({ meanFps: 90 }),
      webgl2: evidence({ meanFps: 50 }),
    });
    expect(result.decision).toBe('webgpu');
  });

  it('falls back to WebGL2 when the WebGPU run is below the bar', () => {
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpu: evidence({ meanFps: PASS_FPS - 0.1 }),
      webgl2: evidence({ meanFps: PASS_FPS }),
    });
    expect(result.decision).toBe('webgl2');
    expect(result.reason).toContain('44.9');
  });

  it('falls back to WebGL2 when there is no adapter at all', () => {
    const result = decideRenderPath({
      webgpuAdapterPresent: false,
      webgpu: noRun(),
      webgl2: evidence({ meanFps: 60 }),
    });
    expect(result.decision).toBe('webgl2');
    expect(result.reason).toContain('no WebGPU adapter');
  });

  it('escalates when WebGL2 is below the bar', () => {
    const result = decideRenderPath({
      webgpuAdapterPresent: false,
      webgpu: noRun(),
      webgl2: evidence({ meanFps: PASS_FPS - 0.1 }),
    });
    expect(result.decision).toBe('escalate');
    expect(result.reason).toContain('ESCALATE');
  });

  it('escalates when neither backend produced any numbers', () => {
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpu: noRun(),
      webgl2: noRun(),
    });
    expect(result.decision).toBe('escalate');
    expect(result.reason).toContain('no numbers');
  });

  it('ignores a WebGPU fps reading when no adapter was reported', () => {
    // Guards against a caller that keeps a stale fps around after the adapter
    // probe failed: adapter presence is the gate, not the number beside it.
    const result = decideRenderPath({
      webgpuAdapterPresent: false,
      webgpu: evidence({ meanFps: 120 }),
      webgl2: evidence({ meanFps: 50 }),
    });
    expect(result.decision).toBe('webgl2');
  });

  // The fallback branch used to read `webgl2MeanFps >= PASS_FPS` and nothing
  // else, while WebGPU was held to four separate validity checks. A broken
  // backend is *more* likely to clear an fps bar than a working one — drawing
  // nothing is the cheapest thing a GPU can do — so the asymmetry pointed the
  // gate at exactly the runs it exists to reject. Every check below is one the
  // WebGPU branch already applied; each of these cases used to select WebGL2.
  describe('holds the WebGL2 fallback to the same validity checks as WebGPU', () => {
    it('does not select an un-fenced WebGL2 run', () => {
      const result = decideRenderPath({
        webgpuAdapterPresent: false,
        webgpu: noRun(),
        webgl2: evidence({ meanFps: 240, measurementFenced: false }),
      });
      expect(result.decision).toBe('escalate');
      expect(result.reason).toContain('the WebGL2 run could not wait on GPU completion');
    });

    it('does not select a WebGL2 run whose canvas read back blank', () => {
      const result = decideRenderPath({
        webgpuAdapterPresent: false,
        webgpu: noRun(),
        webgl2: evidence({ meanFps: 300, renderedBlank: true }),
      });
      expect(result.decision).toBe('escalate');
      expect(result.reason).toContain('the WebGL2 run reported 300.0 fps but its canvas read back');
    });

    it('does not select a WebGL2 run measured on a clamped drawing buffer', () => {
      const result = decideRenderPath({
        webgpuAdapterPresent: false,
        webgpu: noRun(),
        webgl2: evidence({ meanFps: 120, resolutionStatus: 'clamped' }),
      });
      expect(result.decision).toBe('escalate');
      expect(result.reason).toContain('smaller than the one it asked for');
    });

    it('does not select a WebGL2 run taken while the tab was hidden', () => {
      const result = decideRenderPath({
        webgpuAdapterPresent: false,
        webgpu: noRun(),
        webgl2: evidence({ meanFps: 120, sampleInvalidReason: 'the tab was hidden' }),
      });
      expect(result.decision).toBe('escalate');
      expect(result.reason).toContain('not a valid sample');
    });

    it('still selects a WebGL2 run whose buffer size could not be read', () => {
      // Same principle as the blank/unavailable split: a check that could not
      // run is not a failed check, and must not veto a healthy backend.
      const result = decideRenderPath({
        webgpuAdapterPresent: false,
        webgpu: noRun(),
        webgl2: evidence({ meanFps: 60, resolutionStatus: 'unverified' }),
      });
      expect(result.decision).toBe('webgl2');
    });
  });

  it('does not credit a WebGPU run taken while the tab was hidden', () => {
    // A hidden tab stalls the frame loop, so the recorded frame costs stop
    // describing the GPU. The report already labelled such a sample invalid;
    // the decision used to consume its mean anyway.
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpu: evidence({ meanFps: 300, sampleInvalidReason: 'the tab was hidden' }),
      webgl2: evidence({ meanFps: PASS_FPS }),
    });
    expect(result.decision).toBe('webgl2');
    expect(result.reason).toContain('the WebGPU run is not a valid sample');
  });

  it('does not credit a WebGPU run measured on a clamped drawing buffer', () => {
    const result = decideRenderPath({
      webgpuAdapterPresent: true,
      webgpu: evidence({ meanFps: 300, resolutionStatus: 'clamped' }),
      webgl2: evidence({ meanFps: PASS_FPS }),
    });
    expect(result.decision).toBe('webgl2');
    expect(result.reason).toContain('smaller than the one it asked for');
  });
});

describe('classifyReadback', () => {
  const black = { r: 0, g: 0, b: 0 };
  // What a canvas that cleared and drew nothing actually reads back as.
  const clearedOnly = {
    r: Math.round(CLEAR_COLOR.r * 255),
    g: Math.round(CLEAR_COLOR.g * 255),
    b: Math.round(CLEAR_COLOR.b * 255),
  };

  it('reports content whenever more than one colour is present', () => {
    expect(classifyReadback(118, clearedOnly).status).toBe('content');
    expect(classifyReadback(2, black).status).toBe('content');
  });

  it('reports a flat frame of the clear colour as blank', () => {
    // The clear ran and no fragments followed: a real empty frame.
    expect(classifyReadback(1, clearedOnly).status).toBe('blank');
  });

  it('reports a flat frame of pure black as unavailable, not blank', () => {
    // Headless Chromium on SwiftShader returns all-zero pixels for any WebGPU
    // canvas — a bare clear-to-red with no shaders reads back black too. The
    // configured clear colour is non-black, so a canvas that merely cleared
    // cannot produce this; all-zero means the readback failed. Calling it
    // `blank` vetoes a healthy fenced backend for a broken measuring tool.
    expect(classifyReadback(1, black).status).toBe('unavailable');
  });

  it('proves the clear colour is what makes the two separable', () => {
    // If CLEAR_COLOR were ever changed to black, `blank` and the known
    // readback failure would collapse into the same pixels and this file's
    // central distinction would quietly stop working.
    expect([CLEAR_COLOR.r, CLEAR_COLOR.g, CLEAR_COLOR.b].some((channel) => channel > 0)).toBe(true);
    expect(Math.max(clearedOnly.r, clearedOnly.g, clearedOnly.b)).toBeGreaterThan(0);
  });

  it('reports unavailable when there were no pixels to look at', () => {
    // An empty readback is another way of failing to look, so it must not
    // discredit the run either.
    expect(classifyReadback(0, null).status).toBe('unavailable');
    expect(classifyReadback(1, null).status).toBe('unavailable');
    expect(isRenderedBlank(classifyReadback(0, null))).toBe(false);
  });
});

describe('classifyResolution', () => {
  const requested = { width: 2560, height: 1440 };

  it('matches when the implementation allocated what was asked for', () => {
    expect(classifyResolution(requested, { width: 2560, height: 1440 })).toBe('matched');
  });

  it('flags a buffer the implementation shrank in either dimension', () => {
    // A clamped buffer rasterises fewer pixels than the label claims, so the
    // fps is inflated for a resolution that was never measured.
    expect(classifyResolution(requested, { width: 2048, height: 1440 })).toBe('clamped');
    expect(classifyResolution(requested, { width: 2560, height: 1080 })).toBe('clamped');
  });

  it('reports unverified rather than clamped when the size could not be read', () => {
    expect(classifyResolution(requested, { width: null, height: 1440 })).toBe('unverified');
    expect(classifyResolution(requested, { width: 2560, height: null })).toBe('unverified');
  });
});

describe('backendEvidenceAt', () => {
  const run = (overrides: Partial<EvidenceRun> = {}): EvidenceRun => ({
    resolution: { key: '1440p' },
    stats: { meanFps: 60 },
    interruptedByVisibilityChange: false,
    gpuFenced: true,
    pixelCheck: { status: 'content' },
    drawingBuffer: {
      requestedWidth: 2560,
      requestedHeight: 1440,
      actualWidth: 2560,
      actualHeight: 1440,
    },
    ...overrides,
  });

  it('collects a healthy run into creditable evidence', () => {
    expect(backendEvidenceAt([run()], '1440p')).toEqual({
      meanFps: 60,
      measurementFenced: true,
      renderedBlank: false,
      resolutionStatus: 'matched',
      sampleInvalidReason: null,
    });
  });

  it('marks a run interrupted by a hidden tab as an invalid sample', () => {
    const result = backendEvidenceAt([run({ interruptedByVisibilityChange: true })], '1440p');
    expect(result.sampleInvalidReason).toContain('hidden');
    expect(
      decideRenderPath({ webgpuAdapterPresent: false, webgpu: noRun(), webgl2: result }).decision
    ).toBe('escalate');
  });

  it('carries the fence, blank and clamp findings through to the gate', () => {
    expect(backendEvidenceAt([run({ gpuFenced: false })], '1440p').measurementFenced).toBe(false);
    expect(
      backendEvidenceAt([run({ pixelCheck: { status: 'blank' } })], '1440p').renderedBlank
    ).toBe(true);
    expect(
      backendEvidenceAt([run({ pixelCheck: { status: 'unavailable' } })], '1440p').renderedBlank
    ).toBe(false);
    expect(
      backendEvidenceAt(
        [
          run({
            drawingBuffer: {
              requestedWidth: 2560,
              requestedHeight: 1440,
              actualWidth: 1024,
              actualHeight: 1440,
            },
          }),
        ],
        '1440p'
      ).resolutionStatus
    ).toBe('clamped');
  });

  it('reads the run for the requested resolution, not whichever came first', () => {
    const runs = [
      run({ resolution: { key: '1440p' }, stats: { meanFps: 60 } }),
      run({ resolution: { key: '2160p' }, stats: { meanFps: 24 }, gpuFenced: false }),
    ];
    expect(backendEvidenceAt(runs, '2160p')).toMatchObject({
      meanFps: 24,
      measurementFenced: false,
    });
  });

  it('is uncreditable when the resolution was never run', () => {
    const result = backendEvidenceAt([], '1440p');
    expect(result.meanFps).toBeNull();
    expect(result.measurementFenced).toBe(false);
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
