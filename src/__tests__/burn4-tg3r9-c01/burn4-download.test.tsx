/** @jest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ICAL from 'ical.js';
import Builder from '../../components/calendar/burn4-all-day-recurrence-builder';
import Page from '../../app/calendar/recurrence/page';
import { downloadFixture, draft, identity } from './burn4-fixtures';

afterEach(() => { cleanup(); jest.restoreAllMocks(); jest.useRealTimers(); });
function ready(options: { io?: ReturnType<typeof downloadFixture>; factory?: () => typeof identity; unavailable?: boolean } = {}) {
  const io = options.io ?? downloadFixture(); const factory = options.factory ?? jest.fn(() => identity);
  const view = render(<Builder value={draft()} onChange={() => undefined} createIdentity={factory}
    downloadCapabilities={options.unavailable ? null : io.caps} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  return { ...view, ...io, factory };
}
function click() { fireEvent.click(screen.getByRole('button', { name: 'Download calendar' })); }
function manual() { return (screen.getByLabelText('Calendar text for manual copy') as HTMLTextAreaElement).value; }

test('user gesture creates one correctly typed Blob and owned fixed-filename anchor synchronously', () => {
  const io = ready(); expect(io.factory).not.toHaveBeenCalled(); click();
  expect(io.factory).toHaveBeenCalledTimes(1); expect(io.anchors).toHaveLength(1);
  expect(io.anchors[0]!.href).toBe('blob:offline-1');
  expect(io.anchors[0]!.download).toBe('prism-recurrence.ics');
  expect(io.anchors[0]!.click).toHaveBeenCalledTimes(1);
  expect(io.anchors[0]!.remove).toHaveBeenCalledTimes(1);
  expect(io.caps.createBlob).toHaveBeenCalledWith([io.texts[0]], { type: 'text/calendar;charset=utf-8' });
  expect(manual()).toBe(io.texts[0]!.replace(/\r\n/g, '\n'));
  expect(io.caps.schedule).toHaveBeenCalledWith(expect.any(Function), 1000);
  expect(screen.getByRole('status').textContent).toContain('Download started');
  expect(io.caps.revokeObjectURL).not.toHaveBeenCalled();
  act(() => io.callbacks[0]!());
  expect(io.caps.revokeObjectURL).toHaveBeenCalledTimes(1);
});

test('retries unchanged bytes and old cleanup callbacks never revoke a newer URL', () => {
  const io = ready(); click(); const first = manual(); click();
  expect(io.factory).toHaveBeenCalledTimes(1); expect(manual()).toBe(first);
  expect(io.caps.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(io.caps.revokeObjectURL).toHaveBeenNthCalledWith(1, 'blob:offline-1');
  act(() => io.callbacks[0]!()); expect(io.caps.revokeObjectURL).toHaveBeenCalledTimes(1);
  act(() => io.callbacks[1]!()); expect(io.caps.revokeObjectURL).toHaveBeenNthCalledWith(2, 'blob:offline-2');
  io.unmount(); expect(io.caps.revokeObjectURL).toHaveBeenCalledTimes(2);
});

test('unmount cancels and revokes each live lease once, even if timer subsequently fires', () => {
  const io = ready(); click(); io.unmount();
  expect(io.caps.cancel).toHaveBeenCalledWith(1);
  expect(io.caps.revokeObjectURL).toHaveBeenCalledTimes(1);
  act(() => io.callbacks[0]!()); expect(io.caps.revokeObjectURL).toHaveBeenCalledTimes(1);
});

test.each(['createBlob', 'createObjectURL', 'createAnchor', 'appendAnchor', 'schedule'] as const)
('a throwing %s capability preserves the identity and exact text for retry', stage => {
  const io = downloadFixture(); const original = io.caps[stage];
  (io.caps as unknown as Record<string, unknown>)[stage] = jest.fn(() => { throw new Error('injected'); });
  const result = ready({ io }); click(); const first = manual();
  expect(screen.getByRole('status').textContent).toContain('Select and copy');
  expect(result.factory).toHaveBeenCalledTimes(1);
  (io.caps as unknown as Record<string, unknown>)[stage] = original;
  click(); expect(manual()).toBe(first); expect(result.factory).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('Download started');
});

test('click failure removes anchor, immediately revokes its URL and keeps manual text', () => {
  const io = downloadFixture();
  jest.mocked(io.caps.createAnchor).mockImplementationOnce(() => {
    const anchor = { href: '', download: '', click: jest.fn(() => { throw new Error('click failed'); }), remove: jest.fn() };
    io.anchors.push(anchor); return anchor;
  });
  ready({ io }); click();
  expect(io.anchors[0]!.remove).toHaveBeenCalledTimes(1);
  expect(io.caps.revokeObjectURL).toHaveBeenCalledWith('blob:offline-1');
  expect(manual()).toContain('BEGIN:VCALENDAR');
});

test('cleanup exceptions do not stop independent URL ownership cleanup', () => {
  const io = ready(); click();
  jest.mocked(io.caps.cancel).mockImplementation(() => { throw new Error('cancel failed'); });
  jest.mocked(io.caps.revokeObjectURL).mockImplementation(() => { throw new Error('revoke failed'); });
  expect(() => io.unmount()).not.toThrow();
  expect(io.caps.revokeObjectURL).toHaveBeenCalledTimes(1);
  act(() => io.callbacks[0]!()); expect(io.caps.revokeObjectURL).toHaveBeenCalledTimes(1);
});

test('unavailable browser download exposes current accepted exact calendar text', () => {
  const io = ready({ unavailable: true }); click();
  expect(manual()).toContain(`UID:${identity.uid}`);
  expect(screen.getByRole('status').textContent).toContain('Download unavailable');
  expect(io.caps.createBlob).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Calendar text for manual copy') as HTMLTextAreaElement).readOnly).toBe(true);
});

test('factory failure creates no complete identity; a later retry can obtain one', () => {
  const factory = jest.fn().mockImplementationOnce(() => { throw new Error('identity failed'); }).mockReturnValue(identity);
  ready({ factory }); click(); expect(screen.queryByLabelText('Calendar text for manual copy')).toBeNull();
  click(); expect(factory).toHaveBeenCalledTimes(2); expect(manual()).toContain('BEGIN:VCALENDAR');
});

test('invalid public identity is rejected without creating a Blob', () => {
  const io = ready({ factory: () => ({ ...identity, uid: 'invalid\r\nUID' }) }); click();
  expect(io.caps.createBlob).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toContain('Unable to generate');
});

test('a valid public identity survives serializer failure without re-calling the factory', () => {
  const original = ICAL.stringify;
  jest.spyOn(ICAL, 'stringify').mockImplementationOnce(() => { throw new Error('serializer failed'); })
    .mockImplementation(original);
  const io = ready(); click(); expect(io.factory).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Calendar text for manual copy')).toBeNull();
  click(); expect(io.factory).toHaveBeenCalledTimes(1); expect(manual()).toContain(identity.uid);
});

test('page adapter uses native public identity and native DOM Blob/URL/timer capabilities only on export', () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-22T08:30:00Z'));
  const create = jest.fn((_blob: Blob) => 'blob:native-test'); const revoke = jest.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  const uuid = jest.spyOn(crypto, 'randomUUID').mockReturnValue('50000000-0000-4000-8000-000000000001');
  const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const view = render(<Page />); expect(uuid).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Native example' } });
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' })); click();
  expect(uuid).toHaveBeenCalledTimes(1); expect(anchorClick).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  expect(document.querySelector('a[download]')).toBeNull();
  expect(manual()).toContain('UID:50000000-0000-4000-8000-000000000001');
  act(() => jest.advanceTimersByTime(1000)); expect(revoke).toHaveBeenCalledTimes(1);
  view.unmount(); expect(revoke).toHaveBeenCalledTimes(1);
});


test('manual native copy preserves original CRLF bytes despite textarea value normalization', () => {
  const io = ready({ unavailable: true }); click();
  const textarea = screen.getByLabelText('Calendar text for manual copy');
  const data = { setData: jest.fn() };
  expect(fireEvent.copy(textarea, { clipboardData: data })).toBe(false);
  const raw = data.setData.mock.calls[0]![1] as string;
  expect(raw).toContain('\r\n');
  expect(raw.replace(/\r\n/g, '\n')).toBe(manual());
  expect(data.setData).toHaveBeenCalledWith('text/plain', raw);
  expect(io.factory).toHaveBeenCalledTimes(1);
});


test('native copy failure reports useful status without losing the accepted artifact', () => {
  const io = ready({ unavailable: true }); click();
  fireEvent.copy(screen.getByLabelText('Calendar text for manual copy'), {
    clipboardData: { setData() { throw new Error('copy failed'); } },
  });
  expect(screen.getByRole('status').textContent).toContain('Copy unavailable');
  expect(manual()).toContain('BEGIN:VCALENDAR'); expect(io.factory).toHaveBeenCalledTimes(1);
});

test('anchor removal failure still retires the URL lease and exposes manual text', () => {
  const io = downloadFixture();
  jest.mocked(io.caps.createAnchor).mockImplementationOnce(() => ({ href: '', download: '',
    click: jest.fn(), remove() { throw new Error('remove failed'); } }));
  ready({ io }); click();
  expect(io.caps.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('Download unavailable');
  expect(manual()).toContain('BEGIN:VCALENDAR');
});
