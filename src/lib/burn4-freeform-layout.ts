/** Standalone pixel schema. Existing grid coordinates must never be passed as pixels. */
export interface PixelItem {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
}
export interface PixelLayout {
  readonly schemaVersion: 1;
  readonly layoutId: string;
  readonly revision: number;
  readonly canvas: Readonly<{ width: number; height: number }>;
  readonly items: readonly PixelItem[];
}
export interface PixelRect { x: number; y: number; width: number; height: number }
export interface PixelSaveCommand {
  readonly expectedRevision: number;
  readonly candidate: PixelLayout;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error('Pixel values must be bounded integers.');
  }
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Names must be nonempty bounded text.');
  }
  return value;
}
/** Validate, allowlist, copy and freeze a small explicit snapshot. */
export function readPixelLayout(value: unknown): PixelLayout {
  const input = record(value);
  if (input.schemaVersion !== 1) throw new Error('Unsupported pixel schema.');
  const canvas = record(input.canvas);
  const width = integer(canvas.width, 1, 16384);
  const height = integer(canvas.height, 1, 16384);
  if (!Array.isArray(input.items) || input.items.length > 128) throw new Error('At most 128 widgets are supported.');
  const seen = new Set<string>();
  const items = Array.from(input.items, (raw: unknown) => {
    const item = record(raw);
    const id = text(item.id, 128);
    if (seen.has(id)) throw new Error('Widget IDs must be unique.');
    seen.add(id);
    const minWidth = integer(item.minWidth, 1, width);
    const minHeight = integer(item.minHeight, 1, height);
    const w = integer(item.width, minWidth, width);
    const h = integer(item.height, minHeight, height);
    return Object.freeze({ id, label: text(item.label, 120), x: integer(item.x, 0, width - w),
      y: integer(item.y, 0, height - h), width: w, height: h, minWidth, minHeight });
  });
  return Object.freeze({ schemaVersion: 1, layoutId: text(input.layoutId, 128),
    revision: integer(input.revision, 0, Number.MAX_SAFE_INTEGER),
    canvas: Object.freeze({ width, height }), items: Object.freeze(items) });
}
/** Exact equality includes identity, revision, order and all allowlisted metadata. */
export function samePixelLayout(a: PixelLayout, b: PixelLayout): boolean {
  return JSON.stringify(readPixelLayout(a)) === JSON.stringify(readPixelLayout(b));
}
/** Exact numeric entry rejects invalid rectangles instead of silently changing them. */
export function setPixelRect(layout: PixelLayout, id: string, rect: PixelRect): PixelLayout {
  const current = readPixelLayout(layout);
  if (!current.items.some(item => item.id === id)) throw new Error('Unknown widget.');
  return readPixelLayout({ ...current, items: current.items.map(item => item.id === id ? { ...item, x: rect.x, y: rect.y, width: rect.width, height: rect.height } : item) });
}
/** Relative pointer/keyboard movement is rounded to pixels and clamped to canvas bounds. */
export function changePixelRect(layout: PixelLayout, id: string, mode: 'move' | 'resize', dx: number, dy: number): PixelLayout {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Movement must be finite.');
  if (mode !== 'move' && mode !== 'resize') throw new Error('Unknown editing mode.');
  const current = readPixelLayout(layout);
  const item = current.items.find(entry => entry.id === id);
  if (!item) throw new Error('Unknown widget.');
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const rect = mode === 'move'
    ? { x: clamp(item.x + Math.round(dx), 0, current.canvas.width - item.width),
      y: clamp(item.y + Math.round(dy), 0, current.canvas.height - item.height), width: item.width, height: item.height }
    : { x: item.x, y: item.y, width: clamp(item.width + Math.round(dx), item.minWidth, current.canvas.width - item.x),
      height: clamp(item.height + Math.round(dy), item.minHeight, current.canvas.height - item.y) };
  return setPixelRect(current, id, rect);
}
/** Convert rendered CSS distance to explicit design pixels, independently on both axes. */
export function pixelPointerDelta(canvas: PixelLayout['canvas'], rendered: { width: number; height: number }, dx: number, dy: number): { dx: number; dy: number } {
  integer(canvas.width, 1, 16384);
  integer(canvas.height, 1, 16384);
  if (![rendered.width, rendered.height, dx, dy].every(Number.isFinite) || rendered.width <= 0 || rendered.height <= 0) {
    throw new Error('The canvas needs measurable positive dimensions.');
  }
  const result = { dx: Math.round(dx * canvas.width / rendered.width), dy: Math.round(dy * canvas.height / rendered.height) };
  if (!Number.isSafeInteger(result.dx) || !Number.isSafeInteger(result.dy)) throw new Error('Pointer distance exceeds safe pixel precision.');
  return result;
}
/** The host must compare expectedRevision atomically and supply the resulting snapshot. */
export function pixelSaveCommand(base: PixelLayout, draft: PixelLayout): PixelSaveCommand {
  const original = readPixelLayout(base);
  const next = readPixelLayout(draft);
  const metadata = (layout: PixelLayout) => ({ ...layout, items: layout.items.map(({ x: _x, y: _y, width: _w, height: _h, ...rest }) => rest) });
  if (JSON.stringify(metadata(original)) !== JSON.stringify(metadata(next))) throw new Error('Only widget rectangles may change.');
  if (original.revision === Number.MAX_SAFE_INTEGER) throw new Error('Revision limit reached.');
  return Object.freeze({ expectedRevision: original.revision, candidate: readPixelLayout({ ...next, revision: original.revision + 1 }) });
}
export function acknowledgesPixelSave(command: PixelSaveCommand, host: PixelLayout): boolean {
  return host.revision === command.expectedRevision + 1 && samePixelLayout(host, command.candidate);
}
