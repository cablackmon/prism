/** @jest-environment jsdom */

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';

jest.mock('@/lib/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

// The Radix progress package is deliberately real, including its ARIA behavior.
describe('Progress with the real Radix primitive', () => {
  test.each([undefined, null])('exposes indeterminate progress when no numeric value is supplied: %s', (value) => {
    render(<Progress value={value} aria-label="Packing" />);
    const bar = screen.getByRole('progressbar', { name: 'Packing' });
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('data-state')).toBe('indeterminate');
  });

  test('forwards the DOM ref, maximum, accessible description and interaction handlers', () => {
    const ref = React.createRef<HTMLDivElement>();
    const onClick = jest.fn();
    const { unmount } = render(<>
      <p id="packing-description">Items still to pack</p>
      <Progress ref={ref} max={12} aria-label="Packing" aria-describedby="packing-description" data-testid="packing" onClick={onClick} />
    </>);
    const bar = screen.getByRole('progressbar', { name: 'Packing' });
    expect(ref.current).toBe(bar);
    expect(bar.getAttribute('aria-valuemax')).toBe('12');
    expect(bar.getAttribute('aria-describedby')).toBe('packing-description');
    expect(bar).toBe(screen.getByTestId('packing'));
    fireEvent.click(bar);
    expect(onClick).toHaveBeenCalledTimes(1);
    unmount();
    expect(ref.current).toBeNull();
  });

  test('updates the visible percentage indicator from empty to partial to complete', () => {
    const { rerender } = render(<Progress value={0} aria-label="Packing" />);
    const indicator = screen.getByRole('progressbar').firstElementChild as HTMLElement;
    expect(indicator.style.transform).toBe('translateX(-100%)');
    rerender(<Progress value={40} aria-label="Packing" />);
    expect(indicator.style.transform).toBe('translateX(-60%)');
    rerender(<Progress value={100} aria-label="Packing" />);
    expect(indicator.style.transform).toBe('translateX(-0%)');
  });

  test.failing('KNOWN GAP: numeric progress is not forwarded to Radix so its current value and formatted label are missing', () => {
    const format = jest.fn((value: number, max: number) => `${value} of ${max} items`);
    render(<Progress value={4} max={8} getValueLabel={format} aria-label="Packing" />);
    const bar = screen.getByRole('progressbar', { name: 'Packing' });
    expect(bar.getAttribute('aria-valuenow')).toBe('4');
    expect(bar.getAttribute('aria-valuetext')).toBe('4 of 8 items');
    expect(format).toHaveBeenCalledWith(4, 8);
  });

  test.failing('KNOWN GAP: numeric progress changes keep Radix accessibility state indeterminate', () => {
    const { rerender } = render(<Progress value={0} aria-label="Packing" />);
    rerender(<Progress value={100} aria-label="Packing" />);
    const bar = screen.getByRole('progressbar', { name: 'Packing' });
    expect(bar.getAttribute('data-state')).toBe('complete');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });
});

describe('Textarea input and ref contracts', () => {
  test('forwards a focusable DOM ref and clears it after unmount', () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    const { unmount } = render(<Textarea ref={ref} aria-label="Notes" />);
    const input = screen.getByRole('textbox', { name: 'Notes' });
    expect(ref.current).toBe(input);
    ref.current!.focus();
    expect(document.activeElement).toBe(input);
    unmount();
    expect(ref.current).toBeNull();
  });

  test('forwards labels, multiline defaults, validation and form fields', () => {
    const { container } = render(<form>
      <label htmlFor="trip-notes">Trip notes</label>
      <p id="notes-help">Keep the itinerary here</p>
      <Textarea id="trip-notes" name="notes" rows={5} required maxLength={300} aria-describedby="notes-help" defaultValue={'First line\nSecond line'} />
    </form>);
    const input = screen.getByRole('textbox', { name: 'Trip notes' }) as HTMLTextAreaElement;
    expect(input.value).toBe('First line\nSecond line');
    expect(input.rows).toBe(5);
    expect(input.required).toBe(true);
    expect(input.maxLength).toBe(300);
    expect(input.getAttribute('aria-describedby')).toBe('notes-help');
    expect(new FormData(container.querySelector('form')!).get('notes')).toBe('First line\nSecond line');
  });

  test('supports a controlled multiline edit through onChange and forwards onInput', () => {
    const onInput = jest.fn();
    function Editor() {
      const [value, setValue] = React.useState('Initial');
      return <Textarea aria-label="Notes" value={value} onInput={onInput} onChange={(event) => setValue(event.target.value)} />;
    }
    render(<Editor />);
    const input = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'Edited\nWith another line' } });
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('Edited\nWith another line');
    fireEvent.change(input, { target: { value: 'Final text' } });
    expect(input.value).toBe('Final text');
  });

  test('preserves native disabled and readonly behavior across prop changes', () => {
    const { container, rerender } = render(<form><Textarea aria-label="Notes" name="notes" defaultValue="Private draft" disabled /></form>);
    const input = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(new FormData(container.querySelector('form')!).has('notes')).toBe(false);
    input.focus();
    expect(document.activeElement).not.toBe(input);
    rerender(<form><Textarea aria-label="Notes" name="notes" defaultValue="Private draft" readOnly /></form>);
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(new FormData(container.querySelector('form')!).get('notes')).toBe('Private draft');
  });

  test('forwards focus, blur and keyboard callbacks to the actual textarea', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const onKeyDown = jest.fn();
    render(<Textarea aria-label="Notes" onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown} />);
    const input = screen.getByRole('textbox', { name: 'Notes' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0]![0].key).toBe('Escape');
    expect(onKeyDown.mock.calls[0]![0].target).toBe(input);
  });
});
