/** @jest-environment jsdom */

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { StarRating } from '@/app/weekend/components/StarRating';

jest.mock('@/lib/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

function filledCount() {
  return screen.getAllByRole('button').filter((button) => button.classList.contains('opacity-100')).length;
}

describe('StarRating display and interactions', () => {
  test.each([null, 0, 3, 5])('displays the current rating %s through the five star states', (value) => {
    render(<StarRating value={value} />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(filledCount()).toBe(value ?? 0);
  });

  test('provides singular and plural star labels and disables every read-only control', () => {
    render(<StarRating value={2} size="sm" className="fixture-rating" />);
    expect(screen.getByRole('button', { name: '1 star' })).toBeTruthy();
    for (const count of [2, 3, 4, 5]) {
      expect(screen.getByRole('button', { name: `${count} stars` })).toBeTruthy();
    }
    expect(screen.getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByRole('button', { name: '1 star' }).parentElement!.classList.contains('fixture-rating')).toBe(true);
  });

  test('emits each selected numeric value without submitting a surrounding form', () => {
    const onChange = jest.fn();
    const onSubmit = jest.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={onSubmit}><StarRating value={null} onChange={onChange} /></form>);
    for (const count of [1, 2, 3, 4, 5]) {
      const button = screen.getByRole('button', { name: `${count} star${count === 1 ? '' : 's'}` }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
    }
    expect(onChange.mock.calls).toEqual([[1], [2], [3], [4], [5]]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(filledCount()).toBe(0);
  });

  test('updates its visible rating when a parent accepts the selection', () => {
    function RatingEditor() {
      const [rating, setRating] = React.useState<number | null>(null);
      return <StarRating value={rating} onChange={setRating} />;
    }
    render(<RatingEditor />);
    fireEvent.click(screen.getByRole('button', { name: '4 stars' }));
    expect(filledCount()).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: '1 star' }));
    expect(filledCount()).toBe(1);
  });

  test('stops emitting selections after changing from editable to read-only', () => {
    const onChange = jest.fn();
    const { rerender } = render(<StarRating value={3} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '2 stars' }));
    expect(onChange).toHaveBeenCalledWith(2);
    onChange.mockClear();
    rerender(<StarRating value={3} />);
    fireEvent.click(screen.getByRole('button', { name: '5 stars' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(filledCount()).toBe(3);
  });

  test.failing('KNOWN GAP: read-only star rating exposes no accessible current value or selected state', () => {
    render(<StarRating value={3} />);
    const selectedChoice = screen.queryByRole('button', { name: '3 stars', pressed: true })
      ?? screen.queryByRole('radio', { name: '3 stars', checked: true });
    const numericValue = screen.queryByRole('meter', { value: { now: 3, max: 5 } });
    const currentRating = /\b3\b.*(?:\/|\bof\b).*\b5\b/i;
    const namedRating = screen.queryByRole('img', { name: currentRating })
      ?? screen.queryByRole('group', { name: currentRating });
    const announcedText = screen.queryByText(currentRating);
    const readableText = announcedText !== null && announcedText.closest('[aria-hidden="true"]') === null;
    expect(selectedChoice !== null || numericValue !== null || namedRating !== null || readableText).toBe(true);
  });
});
