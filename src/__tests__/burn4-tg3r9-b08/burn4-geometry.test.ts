import { acknowledgesPixelSave, changePixelRect, pixelPointerDelta, pixelSaveCommand, readPixelLayout,
  samePixelLayout, setPixelRect, type PixelLayout } from '../../lib/burn4-freeform-layout';

const fixture = () => readPixelLayout({ schemaVersion: 1, layoutId: 'kitchen-pixels', revision: 4,
  canvas: { width: 1000, height: 500 }, items: [
    { id: 'clock', label: 'Clock', x: 100, y: 50, width: 200, height: 100, minWidth: 20, minHeight: 10 },
    { id: 'tasks', label: 'Tasks', x: 400, y: 200, width: 100, height: 80, minWidth: 30, minHeight: 20 }] });
const raw = () => JSON.parse(JSON.stringify(fixture())) as { schemaVersion: number; layoutId: string; revision: number;
  canvas: { width: number; height: number }; items: Array<{ id: string; label: string; x: number; y: number; width: number; height: number; minWidth: number; minHeight: number }> };

describe('explicit pixel layout schema', () => {
  test('allowlists and recursively freezes without retaining caller references', () => {
    const source = raw();
    const result = readPixelLayout({ ...source, privateExtra: 'ignored' });
    source.items[0].x = 999;
    expect(result.items[0].x).toBe(100);
    expect(Object.keys(result)).toEqual(['schemaVersion', 'layoutId', 'revision', 'canvas', 'items']);
    for (const obj of [result, result.canvas, result.items, result.items[0]]) expect(Object.isFrozen(obj)).toBe(true);
  });
  test.each([null, [], 1, 'layout', {}, { ...raw(), schemaVersion: 2 }])('rejects unsupported input %p', value => {
    expect(() => readPixelLayout(value)).toThrow();
  });
  test.each([0, -1, 16385, 0.5, NaN, Infinity])('rejects invalid canvas width %p', width => {
    const input = raw(); input.canvas.width = width;
    expect(() => readPixelLayout(input)).toThrow();
  });
  test.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects revision %p', revision => {
    expect(() => readPixelLayout({ ...raw(), revision })).toThrow();
  });
  test.each(['', ' ', 'x'.repeat(129), 'a\n'])('rejects bad IDs %p', id => {
    const input = raw(); input.items[0].id = id;
    expect(() => readPixelLayout(input)).toThrow();
  });
  test.each(['', 'x'.repeat(121), 'a\u007f'])('rejects bad labels %p', label => {
    const input = raw(); input.items[0].label = label;
    expect(() => readPixelLayout(input)).toThrow();
  });
  test.each(['x', 'y', 'width', 'height', 'minWidth', 'minHeight'] as const)('rejects invalid %s', field => {
    const input = raw(); input.items[0][field] = -1;
    expect(() => readPixelLayout(input)).toThrow();
  });
  test('rejects missing, duplicate and over-budget collections with small fixtures', () => {
    const input = raw(); input.items[1].id = input.items[0].id;
    expect(() => readPixelLayout(input)).toThrow('unique');
    expect(() => readPixelLayout({ ...raw(), items: null })).toThrow();
    expect(() => readPixelLayout({ ...raw(), items: Array(129).fill(raw().items[0]) })).toThrow('128');
  });
  test('rejects sparse arrays rather than retaining unvalidated holes', () => {
    expect(() => readPixelLayout({ ...raw(), items: Array(2) })).toThrow();
  });
  test('supports an empty canvas and the dimension limit', () => {
    expect(readPixelLayout({ ...raw(), canvas: { width: 16384, height: 16384 }, items: [] }).items).toEqual([]);
  });
});
describe('pixel geometry', () => {
  test('exact rectangle entry preserves other widgets and permits overlap', () => {
    const base = fixture();
    const next = setPixelRect(base, 'clock', { x: 400, y: 200, width: 100, height: 80 });
    expect(next.items[0]).toMatchObject({ x: 400, y: 200, width: 100, height: 80 });
    expect(next.items[1]).toEqual(base.items[1]);
    expect(base.items[0].x).toBe(100);
  });
  test.each([{ x: 801, y: 0, width: 200, height: 100 }, { x: 0, y: 401, width: 200, height: 100 },
    { x: 0, y: 0, width: 19, height: 100 }, { x: 0, y: 0, width: 200, height: 9 },
    { x: 0.1, y: 0, width: 200, height: 100 }])('rejects invalid exact rectangle %p', rect => {
    expect(() => setPixelRect(fixture(), 'clock', rect)).toThrow();
  });
  test('exact entry allowlists rectangle fields and requires all four coordinates', () => {
    const base = fixture();
    const next = setPixelRect(base, 'clock', { x: 20, y: 20, width: 100, height: 100, id: 'injected', minWidth: 1 } as import('../../lib/burn4-freeform-layout').PixelRect);
    expect(next.items[0]).toMatchObject({ id: 'clock', minWidth: 20, x: 20 });
    expect(() => setPixelRect(base, 'clock', { x: 20 } as import('../../lib/burn4-freeform-layout').PixelRect)).toThrow();
  });
  test('unknown widget is rejected by exact and relative editing', () => {
    expect(() => setPixelRect(fixture(), 'missing', { x: 0, y: 0, width: 1, height: 1 })).toThrow('Unknown');
    expect(() => changePixelRect(fixture(), 'missing', 'move', 1, 1)).toThrow('Unknown');
  });
  test.each([['move', -10000, -10000, { x: 0, y: 0 }], ['move', 10000, 10000, { x: 800, y: 400 }],
    ['resize', -10000, -10000, { width: 20, height: 10 }], ['resize', 10000, 10000, { width: 900, height: 450 }]] as const)('clamps %s to caller min sizes and edges', (mode, dx, dy, expected) => {
    expect(changePixelRect(fixture(), 'clock', mode, dx, dy).items[0]).toMatchObject(expected);
  });
  test('rounds relative edits while keeping unedited axes stable', () => {
    expect(changePixelRect(fixture(), 'clock', 'move', 1.8, -2.2).items[0]).toMatchObject({ x: 102, y: 48, width: 200, height: 100 });
  });
  test.each([NaN, Infinity, -Infinity])('rejects nonfinite movement %p', value => {
    expect(() => changePixelRect(fixture(), 'clock', 'resize', value, 0)).toThrow();
  });
  test('rejects an unknown editing mode at runtime', () => {
    expect(() => changePixelRect(fixture(), 'clock', 'rotate' as 'move', 1, 1)).toThrow('mode');
  });
  test('scales pointer distance separately across axes', () => {
    expect(pixelPointerDelta(fixture().canvas, { width: 500, height: 100 }, 5.2, -2)).toEqual({ dx: 10, dy: -10 });
  });
  test.each([{ width: 0, height: 20 }, { width: 20, height: -1 }, { width: Infinity, height: 20 }])('rejects unusable rendered bounds %p', rendered => {
    expect(() => pixelPointerDelta(fixture().canvas, rendered, 1, 1)).toThrow();
  });
  test('rejects unsafe pointer precision and invalid design dimensions', () => {
    expect(() => pixelPointerDelta(fixture().canvas, { width: 1, height: 1 }, Number.MAX_VALUE, 1)).toThrow();
    expect(() => pixelPointerDelta({ width: NaN, height: 1 }, { width: 20, height: 20 }, 1, 1)).toThrow();
  });
  test('rejects nonfinite pointer positions', () => {
    expect(() => pixelPointerDelta(fixture().canvas, { width: 20, height: 20 }, NaN, 1)).toThrow();
  });
});
describe('save command and acknowledgement', () => {
  test('freezes the exact next revision without changing either source', () => {
    const base = fixture(); const draft = changePixelRect(base, 'clock', 'move', 2, 3);
    const command = pixelSaveCommand(base, draft);
    expect(command.expectedRevision).toBe(4); expect(command.candidate.revision).toBe(5);
    expect(command.candidate.items).toEqual(draft.items);
    expect(Object.isFrozen(command)).toBe(true); expect(Object.isFrozen(command.candidate.items[0])).toBe(true);
    expect(base.revision).toBe(4); expect(draft.revision).toBe(4);
    expect(acknowledgesPixelSave(command, readPixelLayout(command.candidate))).toBe(true);
  });
  test.each(['layoutId', 'revision', 'canvas', 'items'] as const)('metadata mutation %s cannot be saved as a rectangle edit', field => {
    const input = raw();
    if (field === 'layoutId') input.layoutId = 'other';
    if (field === 'revision') input.revision++;
    if (field === 'canvas') input.canvas.width++;
    if (field === 'items') input.items[0].label = 'Changed';
    expect(() => pixelSaveCommand(fixture(), readPixelLayout(input))).toThrow('rectangles');
  });
  test('revision overflow cannot create a command', () => {
    const base = readPixelLayout({ ...raw(), revision: Number.MAX_SAFE_INTEGER });
    expect(() => pixelSaveCommand(base, base)).toThrow('limit');
  });
  test('identity, revision, order and metadata are part of exact acknowledgement', () => {
    const command = pixelSaveCommand(fixture(), changePixelRect(fixture(), 'clock', 'move', 1, 1));
    const candidates: PixelLayout[] = [fixture(), { ...command.candidate, layoutId: 'other' },
      { ...command.candidate, revision: 6 }, { ...command.candidate, items: [...command.candidate.items].reverse() },
      { ...command.candidate, items: command.candidate.items.map(item => ({ ...item, label: 'Changed' })) }];
    for (const input of candidates) expect(acknowledgesPixelSave(command, readPixelLayout(input))).toBe(false);
    expect(samePixelLayout(fixture(), readPixelLayout(raw()))).toBe(true);
    const original = fixture();
    expect(samePixelLayout(original, { items: original.items, canvas: original.canvas, revision: original.revision, layoutId: original.layoutId, schemaVersion: 1 })).toBe(true);
  });
});
