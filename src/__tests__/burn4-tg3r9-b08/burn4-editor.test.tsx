import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Burn4FreeformLayoutEditor } from '../../components/layout/burn4-freeform-layout-editor';
import { readPixelLayout } from '../../lib/burn4-freeform-layout';

const fixture = () => readPixelLayout({ schemaVersion: 1, layoutId: 'kitchen-pixels', revision: 4,
  canvas: { width: 1000, height: 500 }, items: [
    { id: 'clock', label: 'Clock', x: 100, y: 50, width: 200, height: 100, minWidth: 20, minHeight: 10 },
    { id: 'tasks', label: 'Tasks', x: 400, y: 200, width: 100, height: 80, minWidth: 30, minHeight: 20 }] });
const rect = (id = 'clock') => document.querySelector(`[data-widget-id="${id}"]`) as HTMLDivElement;
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;
class LocalPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true; }
}
const originalPointer = Object.getOwnPropertyDescriptor(window, 'PointerEvent');
beforeAll(() => { Object.defineProperty(window, 'PointerEvent', { configurable: true, value: LocalPointerEvent }); });
afterAll(() => {
  if (originalPointer) Object.defineProperty(window, 'PointerEvent', originalPointer);
  else Reflect.deleteProperty(window, 'PointerEvent');
});
afterEach(cleanup);
function pointerSetup(name = 'Move Clock') {
  const handle = screen.getByRole('button', { name });
  const capture = jest.fn(); const release = jest.fn();
  Object.assign(handle, { setPointerCapture: capture, releasePointerCapture: release });
  const canvas = screen.getByLabelText('Pixel canvas');
  jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 500, bottom: 100, width: 500, height: 100, toJSON: () => ({}) });
  return { handle, capture, release };
}
function start(handle: HTMLElement, extra = {}) {
  fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 100, clientY: 50, ...extra });
}
describe('rendered pixel editor', () => {
  test('renders proportional geometry with explicit pixel dimensions and selection', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    expect(rect().style.left).toBe('10%'); expect(rect().style.top).toBe('10%');
    expect(rect().style.width).toBe('20%'); expect(rect().style.height).toBe('20%');
    expect(screen.getByText(/1000 by 500/)).toBeTruthy();
    expect(field('x').value).toBe('100');
    fireEvent.click(within(screen.getByRole('group', { name: 'Select widget' })).getByRole('button', { name: 'Tasks' }));
    expect(field('x').value).toBe('400');
    expect(screen.getByRole('form', { name: 'Coordinates for Tasks' })).toBeTruthy();
    expect(disabled('Save layout')).toBe(true);
  });
  test('exact numeric entry changes all rectangle values and retains other widgets', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    for (const [name, value] of Object.entries({ x: '420', y: '210', width: '120', height: '80' })) fireEvent.change(field(name), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' }));
    expect(rect().style.left).toBe('42%'); expect(rect().style.top).toBe('42%');
    expect(rect().style.width).toBe('12%'); expect(rect('tasks').style.left).toBe('40%');
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes.');
  });
  test.each(['', '-1', '0.5', '99999'])('invalid exact entry %s retains editable input and linked error', value => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    fireEvent.change(field('x'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' }));
    expect(rect().style.left).toBe('10%'); expect(field('x').value).toBe(value);
    expect(field('x').getAttribute('aria-invalid')).toBe('true');
    expect(field('x').getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    fireEvent.change(field('x'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' }));
    expect(rect().style.left).toBe('20%'); expect(screen.queryByRole('alert')).toBeNull();
  });
  test.each([['ArrowLeft', false, '9.9%', '10%'], ['ArrowRight', true, '11%', '10%'],
    ['ArrowUp', true, '10%', '8%'], ['ArrowDown', false, '10%', '10.2%']] as const)('keyboard %s with shift %s moves actual pixels', (key, shiftKey, left, top) => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Clock' }), { key, shiftKey });
    expect(rect().style.left).toBe(left); expect(rect().style.top).toBe(top);
  });
  test('keyboard resize respects minimum size and canvas edges', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    const handle = screen.getByRole('button', { name: 'Resize Clock' });
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(field('width').value).toBe('210'); expect(field('height').value).toBe('101');
    fireEvent.change(field('width'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' }));
    fireEvent.keyDown(handle, { key: 'ArrowLeft' }); expect(field('width').value).toBe('20');
    fireEvent.change(field('x'), { target: { value: '980' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' }));
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true }); expect(field('width').value).toBe('20');
  });
  test('unrelated keys and modified arrows do not edit', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    const handle = screen.getByRole('button', { name: 'Move Clock' });
    for (const event of [{ key: 'a' }, { key: 'ArrowRight', ctrlKey: true }, { key: 'ArrowRight', metaKey: true }, { key: 'ArrowRight', altKey: true }]) fireEvent.keyDown(handle, event);
    expect(field('x').value).toBe('100');
  });
  test('reset discards draft and selection remains usable', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Clock' }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset draft' }));
    expect(field('x').value).toBe('100'); expect(disabled('Reset draft')).toBe(true);
  });
  test('unapplied coordinates block save and reset/reload restore fields even without geometry changes', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    fireEvent.change(field('x'), { target: { value: '' } });
    expect(disabled('Save layout')).toBe(true); expect(disabled('Reset draft')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reset draft' })); expect(field('x').value).toBe('100');
    fireEvent.change(field('width'), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' })); expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
    expect(field('width').value).toBe('200'); expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Clock' }), { key: 'ArrowRight' });
    fireEvent.change(field('x'), { target: { value: '200' } }); expect(disabled('Save layout')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' })); expect(disabled('Save layout')).toBe(false);
  });
  test('invalid host is an accessible error and empty host is usable', () => {
    const view = render(<Burn4FreeformLayoutEditor snapshot={null} onCommit={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toMatch(/invalid/);
    view.rerender(<Burn4FreeformLayoutEditor snapshot={{ ...fixture(), items: [] }} onCommit={() => undefined} />);
    expect(screen.getByText('No widgets in this layout.')).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull(); expect(disabled('Save layout')).toBe(true);
  });
  test('literal labels do not become markup and multiple editors have unique input links', () => {
    const host = { ...fixture(), items: [{ ...fixture().items[0], label: '<b>Clock</b>' }] };
    const view = render(<><Burn4FreeformLayoutEditor snapshot={host} onCommit={() => undefined} /><Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} /></>);
    expect(view.container.querySelector('b')).toBeNull();
    const inputs = screen.getAllByLabelText('x'); expect(inputs[0].id).not.toBe(inputs[1].id);
  });
});
describe('captured pointer geometry', () => {
  test('move converts CSS distance per axis and commits the final pointerup position', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    const { handle, capture, release } = pointerSetup(); start(handle);
    expect(capture).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 105, clientY: 52 });
    expect(field('x').value).toBe('110'); expect(field('y').value).toBe('60');
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 110, clientY: 54 });
    expect(field('x').value).toBe('120'); expect(field('y').value).toBe('70');
    expect(release).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 400, clientY: 50 }); expect(field('x').value).toBe('120');
  });
  test('resize uses original gesture size rather than accumulating movement and clamps edges', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    const { handle } = pointerSetup('Resize Clock'); start(handle);
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 110, clientY: 52 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 110, clientY: 52 });
    expect(field('width').value).toBe('220'); expect(field('height').value).toBe('110');
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 10000, clientY: -10000 });
    expect(field('width').value).toBe('900'); expect(field('height').value).toBe('10');
  });
  test.each(['pointerCancel', 'lostPointerCapture', 'escape'] as const)('%s restores only the current gesture origin', kind => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Clock' }), { key: 'ArrowRight' });
    const { handle, release } = pointerSetup(); start(handle);
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 130, clientY: 80 });
    if (kind === 'escape') fireEvent.keyDown(handle, { key: 'Escape' });
    else fireEvent[kind](handle, { pointerId: 7 });
    expect(field('x').value).toBe('101'); expect(field('y').value).toBe('50'); expect(release).toHaveBeenCalledWith(7);
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 130, clientY: 80 }); expect(field('x').value).toBe('101');
  });
  test('ignores other pointers, secondary buttons and a second gesture', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    const { handle, capture } = pointerSetup();
    start(handle, { button: 2 }); start(handle, { isPrimary: false }); expect(capture).not.toHaveBeenCalled();
    start(handle); start(handle, { pointerId: 8 }); expect(capture).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 200, clientY: 80 });
    fireEvent.pointerCancel(handle, { pointerId: 8 }); expect(field('x').value).toBe('100');
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 105, clientY: 50 }); expect(field('x').value).toBe('110');
  });
  test('unmeasurable canvas falls back to keyboard and exact entry', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    const handle = screen.getByRole('button', { name: 'Move Clock' }); start(handle);
    expect(screen.getByRole('status').textContent).toMatch(/Pointer editing is unavailable/);
    fireEvent.keyDown(handle, { key: 'ArrowRight' }); expect(field('x').value).toBe('101');
  });
  test('capture failure leaves no active gesture', () => {
    render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    const { handle } = pointerSetup(); Object.assign(handle, { setPointerCapture: () => { throw new Error('unavailable'); } });
    start(handle); fireEvent.pointerMove(handle, { pointerId: 7, clientX: 200, clientY: 80 });
    expect(field('x').value).toBe('100'); expect(screen.getByRole('status').textContent).toMatch(/unavailable/);
  });
  test('unmount releases captured pointer without changing document properties', () => {
    const view = render(<Burn4FreeformLayoutEditor snapshot={fixture()} onCommit={() => undefined} />);
    const { handle, release } = pointerSetup(); const previous = document.onpointermove;
    start(handle); view.unmount(); expect(release).toHaveBeenCalledWith(7); expect(document.onpointermove).toBe(previous);
  });
});
