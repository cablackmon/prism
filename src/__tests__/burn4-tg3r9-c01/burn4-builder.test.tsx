/** @jest-environment jsdom */
import React, { Suspense, startTransition } from 'react';
import { createRoot } from 'react-dom/client';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ICAL from 'ical.js';
import Builder, { type RecurrenceDraft } from '../../components/calendar/burn4-all-day-recurrence-builder';
import Page from '../../app/calendar/recurrence/page';
import { draft, downloadFixture, identity } from './burn4-fixtures';

afterEach(() => { cleanup(); jest.restoreAllMocks(); });
function host(value = draft(), options: { createIdentity?: () => typeof identity } = {}) {
  const factory = options.createIdentity ?? jest.fn(() => identity);
  const io = downloadFixture();
  function Host() {
    const [current, setCurrent] = React.useState(value);
    return <Builder value={current} onChange={setCurrent} createIdentity={factory} downloadCapabilities={io.caps} />;
  }
  const view = render(<Host />);
  return { ...view, factory, ...io };
}
function preview() { fireEvent.click(screen.getByRole('button', { name: 'Preview' })); }
function download() { fireEvent.click(screen.getByRole('button', { name: 'Download calendar' })); }

test('actual direct route renders the editable local tool without recurrence work or network', () => {
  const recurrence = jest.spyOn(ICAL.Recur.prototype, 'iterator');
  const view = render(<Page />);
  expect(screen.getByRole('heading', { name: 'All-day calendar recurrence' })).toBeTruthy();
  expect(screen.getByLabelText('Title')).toBeTruthy();
  expect(recurrence).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Download calendar' }) as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
});

test('explicit Preview shows fixed dates, exclusive ends and focuses the result heading', () => {
  const recurrence = jest.spyOn(ICAL.Recur.prototype, 'iterator');
  const { factory } = host();
  expect(recurrence).not.toHaveBeenCalled();
  preview();
  expect(screen.getAllByRole('listitem')).toHaveLength(5);
  expect(screen.getAllByRole('listitem')[0]!.textContent).toBe('2026-01-31 to 2026-02-01 (exclusive end)');
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'First occurrences' }));
  expect(factory).not.toHaveBeenCalled();
  expect(recurrence).toHaveBeenCalledTimes(1);
});

test.each(['', '-1', '+1', '1.0', '1e1', ' 1', '1 '])('keeps invalid interval text %j editable and focuses linked error', raw => {
  host();
  fireEvent.change(screen.getByLabelText('Repeat every (cadence periods)'), { target: { value: raw } });
  preview();
  const input = screen.getByLabelText('Repeat every (cadence periods)') as HTMLInputElement;
  expect(input.value).toBe(raw);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('Interval');
  expect(document.activeElement).toBe(input);
});

test('leading zero numeric spellings remain the same canonical accepted event', () => {
  const { factory, texts } = host(); preview(); download();
  fireEvent.change(screen.getByLabelText('Repeat every (cadence periods)'), { target: { value: '0001' } });
  expect((screen.getByRole('button', { name: 'Download calendar' }) as HTMLButtonElement).disabled).toBe(false);
  download(); expect(factory).toHaveBeenCalledTimes(1); expect(texts[1]).toBe(texts[0]);
});

test('changed or invalid drafts cannot download stale accepted results, but a direct reversion can', () => {
  const { factory } = host(); preview(); download();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } });
  expect(screen.getByRole('region', { name: 'Previous preview' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Download calendar' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByLabelText('Calendar text for manual copy')).toBeNull();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } }); preview();
  expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Synthetic event' } });
  download(); expect(factory).toHaveBeenCalledTimes(1);
});

test('accepting another event retires identity; accepting the older event again is new', () => {
  let count = 0;
  const factory = jest.fn(() => ({ ...identity, uid: `example-${++count}` }));
  const io = host(draft(), { createIdentity: factory }); preview(); download();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Second event' } }); preview(); download();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Synthetic event' } }); preview(); download();
  expect(factory).toHaveBeenCalledTimes(3);
  expect(new Set(io.texts).size).toBe(3);
});

test('weekly selection must include the start weekday, and dormant ending values stay excluded', () => {
  host(draft({ frequency: 'WEEKLY', startDate: '2026-10-19', weekdays: ['WE'], count: 'bad', until: 'bad', endingMode: 'never' }));
  preview(); expect(screen.getByRole('alert').textContent).toContain('start date weekday');
  fireEvent.click(screen.getByRole('checkbox', { name: 'MO' })); preview();
  expect(screen.getAllByRole('listitem')).toHaveLength(20);
  expect(screen.getByText('First 20 occurrences only. More dates follow.')).toBeTruthy();
});

test('ending count and until controls are actual editable inputs with truthful limits', () => {
  host();
  fireEvent.change(screen.getByLabelText('End mode'), { target: { value: 'until' } });
  fireEvent.change(screen.getByLabelText('Inclusive ending date'), { target: { value: '2026-03-31' } }); preview();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('The inclusive ending date is reached.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('End mode'), { target: { value: 'count' } });
  fireEvent.change(screen.getByLabelText('Occurrence count'), { target: { value: '1' } }); preview();
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
});

test('ordinary edits preserve focus; New event resets preview and owned export state', () => {
  const io = host(); preview(); download();
  const input = screen.getByLabelText('Title'); input.focus();
  fireEvent.change(input, { target: { value: 'Changed' } }); expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: 'New event / reset' }));
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('list')).toBeNull(); expect(document.activeElement).toBe(input);
  expect(io.caps.revokeObjectURL).toHaveBeenCalledTimes(1);
});

test('independent instances keep unique input labels and do not share export identities', () => {
  const a = downloadFixture(); const b = downloadFixture();
  const fa = jest.fn(() => ({ ...identity, uid: 'first' })); const fb = jest.fn(() => ({ ...identity, uid: 'second' }));
  render(<><Builder value={draft()} onChange={() => undefined} createIdentity={fa} downloadCapabilities={a.caps} />
    <Builder value={draft()} onChange={() => undefined} createIdentity={fb} downloadCapabilities={b.caps} /></>);
  const sections = screen.getAllByRole('region', { name: 'All-day recurrence builder' });
  expect(within(sections[0]!).getByLabelText('Title').id).not.toBe(within(sections[1]!).getByLabelText('Title').id);
  fireEvent.click(within(sections[0]!).getByRole('button', { name: 'Preview' }));
  fireEvent.click(within(sections[0]!).getByRole('button', { name: 'Download calendar' }));
  expect(fa).toHaveBeenCalledTimes(1); expect(fb).not.toHaveBeenCalled();
});

test('engine exceptions keep current download disabled with useful feedback', () => {
  host(); jest.spyOn(ICAL.Recur.prototype, 'iterator').mockImplementation(() => { throw new Error('injected'); });
  preview(); expect(screen.getAllByRole('alert').some(node => node.textContent?.includes('Unable to preview'))).toBe(true);
  expect((screen.getByRole('button', { name: 'Download calendar' }) as HTMLButtonElement).disabled).toBe(true);
});

test('a suspended speculative host draft cannot change visible export or retire its identity', async () => {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container); const io = downloadFixture(); const factory = jest.fn(() => identity);
  const pending = new Promise<never>(() => undefined);
  function Block({ block }: { block: boolean }) { if (block) throw pending; return null; }
  function tree(value: RecurrenceDraft, block: boolean) {
    return <Suspense fallback={<p>Waiting</p>}><Builder value={value} onChange={() => undefined}
      createIdentity={factory} downloadCapabilities={io.caps} /><Block block={block} /></Suspense>;
  }
  await act(async () => root.render(tree(draft(), false)));
  fireEvent.click(within(container).getByRole('button', { name: 'Preview' }));
  fireEvent.click(within(container).getByRole('button', { name: 'Download calendar' }));
  await act(async () => startTransition(() => root.render(tree(draft({ title: 'Uncommitted' }), true))));
  expect((within(container).getByLabelText('Title') as HTMLInputElement).value).toBe('Synthetic event');
  fireEvent.click(within(container).getByRole('button', { name: 'Download calendar' }));
  expect(factory).toHaveBeenCalledTimes(1); expect(io.texts[1]).toBe(io.texts[0]);
  await act(async () => root.unmount()); container.remove();
});

test.each([
  ['count', 'Occurrence count', '0'], ['until', 'Inclusive ending date', '2025-01-01'],
] as const)('invalid %s focuses and marks its actual dependent input', (mode, label, value) => {
  host(draft({ endingMode: mode }));
  fireEvent.change(screen.getByLabelText(label), { target: { value } }); preview();
  const input = screen.getByLabelText(label);
  expect(document.activeElement).toBe(input);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
  expect((screen.getByLabelText('Title') as HTMLInputElement).required).toBe(true);
  expect((screen.getByLabelText('Start date') as HTMLInputElement).required).toBe(true);
});
