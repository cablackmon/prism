import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Burn4SpeechInputPanel } from '../../components/input/Burn4SpeechInputPanel';
import { makeTarget, panelProps } from './burn4-fixtures';

let resizeInstances: FakeResize[];
let mutationInstances: FakeMutation[];
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
let resizeDescriptor: PropertyDescriptor | undefined;
let mutationDescriptor: PropertyDescriptor | undefined;

class FakeResize {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
  constructor(readonly callback: () => void) { resizeInstances.push(this); }
}
class FakeMutation {
  observe = jest.fn();
  disconnect = jest.fn();
  takeRecords = (): MutationRecord[] => [];
  constructor(readonly callback: () => void) { mutationInstances.push(this); }
}

beforeEach(() => {
  resizeInstances = []; mutationInstances = []; frames = new Map(); sequence = 0;
  resizeDescriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
  mutationDescriptor = Object.getOwnPropertyDescriptor(window, 'MutationObserver');
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: FakeResize });
  Object.defineProperty(window, 'MutationObserver', { configurable: true, value: FakeMutation });
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++sequence, callback); return sequence; });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
});
afterEach(() => {
  cleanup(); document.body.replaceChildren(); jest.restoreAllMocks();
  if (resizeDescriptor) Object.defineProperty(window, 'ResizeObserver', resizeDescriptor);
  else Reflect.deleteProperty(window, 'ResizeObserver');
  if (mutationDescriptor) Object.defineProperty(window, 'MutationObserver', mutationDescriptor);
  else Reflect.deleteProperty(window, 'MutationObserver');
});

function flushFrames(): void {
  const pending = Array.from(frames.values());
  frames.clear();
  act(() => { for (const callback of pending) callback(0); });
}

test('scroll and resize are coalesced and recompute the target position', () => {
  const target = makeTarget();
  render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  expect(screen.getByRole('region').style.top).toBe('172px');
  target.getBoundingClientRect = () => ({ left: 100, top: 500, width: 200, height: 40, right: 300, bottom: 540, x: 100, y: 500, toJSON: () => ({}) });
  fireEvent.scroll(document.body);
  fireEvent.resize(window);
  expect(frames.size).toBe(1);
  flushFrames();
  expect(screen.getByRole('region').style.top).toBe('372px');
});

test('observes both target and panel and cleans every observer, listener and queued frame', () => {
  const add = jest.spyOn(window, 'addEventListener');
  const remove = jest.spyOn(window, 'removeEventListener');
  const target = makeTarget();
  const { unmount } = render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  const resize = resizeInstances[0];
  const mutation = mutationInstances[0];
  expect(resize?.observe).toHaveBeenCalledWith(target);
  expect(resize?.observe).toHaveBeenCalledWith(screen.getByRole('region'));
  expect(mutation?.observe).toHaveBeenCalledWith(document.documentElement, expect.objectContaining({
    childList: true, subtree: true, attributes: true,
    attributeFilter: expect.arrayContaining(['disabled', 'readonly', 'type', 'contenteditable', 'aria-disabled', 'aria-readonly', 'hidden', 'inert']),
  }));
  fireEvent.resize(window);
  expect(frames.size).toBe(1);
  const callback = Array.from(frames.values())[0];
  unmount();
  expect(frames.size).toBe(0);
  expect(resize?.disconnect).toHaveBeenCalledTimes(1);
  expect(mutation?.disconnect).toHaveBeenCalledTimes(1);
  for (const [name, listener, options] of add.mock.calls.filter(([name]) => name === 'resize' || name === 'scroll')) {
    if (options === undefined) expect(remove).toHaveBeenCalledWith(name, listener);
    else expect(remove).toHaveBeenCalledWith(name, listener, options);
  }
  act(() => { callback?.(0); resize?.callback(); mutation?.callback(); });
  expect(frames.size).toBe(0);
  expect(screen.queryByRole('region')).toBeNull();
});

test('hide and session/target replacements tear down previous subscriptions', () => {
  const a = makeTarget();
  const b = makeTarget();
  const props = panelProps(a);
  const { rerender } = render(<Burn4SpeechInputPanel {...props} />);
  const first = resizeInstances[0];
  fireEvent.resize(window);
  rerender(<Burn4SpeechInputPanel {...props} activeTarget={b} activeSessionId="two" />);
  expect(first?.disconnect).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
  const second = resizeInstances.at(-1);
  rerender(<Burn4SpeechInputPanel {...props} visible={false} />);
  expect(second?.disconnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('region')).toBeNull();
  expect(frames.size).toBe(0);
});

test('ResizeObserver callback measures changed panel content height', () => {
  render(<Burn4SpeechInputPanel {...panelProps(makeTarget())} />);
  const panel = screen.getByRole('region');
  Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: 200 });
  resizeInstances[0]?.callback();
  flushFrames();
  expect(panel.style.top).toBe('92px');
});

test('missing ResizeObserver still supports scroll and resize updates', () => {
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: undefined });
  const target = makeTarget();
  render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  target.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 40, right: 110, bottom: 50, x: 10, y: 10, toJSON: () => ({}) });
  fireEvent.resize(window);
  flushFrames();
  expect(screen.getByRole('region').getAttribute('data-placement')).toBe('below');
});

test('missing animation-frame support uses bounded synchronous measurement', () => {
  Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: undefined });
  try {
    render(<Burn4SpeechInputPanel {...panelProps(makeTarget())} />);
    fireEvent.resize(window);
    expect(screen.getByRole('region').style.top).toBe('172px');
  } finally {
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: jest.fn((callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; }) });
  }
});

test('target removal or changed privacy attributes hides feedback after observed mutation', () => {
  const target = makeTarget() as HTMLInputElement;
  render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  target.type = 'password';
  mutationInstances[0]?.callback();
  flushFrames();
  expect(screen.queryByRole('status')).toBeNull();
  expect(document.querySelector('[data-burn4-speech-panel]')).toBeNull();
});

test('removing the target removes the portal and document keyboard listener', () => {
  const add = jest.spyOn(document, 'addEventListener');
  const remove = jest.spyOn(document, 'removeEventListener');
  const target = makeTarget();
  const props = panelProps(target);
  render(<Burn4SpeechInputPanel {...props} />);
  target.remove();
  mutationInstances[0]?.callback();
  flushFrames();
  expect(document.querySelector('[data-burn4-speech-panel]')).toBeNull();
  for (const [name, listener] of add.mock.calls.filter(([name]) => name === 'keydown')) {
    expect(remove).toHaveBeenCalledWith(name, listener);
  }
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(props.onStop).not.toHaveBeenCalled();
});

test('offscreen geometry hides the panel and re-entry restores it', () => {
  const target = makeTarget();
  const original = target.getBoundingClientRect;
  render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  target.getBoundingClientRect = () => ({ ...original(), top: -100, bottom: -60 });
  fireEvent.scroll(document.body);
  flushFrames();
  expect(screen.queryByRole('region')).toBeNull();
  target.getBoundingClientRect = original;
  fireEvent.scroll(document.body);
  flushFrames();
  expect(screen.getByRole('region').style.visibility).toBe('visible');
});

test('privacy changes remove even an already hidden offscreen portal', () => {
  const target = makeTarget() as HTMLInputElement;
  target.getBoundingClientRect = () => ({ left: 10, top: -100, width: 100, height: 40, right: 110, bottom: -60, x: 10, y: -100, toJSON: () => ({}) });
  render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  expect(screen.queryByRole('region')).toBeNull();
  expect(document.querySelector('[data-burn4-speech-panel]')).not.toBeNull();
  target.type = 'password';
  mutationInstances[0]?.callback();
  flushFrames();
  expect(document.querySelector('[data-burn4-speech-panel]')).toBeNull();
});

test('multiple panel instances remove only their own subscriptions', () => {
  const a = panelProps(makeTarget());
  const b = panelProps(makeTarget());
  const first = render(<Burn4SpeechInputPanel {...a} />);
  const second = render(<Burn4SpeechInputPanel {...b} />);
  first.unmount();
  expect(screen.getAllByRole('region')).toHaveLength(1);
  expect(resizeInstances[0]?.disconnect).toHaveBeenCalledTimes(1);
  expect(resizeInstances[1]?.disconnect).not.toHaveBeenCalled();
  second.unmount();
  expect(resizeInstances[1]?.disconnect).toHaveBeenCalledTimes(1);
});
