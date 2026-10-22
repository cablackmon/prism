import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Burn4FreeformLayoutEditor } from '../../components/layout/burn4-freeform-layout-editor';
import { changePixelRect, readPixelLayout, type PixelSaveCommand } from '../../lib/burn4-freeform-layout';
const fixture = () => readPixelLayout({ schemaVersion: 1, layoutId: 'kitchen-pixels', revision: 4,
  canvas: { width: 1000, height: 500 }, items: [
    { id: 'clock', label: 'Clock', x: 100, y: 50, width: 200, height: 100, minWidth: 20, minHeight: 10 },
    { id: 'tasks', label: 'Tasks', x: 400, y: 200, width: 100, height: 80, minWidth: 30, minHeight: 20 }] });
const x = () => (screen.getByLabelText('x') as HTMLInputElement).value;
const edit = () => fireEvent.keyDown(screen.getByRole('button', { name: 'Move Clock' }), { key: 'ArrowRight' });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;
function deferred() {
  let resolve!: () => void; let reject!: () => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = () => no(new Error('synthetic')); });
  return { promise, resolve, reject };
}
const settle = async (fn: () => void) => { await act(async () => { fn(); await Promise.resolve(); }); };
afterEach(cleanup);
describe('host acknowledgement and retry identity', () => {
  test('pending locks edits, suppresses duplicate clicks and callback resolution alone never saves', async () => {
    const job = deferred(); const commit = jest.fn((_command: PixelSaveCommand) => job.promise);
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={commit} />);
    edit(); save(); fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    expect(commit).toHaveBeenCalledTimes(1); expect(disabled('Retry save')).toBe(true);
    expect(disabled('Move Clock')).toBe(true); expect(disabled('Reset draft')).toBe(true);
    expect(screen.getByLabelText('x').matches(':disabled')).toBe(true);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Clock' }), { key: 'ArrowRight' }); expect(x()).toBe('101');
    const command = commit.mock.calls[0][0]; expect(command.expectedRevision).toBe(4);
    expect(command.candidate.revision).toBe(5); expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.candidate.items[0])).toBe(true);
    await settle(job.resolve);
    expect(screen.getByRole('status').textContent).toMatch(/Waiting for the host/);
    expect(disabled('Move Clock')).toBe(true); expect(disabled('Retry save')).toBe(false);
    expect(screen.queryByText('Layout saved.')).toBeNull();
  });
  test.each(['throw', 'reject'] as const)('%s retains the identical immutable command and candidate for retry', async kind => {
    const job = deferred();
    const commit = jest.fn((_command: PixelSaveCommand): void | Promise<void> => {
      if (kind === 'throw') throw new Error('synthetic');
      return job.promise;
    });
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={commit} />);
    edit(); save(); if (kind === 'reject') await settle(job.reject);
    expect(screen.getByRole('status').textContent).toMatch(/Save failed/);
    const first = commit.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    expect(commit).toHaveBeenCalledTimes(2); expect(commit.mock.calls[1][0]).toBe(first);
    expect(commit.mock.calls[1][0].candidate).toBe(first.candidate); expect(x()).toBe('101');
    if (kind === 'reject') await settle(() => undefined);
  });
  test('retry after callback success also uses the same uncertain command', async () => {
    const commit = jest.fn((_command: PixelSaveCommand) => undefined);
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={commit} />);
    edit(); save(); await settle(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    expect(commit.mock.calls[1][0]).toBe(commit.mock.calls[0][0]); await settle(() => undefined);
  });
  test.each(['resolve', 'reject'] as const)('exact authoritative acknowledgement wins before callback %s', async kind => {
    const job = deferred(); const commit = jest.fn((_command: PixelSaveCommand) => job.promise);
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={commit} />);
    edit(); save(); const command = commit.mock.calls[0][0];
    view.rerender(<Burn4FreeformLayoutEditor snapshot={readPixelLayout(command.candidate)} onCommit={commit} />);
    expect(screen.getByRole('status').textContent).toBe('Layout saved.'); expect(disabled('Save layout')).toBe(true);
    edit(); expect(x()).toBe('102');
    await settle(job[kind]);
    expect(x()).toBe('102'); expect(screen.getByRole('status').textContent).toBe('Unsaved changes.');
  });
  test('late exact acknowledgement after rejection completes the command', async () => {
    const job = deferred(); const commit = jest.fn((_command: PixelSaveCommand) => job.promise);
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={commit} />);
    edit(); save(); await settle(job.reject);
    view.rerender(<Burn4FreeformLayoutEditor snapshot={commit.mock.calls[0][0].candidate} onCommit={commit} />);
    expect(screen.getByRole('status').textContent).toBe('Layout saved.'); expect(disabled('Move Clock')).toBe(false);
  });
  test.each(['sameRevision', 'wrongRevision', 'wrongGeometry', 'wrongLabel', 'wrongOrder'] as const)('%s cannot acknowledge and conflict requires reload', async kind => {
    const job = deferred(); const commit = jest.fn((_command: PixelSaveCommand) => job.promise);
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={commit} />);
    edit(); save(); const command = commit.mock.calls[0][0]; let host = command.candidate;
    if (kind === 'sameRevision') host = { ...host, revision: 4 };
    if (kind === 'wrongRevision') host = { ...host, revision: 6 };
    if (kind === 'wrongGeometry') host = { ...host, items: fixture().items };
    if (kind === 'wrongLabel') host = { ...host, items: host.items.map(entry => ({ ...entry, label: `${entry.label} changed` })) };
    if (kind === 'wrongOrder') host = { ...host, items: [...host.items].reverse() };
    view.rerender(<Burn4FreeformLayoutEditor snapshot={host} onCommit={commit} />);
    expect(screen.getByRole('status').textContent).toMatch(/layout changed/); expect(disabled('Retry save')).toBe(true);
    await settle(job.resolve); expect(screen.getByRole('status').textContent).toMatch(/layout changed/);
    view.rerender(<Burn4FreeformLayoutEditor snapshot={command.candidate} onCommit={commit} />);
    expect(screen.getByRole('status').textContent).toMatch(/layout changed/);
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
    expect(screen.getByRole('status').textContent).toMatch(/Loaded the latest/); expect(disabled('Save layout')).toBe(true);
    expect(x()).toBe('101');
  });
});
describe('host and component lifetimes', () => {
  test('identical normalized host objects preserve unsaved draft and invalid numeric entry', () => {
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    edit(); fireEvent.change(screen.getByLabelText('width'), { target: { value: '' } });
    view.rerender(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    expect(x()).toBe('101'); expect((screen.getByLabelText('width') as HTMLInputElement).value).toBe('');
  });
  test('clean newer authoritative snapshot replaces geometry and focuses surviving selection after removal', () => {
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    const host = { ...fixture(), revision: 5, items: [fixture().items[1]] };
    view.rerender(<Burn4FreeformLayoutEditor snapshot={host} onCommit={() => undefined} />);
    expect(x()).toBe('400'); expect(screen.getByRole('form', { name: 'Coordinates for Tasks' })).toBeTruthy();
    expect(document.activeElement).toBe(within(screen.getByRole('group', { name: 'Select widget' })).getByRole('button', { name: 'Tasks' }));
  });
  test.each([3, 4])('same or older revision %s with changed content conflicts even while clean', revision => {
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    view.rerender(<Burn4FreeformLayoutEditor snapshot={{ ...changePixelRect(fixture(), 'clock', 'move', 5, 0), revision }} onCommit={() => undefined} />);
    expect(x()).toBe('100'); expect(screen.getByRole('status').textContent).toMatch(/layout changed/);
    expect(disabled('Move Clock')).toBe(true);
  });
  test('newer host also conflicts with unapplied numeric edits and retains the input', () => {
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    fireEvent.change(screen.getByLabelText('x'), { target: { value: '250' } });
    view.rerender(<Burn4FreeformLayoutEditor snapshot={{ ...fixture(), revision: 5 }} onCommit={() => undefined} />);
    expect(x()).toBe('250'); expect(disabled('Move Clock')).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/layout changed/);
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' })); expect(x()).toBe('100');
  });
  test('newer host conflicts with unsaved changes until explicit reload', () => {
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    edit(); const host = { ...changePixelRect(fixture(), 'clock', 'move', 8, 0), revision: 5 };
    view.rerender(<Burn4FreeformLayoutEditor snapshot={host} onCommit={() => undefined} />);
    expect(x()).toBe('101'); expect(disabled('Save layout')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' })); expect(x()).toBe('108');
    edit(); expect(x()).toBe('109');
  });
  test.each(['resolve', 'reject'] as const)('reload fences late callback %s and new draft stays unchanged', async kind => {
    const job = deferred(); const commit = jest.fn((_command: PixelSaveCommand) => job.promise);
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={commit} />);
    edit(); save(); fireEvent.click(screen.getByRole('button', { name: 'Reload latest' })); edit(); edit();
    await settle(job[kind]); expect(x()).toBe('102'); expect(screen.getByRole('status').textContent).toBe('Unsaved changes.');
  });
  test.each(['resolve', 'reject'] as const)('layout identity change fences old callback %s', async kind => {
    const job = deferred(); const commit = jest.fn((_command: PixelSaveCommand) => job.promise);
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={commit} />);
    edit(); save(); view.rerender(<Burn4FreeformLayoutEditor snapshot={{ ...fixture(), layoutId: 'bedroom-pixels' }} onCommit={commit} />);
    expect(x()).toBe('100'); edit(); edit(); await settle(job[kind]); expect(x()).toBe('102');
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes.');
  });
  test('unmount and invalid host discard callbacks without affecting another mounted editor', async () => {
    const job = deferred(); const commit = jest.fn((_command: PixelSaveCommand) => job.promise);
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={commit} />);
    edit(); save(); view.rerender(<Burn4FreeformLayoutEditor snapshot={null} onCommit={commit} />);
    expect(screen.getByRole('alert')).toBeTruthy(); view.unmount();
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />); edit();
    await settle(job.reject); expect(x()).toBe('101'); expect(screen.getByRole('status').textContent).toBe('Unsaved changes.');
  });
  test('revision overflow leaves draft usable with a clear status and no callback', () => {
    const commit = jest.fn();
    render(<Burn4FreeformLayoutEditor snapshot={{ ...fixture(), revision: Number.MAX_SAFE_INTEGER }} onCommit={commit} />);
    edit(); save(); expect(commit).not.toHaveBeenCalled(); expect(screen.getByRole('status').textContent).toMatch(/revision limit/);
    expect(disabled('Move Clock')).toBe(false);
  });
});
