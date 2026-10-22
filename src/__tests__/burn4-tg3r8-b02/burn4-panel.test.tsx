import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Burn4SpeechInputPanel } from '../../components/input/Burn4SpeechInputPanel';
import { makeTarget, panelProps } from './burn4-fixtures';

afterEach(() => { cleanup(); document.body.replaceChildren(); });

test('renders live interim feedback above the explicit input without changing its value', () => {
  const target = makeTarget() as HTMLInputElement;
  target.value = 'Existing';
  render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  expect(screen.getByRole('status').textContent).toBe('Interim speech: Hello there');
  expect(screen.getByRole('region').getAttribute('data-placement')).toBe('above');
  expect(target.value).toBe('Existing');
  expect(screen.getByRole('combobox').getAttribute('disabled')).toBe('');
});

test.each(['text', 'search', 'email'])('accepts an explicit writable %s input', (type) => {
  const target = makeTarget() as HTMLInputElement;
  target.type = type;
  render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  expect(screen.getByRole('status').textContent).toContain('Hello there');
});

test.each(['textarea', 'editable', 'editable-child', 'plaintext'])('accepts %s', (kind) => {
  const target = makeTarget(kind === 'textarea' ? 'textarea' : 'div');
  if (kind !== 'textarea') target.setAttribute('contenteditable', kind === 'plaintext' ? 'plaintext-only' : 'true');
  if (kind === 'editable-child') {
    const parent = document.createElement('div');
    parent.setAttribute('contenteditable', '');
    target.removeAttribute('contenteditable');
    document.body.append(parent);
    parent.append(target);
  }
  render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  expect(screen.getByRole('region')).toBeDefined();
});

test.each(['password', 'number', 'date', 'time', 'file', 'hidden', 'checkbox'])('never renders feedback for %s inputs', (type) => {
  const target = makeTarget() as HTMLInputElement;
  target.type = type;
  render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  expect(screen.queryByRole('region')).toBeNull();
  expect(document.body.textContent).not.toContain('Hello there');
});

test.each(['disabled', 'readonly', 'inert', 'hidden', 'aria-disabled', 'aria-readonly', 'fieldset', 'removed', 'contenteditable-false', 'select'])('suppresses %s targets', (kind) => {
  const target = makeTarget(kind.startsWith('contenteditable') ? 'div' : kind === 'select' ? 'select' : 'input');
  if (kind === 'readonly') target.setAttribute('readonly', '');
  else if (kind === 'aria-disabled' || kind === 'aria-readonly') target.setAttribute(kind, 'true');
  else if (kind === 'contenteditable-false') target.setAttribute('contenteditable', 'false');
  else if (kind === 'fieldset') {
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    document.body.append(fieldset);
    fieldset.append(target);
  } else if (kind === 'removed') target.remove();
  else if (kind !== 'select') target.setAttribute(kind, '');
  render(<Burn4SpeechInputPanel {...panelProps(target)} />);
  expect(screen.queryByRole('region')).toBeNull();
});

test('null target and explicit hidden state produce no portal', () => {
  const props = panelProps(makeTarget());
  const { rerender } = render(<Burn4SpeechInputPanel {...props} activeTarget={null} />);
  expect(screen.queryByRole('region')).toBeNull();
  rerender(<Burn4SpeechInputPanel {...props} visible={false} />);
  expect(screen.queryByRole('region')).toBeNull();
});

test('shows plain interim text, updates partials and never inserts text or marks it final', () => {
  const target = makeTarget() as HTMLInputElement;
  target.value = 'Existing';
  const props = panelProps(target);
  const input = jest.fn();
  target.addEventListener('input', input);
  const { rerender } = render(<Burn4SpeechInputPanel {...props} />);
  rerender(<Burn4SpeechInputPanel {...props} feedback={{ ...props.feedback!, interimText: '<img src=x onerror=alert(1)>\nمرحبا' }} />);
  expect(screen.getByRole('status').textContent).toContain('<img src=x onerror=alert(1)>\nمرحبا');
  expect(document.querySelector('img')).toBeNull();
  expect(target.value).toBe('Existing');
  expect(input).not.toHaveBeenCalled();
  rerender(<Burn4SpeechInputPanel {...props} feedback={{ ...props.feedback!, isListening: false, interimText: 'Final words' }} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(target.value).toBe('Existing');
});

test('empty partials report listening and long Unicode is bounded without hidden full text', () => {
  const props = panelProps(makeTarget());
  const { rerender } = render(<Burn4SpeechInputPanel {...props} feedback={{ ...props.feedback!, interimText: ' \n ' }} />);
  expect(screen.getByRole('status').textContent).toContain('Listening…');
  rerender(<Burn4SpeechInputPanel {...props} feedback={{ ...props.feedback!, interimText: '🙂'.repeat(2001) }} />);
  expect(screen.getByRole('status').textContent).toBe(`Interim speech: ${'🙂'.repeat(2000)}…`);
  expect(document.body.innerHTML).not.toContain('🙂'.repeat(2001));
});

test('independent session identity fences delayed same-target results and A to B to A switches', () => {
  const a = makeTarget();
  const b = makeTarget();
  const props = panelProps(a);
  const { rerender } = render(<Burn4SpeechInputPanel {...props} />);
  rerender(<Burn4SpeechInputPanel {...props} activeSessionId="two" />);
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<Burn4SpeechInputPanel {...props} activeTarget={b} activeSessionId="two" />);
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<Burn4SpeechInputPanel {...props} activeTarget={a} activeSessionId="three" />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(props.onStop).not.toHaveBeenCalled();
  rerender(<Burn4SpeechInputPanel {...props} activeSessionId="three" feedback={{ ...props.feedback!, sessionId: 'three', interimText: 'Current' }} />);
  expect(screen.getByRole('status').textContent).toContain('Current');
});

test('controlled language changes only emit a different allowed canonical choice while idle', () => {
  const props = panelProps(makeTarget());
  render(<Burn4SpeechInputPanel {...props} activeSessionId={null} feedback={null} language="en-us" />);
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  expect(select.value).toBe('en-US');
  fireEvent.change(select, { target: { value: 'en-US' } });
  fireEvent.change(select, { target: { value: 'unknown' } });
  expect(props.onLanguageChange).not.toHaveBeenCalled();
  fireEvent.change(select, { target: { value: 'es-MX' } });
  expect(props.onLanguageChange).toHaveBeenCalledTimes(1);
  expect(props.onLanguageChange).toHaveBeenCalledWith('es-MX');
  expect(select.value).toBe('en-US');
});

test('pending and listening sessions cannot change language even through synthetic events', () => {
  const props = panelProps(makeTarget());
  const { rerender } = render(<Burn4SpeechInputPanel {...props} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'es-MX' } });
  rerender(<Burn4SpeechInputPanel {...props} feedback={null} />);
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'es-MX' } });
  expect(props.onLanguageChange).not.toHaveBeenCalled();
});

test('invalid languages and session IDs render value-free errors with no speech controls', () => {
  const props = panelProps(makeTarget());
  const { rerender } = render(<Burn4SpeechInputPanel {...props} language="private invalid language" />);
  expect(screen.getByRole('alert').textContent).toBe('Speech languages are not configured correctly.');
  expect(document.body.textContent).not.toContain('private invalid language');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<Burn4SpeechInputPanel {...props} activeSessionId={'x'.repeat(129)} />);
  expect(screen.getByRole('alert').textContent).toBe('Speech session is not configured correctly.');
});

test.each([
  ['hidden', false], ['aria-readonly', false], ['hidden', true], ['aria-readonly', true],
] as const)('real mutation delivery suppresses %s privacy changes on ancestor=%s', async (attribute, ancestor) => {
  const pending = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  const request = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    pending.set(++sequence, callback);
    return sequence;
  });
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { pending.delete(id); });
  const target = makeTarget();
  const wrapper = document.createElement('div');
  document.body.append(wrapper);
  wrapper.append(target);
  try {
    render(<Burn4SpeechInputPanel {...panelProps(target)} />);
    expect(screen.getByRole('status')).toBeDefined();
    await act(async () => {
      (ancestor ? wrapper : target).setAttribute(attribute, attribute === 'hidden' ? '' : 'true');
      await Promise.resolve();
    });
    const frames = Array.from(pending.values());
    pending.clear();
    act(() => { for (const frame of frames) frame(0); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('[data-burn4-speech-panel]')).toBeNull();
  } finally {
    cleanup(); request.mockRestore(); cancel.mockRestore();
  }
});
