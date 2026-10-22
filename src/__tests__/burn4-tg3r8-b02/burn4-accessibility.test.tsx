import React from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Burn4SpeechInputPanel } from '../../components/input/Burn4SpeechInputPanel';
import { makeTarget, panelProps } from './burn4-fixtures';

afterEach(() => { cleanup(); document.body.replaceChildren(); });

test('native controls have accessible names and polite atomic interim status', () => {
  render(<Burn4SpeechInputPanel {...panelProps(makeTarget())} />);
  expect(screen.getByRole('region', { name: 'Voice input' })).toBeDefined();
  expect(screen.getByRole('combobox', { name: 'Speech language' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Stop listening' })).toBeDefined();
  const status = screen.getByRole('status');
  expect(status.getAttribute('aria-live')).toBe('polite');
  expect(status.getAttribute('aria-atomic')).toBe('true');
  expect((screen.getByRole('button') as HTMLButtonElement).style.minHeight).toBe('44px');
});

test('pointer stop retains target focus and latches duplicate stop requests', () => {
  const target = makeTarget();
  const props = panelProps(target);
  target.focus();
  render(<Burn4SpeechInputPanel {...props} />);
  const button = screen.getByRole('button');
  expect(fireEvent.pointerDown(button)).toBe(false);
  fireEvent.click(button);
  fireEvent.click(button);
  fireEvent.keyDown(target, { key: 'Escape' });
  expect(document.activeElement).toBe(target);
  expect(props.onStop).toHaveBeenCalledTimes(1);
  expect(props.onStop).toHaveBeenCalledWith('one');
});

test('native button keyboard activation and Escape stop the current session', () => {
  const props = panelProps(makeTarget());
  const { rerender } = render(<Burn4SpeechInputPanel {...props} />);
  const button = screen.getByRole('button');
  button.focus();
  fireEvent.click(button, { detail: 0 });
  expect(props.onStop).toHaveBeenCalledTimes(1);
  rerender(<Burn4SpeechInputPanel {...props} activeSessionId="two" feedback={{ ...props.feedback!, sessionId: 'two' }} />);
  screen.getByRole('button').focus();
  expect(fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' })).toBe(false);
  expect(props.onStop).toHaveBeenLastCalledWith('two');
});

test('Escape only applies while focus belongs to the target or panel', () => {
  const target = makeTarget();
  const elsewhere = makeTarget();
  const props = panelProps(target);
  render(<Burn4SpeechInputPanel {...props} />);
  elsewhere.focus();
  fireEvent.keyDown(elsewhere, { key: 'Escape' });
  target.focus();
  fireEvent.keyDown(target, { key: 'Enter' });
  fireEvent.keyDown(target, { key: 'Escape', isComposing: true });
  const prevented = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  prevented.preventDefault();
  fireEvent(target, prevented);
  expect(props.onStop).not.toHaveBeenCalled();
  fireEvent.keyDown(target, { key: 'Escape' });
  expect(props.onStop).toHaveBeenCalledTimes(1);
});

test('stop latch resets for a new target/session and never stops stale feedback', () => {
  const a = makeTarget();
  const b = makeTarget();
  const props = panelProps(a);
  const { rerender } = render(<Burn4SpeechInputPanel {...props} />);
  fireEvent.click(screen.getByRole('button'));
  rerender(<Burn4SpeechInputPanel {...props} activeTarget={b} activeSessionId="two" />);
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<Burn4SpeechInputPanel {...props} activeTarget={b} activeSessionId="two" feedback={{ ...props.feedback!, target: b, sessionId: 'two' }} />);
  fireEvent.click(screen.getByRole('button'));
  expect(props.onStop).toHaveBeenCalledTimes(2);
  expect(props.onStop).toHaveBeenLastCalledWith('two');
});

test('hiding and restoring the same session does not repeat its stop callback', () => {
  const props = panelProps(makeTarget());
  const { rerender } = render(<Burn4SpeechInputPanel {...props} />);
  fireEvent.click(screen.getByRole('button'));
  rerender(<Burn4SpeechInputPanel {...props} visible={false} />);
  rerender(<Burn4SpeechInputPanel {...props} />);
  fireEvent.click(screen.getByRole('button'));
  expect(props.onStop).toHaveBeenCalledTimes(1);
});

test('language labels are text and instances have independent label/control IDs', () => {
  const a = panelProps(makeTarget());
  const b = panelProps(makeTarget());
  render(<>
    <Burn4SpeechInputPanel {...a} activeSessionId={null} feedback={null} languages={[{ tag: 'en-US', label: '<img src=x onerror=run()>' }]} />
    <Burn4SpeechInputPanel {...b} activeSessionId={null} feedback={null} />
  </>);
  const selects = screen.getAllByRole('combobox', { name: 'Speech language' });
  expect(selects[0]?.id).not.toBe(selects[1]?.id);
  expect(screen.getByRole('option', { name: '<img src=x onerror=run()>' })).toBeDefined();
  expect(document.querySelector('img')).toBeNull();
});

test('server rendering is inert and produces no portal or layout-effect warning', () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const props = panelProps(makeTarget());
  try {
    expect(renderToString(<Burn4SpeechInputPanel {...props} />)).toBe('');
    expect(error).not.toHaveBeenCalled();
    expect(props.onStop).not.toHaveBeenCalled();
    expect(props.onLanguageChange).not.toHaveBeenCalled();
  } finally { error.mockRestore(); }
});

test('a disconnected or restricted target cannot receive late callbacks', () => {
  const target = makeTarget() as HTMLInputElement;
  const props = panelProps(target);
  const { rerender } = render(<Burn4SpeechInputPanel {...props} />);
  const button = screen.getByRole('button');
  target.remove();
  fireEvent.click(button);
  expect(props.onStop).not.toHaveBeenCalled();
  document.body.append(target);
  rerender(<Burn4SpeechInputPanel {...props} activeSessionId={null} feedback={null} />);
  const select = screen.getByRole('combobox');
  target.readOnly = true;
  fireEvent.change(select, { target: { value: 'es-MX' } });
  expect(props.onLanguageChange).not.toHaveBeenCalled();
});
