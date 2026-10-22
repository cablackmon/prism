import type { RecurrenceDraft, DownloadCapabilities } from '../../components/calendar/burn4-all-day-recurrence-builder';

export const identity = { uid: 'recurrence-example-1@offline.invalid', dtstamp: '2026-10-22T08:30:00Z' };
export function event(overrides: Record<string, unknown> = {}): unknown {
  return { title: 'Synthetic event', startDate: '2026-01-31', durationDays: 1,
    frequency: 'MONTHLY', interval: 1, ending: { mode: 'count', count: 5 }, ...overrides };
}
export function draft(overrides: Partial<RecurrenceDraft> = {}): RecurrenceDraft {
  return { title: 'Synthetic event', description: '', startDate: '2026-01-31', durationDays: '1',
    frequency: 'MONTHLY', interval: '1', weekdays: ['MO'], endingMode: 'count', count: '5', until: '', ...overrides };
}
export function dates(value: { rows: readonly { startDate: string }[] }) { return value.rows.map(row => row.startDate); }
export function downloadFixture() {
  const texts: string[] = [];
  const anchors: { href: string; download: string; click: jest.Mock; remove: jest.Mock }[] = [];
  const callbacks: (() => void)[] = [];
  let nextId = 0;
  const caps: DownloadCapabilities = {
    createBlob: jest.fn((parts: BlobPart[], _options: BlobPropertyBag) => { texts.push(String(parts[0])); return {} as Blob; }),
    createObjectURL: jest.fn((_blob: Blob) => `blob:offline-${++nextId}`),
    revokeObjectURL: jest.fn((_url: string) => undefined),
    createAnchor: jest.fn(() => { const anchor = { href: '', download: '', click: jest.fn(), remove: jest.fn() }; anchors.push(anchor); return anchor; }),
    appendAnchor: jest.fn((_anchor: unknown) => undefined),
    schedule: jest.fn((callback: () => void, _delay: number) => { callbacks.push(callback); return callbacks.length; }),
    cancel: jest.fn((_handle: unknown) => undefined),
  };
  return { caps, texts, anchors, callbacks };
}
