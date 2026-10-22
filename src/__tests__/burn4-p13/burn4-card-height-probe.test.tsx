/** @jest-environment jsdom */
import * as React from 'react';
import { render } from '@testing-library/react';
import { cardProps, mockWeekItemCard } from './burn4-card-fixture';
import { CardHeightProbe } from '@/components/calendar/cells/CardHeightProbe';

let mockHeight: number | undefined;
const mockRef = jest.fn();
jest.mock('@/lib/hooks/useCardCapacity', () => ({
  useMeasuredHeight: () => ({ ref: mockRef, height: mockHeight }),
}));

describe('CardHeightProbe measurement reporting', () => {
  beforeEach(() => {
    mockHeight = undefined;
    mockRef.mockClear();
    mockWeekItemCard.mockClear();
  });

  test('attaches measurement to an accessibility-hidden representative card and reports initial loading', () => {
    const onMeasure = jest.fn();
    const view = render(<CardHeightProbe size="sm" onMeasure={onMeasure} />);
    const probe = view.container.firstElementChild;
    expect(mockRef).toHaveBeenCalledWith(probe);
    expect(probe?.getAttribute('aria-hidden')).toBe('true');
    expect(onMeasure.mock.calls).toEqual([[undefined]]);
    expect(cardProps()[0]).toEqual(expect.objectContaining({
      variant: 'event', size: 'sm', layout: 'column',
      title: 'Probe Card Title', timeLabel: '9:00 AM', subtitle: 'probe',
    }));
    expect(view.queryByRole('button')).toBeNull();
  });

  test('reports measured height changes, suppresses unchanged reports and follows size/layout updates', () => {
    const onMeasure = jest.fn();
    const view = render(<CardHeightProbe size="sm" onMeasure={onMeasure} />);
    mockHeight = 42;
    view.rerender(<CardHeightProbe size="sm" onMeasure={onMeasure} />);
    view.rerender(<CardHeightProbe size="lg" layout="row" onMeasure={onMeasure} />);
    expect(onMeasure.mock.calls).toEqual([[undefined], [42]]);
    expect(cardProps().at(-1)).toEqual(expect.objectContaining({ size: 'lg', layout: 'row' }));
    mockHeight = 56;
    view.rerender(<CardHeightProbe size="lg" layout="row" onMeasure={onMeasure} />);
    expect(onMeasure.mock.calls).toEqual([[undefined], [42], [56]]);
  });

  test('replays the current measurement to a replacement callback and detaches on unmount', () => {
    mockHeight = 48;
    const first = jest.fn();
    const second = jest.fn();
    const view = render(<CardHeightProbe size="md" onMeasure={first} />);
    view.rerender(<CardHeightProbe size="md" onMeasure={second} />);
    expect(first.mock.calls).toEqual([[48]]);
    expect(second.mock.calls).toEqual([[48]]);
    view.unmount();
    expect(mockRef).toHaveBeenLastCalledWith(null);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
