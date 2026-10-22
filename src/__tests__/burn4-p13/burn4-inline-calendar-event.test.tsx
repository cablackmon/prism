/** @jest-environment jsdom */
import * as React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { InlineCalendarEvent } from '@/components/calendar/cells/InlineCalendarEvent';
import type { CalendarEvent } from '@/types/calendar';

let mockClock = { timeFormat: '24h', displayTimezone: 'Etc/UTC' };
const mockFormatTime = jest.fn<string, unknown[]>();
const mockIsPast = jest.fn<boolean, unknown[]>();
const mockContrast = jest.fn<string, [string]>();

jest.mock('@/components/providers', () => ({ useTimeFormat: () => mockClock }));
jest.mock('@/lib/utils/timeFormat', () => ({
  formatDisplayTime: (...args: unknown[]) => mockFormatTime(...args),
  isCalendarEventPast: (...args: unknown[]) => mockIsPast(...args),
}));
jest.mock('@/lib/utils/color', () => ({
  contrastText: (color: string) => mockContrast(color),
}));
jest.mock('@/lib/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'synthetic-event', title: 'Synthetic practice',
    startTime: new Date('2026-08-20T14:15:00Z'),
    endTime: new Date('2026-08-20T15:00:00Z'),
    allDay: false, color: '#225588',
    calendarId: 'synthetic-calendar', calendarName: 'Synthetic calendar',
    ...overrides,
  };
}

describe('InlineCalendarEvent interaction and time visibility', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T12:00:00Z'));
    mockClock = { timeFormat: '24h', displayTimezone: 'Etc/UTC' };
    mockFormatTime.mockReset().mockReturnValue('14:15');
    mockIsPast.mockReset().mockReturnValue(false);
    mockContrast.mockReset().mockReturnValue('#222222');
  });

  afterEach(() => jest.useRealTimers());

  test('clicks the original event without triggering the enclosing day cell', () => {
    const original = Object.freeze(event());
    const onEventClick = jest.fn();
    const onDayClick = jest.fn();
    const view = render(
      <div onClick={onDayClick}>
        <InlineCalendarEvent event={original} onClick={onEventClick} />
      </div>
    );
    const button = view.getByRole('button', { name: '14:15 Synthetic practice' });
    fireEvent.click(view.getByText('Synthetic practice'));
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0]?.[0]).toBe(original);
    expect(onDayClick).not.toHaveBeenCalled();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('title')).toBe(original.title);
  });

  test('updates both the clicked event and callback after a rerender', () => {
    const oldCallback = jest.fn();
    const nextCallback = jest.fn();
    const first = event();
    const next = event({ id: 'next', title: 'Synthetic replacement' });
    const view = render(<InlineCalendarEvent event={first} onClick={oldCallback} />);
    view.rerender(<InlineCalendarEvent event={next} onClick={nextCallback} compact />);
    fireEvent.click(view.getByRole('button'));
    expect(oldCallback).not.toHaveBeenCalled();
    expect(nextCallback.mock.calls).toEqual([[next]]);
  });

  test('uses the display clock for both the visible time and past-event decision', () => {
    mockClock = { timeFormat: '12h', displayTimezone: 'America/Chicago' };
    mockFormatTime.mockReturnValue('9:15 AM');
    const original = event();
    const view = render(<InlineCalendarEvent event={original} onClick={jest.fn()} />);
    expect(view.getByText('9:15 AM')).toBeTruthy();
    expect(mockFormatTime).toHaveBeenCalledWith(original.startTime, '12h', {}, 'America/Chicago');
    expect(mockIsPast).toHaveBeenCalledWith(
      original.startTime, original.endTime, false,
      new Date('2026-08-20T12:00:00Z'), 'America/Chicago'
    );
  });

  test('suppresses timed-event formatting when showTime is false while keeping the event visible', () => {
    const view = render(<InlineCalendarEvent event={event()} onClick={jest.fn()} showTime={false} />);
    expect(view.getByRole('button', { name: 'Synthetic practice' })).toBeTruthy();
    expect(view.queryByText('14:15')).toBeNull();
    expect(mockFormatTime).not.toHaveBeenCalled();
    expect(mockIsPast).toHaveBeenCalledTimes(1);
  });

  test('all-day events omit time formatting even when showTime is enabled', () => {
    const original = event({ allDay: true });
    const view = render(<InlineCalendarEvent event={original} onClick={jest.fn()} showTime />);
    expect(view.getByRole('button', { name: original.title })).toBeTruthy();
    expect(mockFormatTime).not.toHaveBeenCalled();
    expect(mockContrast).not.toHaveBeenCalled();
    expect(mockIsPast.mock.calls[0]?.[2]).toBe(true);
  });

  test('delegates past all-day contrast selection without introducing a time label', () => {
    mockIsPast.mockReturnValue(true);
    const original = event({ allDay: true });
    const view = render(<InlineCalendarEvent event={original} onClick={jest.fn()} />);
    expect(mockContrast).toHaveBeenCalledWith(original.color);
    expect(view.getByRole('button').style.color).toBe('rgb(34, 34, 34)');
    expect(view.getByRole('button').textContent).toBe(original.title);
    expect(mockFormatTime).not.toHaveBeenCalled();
  });

  test('refreshes visible time when display preferences change', () => {
    const original = event();
    const view = render(<InlineCalendarEvent event={original} onClick={jest.fn()} />);
    expect(view.getByText('14:15')).toBeTruthy();
    mockClock = { timeFormat: '12h', displayTimezone: 'Pacific/Auckland' };
    mockFormatTime.mockReturnValue('2:15 AM');
    view.rerender(<InlineCalendarEvent event={original} onClick={jest.fn()} />);
    expect(view.queryByText('14:15')).toBeNull();
    expect(view.getByText('2:15 AM')).toBeTruthy();
    expect(mockFormatTime).toHaveBeenLastCalledWith(original.startTime, '12h', {}, 'Pacific/Auckland');
  });
});
