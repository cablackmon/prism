/** @jest-environment jsdom */
import * as React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { bucket, cardProps, chore, meal, mockWeekItemCard, task } from './burn4-card-fixture';
import { OverlayItemsCell } from '@/components/calendar/cells/OverlayItemsCell';
import { DroppableOverlayCell } from '@/components/calendar/cells/DroppableOverlayCell';

const assignee = Object.freeze({ id: 'synthetic-assignee', name: 'Synthetic assignee', color: '#112233' });
const cook = Object.freeze({ id: 'synthetic-cook', name: 'Synthetic cook', color: '#445566' });
const creator = Object.freeze({ id: 'synthetic-creator', name: 'Synthetic creator', color: '#778899' });

describe('OverlayItemsCell stream mapping', () => {
  beforeEach(() => mockWeekItemCard.mockClear());

  test('renders nothing for empty data or when every populated kind is excluded', () => {
    const view = render(<OverlayItemsCell bucket={{ meals: [], chores: [], tasks: [] }} />);
    expect(view.container.firstChild).toBeNull();
    view.rerender(<OverlayItemsCell bucket={bucket()} include={{ meals: false, chores: false, tasks: false }} />);
    expect(view.container.firstChild).toBeNull();
    expect(mockWeekItemCard).not.toHaveBeenCalled();
  });

  test('pins meals after chores and tasks and routes equal IDs by their correct kind', () => {
    const data = bucket();
    Object.freeze(data.chores[0]);
    Object.freeze(data.tasks[0]);
    Object.freeze(data.meals[0]);
    Object.freeze(data.chores);
    Object.freeze(data.tasks);
    Object.freeze(data.meals);
    Object.freeze(data);
    const onItemClick = jest.fn();
    const view = render(<OverlayItemsCell bucket={data} onItemClick={onItemClick} />);
    const cards = view.getAllByRole('button');
    expect(cards.map((card) => card.getAttribute('aria-label')))
      .toEqual(['Chore shared', 'Task shared', 'Meal shared']);
    cards.forEach((card) => fireEvent.click(card));
    expect(onItemClick.mock.calls).toEqual([
      [{ kind: 'chore', id: 'shared' }],
      [{ kind: 'task', id: 'shared' }],
      [{ kind: 'meal', id: 'shared' }],
    ]);
    expect(cardProps().map(({ dragId, size, layout }) => ({ dragId, size, layout })))
      .toEqual(Array(3).fill({ dragId: undefined, size: 'sm', layout: 'column' }));
    expect(data).toEqual(bucket());
  });

  test('filters only the explicit false kinds and defaults omitted kinds to visible', () => {
    const view = render(<OverlayItemsCell bucket={bucket()} include={{ chores: false }} />);
    expect(cardProps().map(({ variant }) => variant)).toEqual(['task', 'meal']);
    mockWeekItemCard.mockClear();
    view.rerender(<OverlayItemsCell bucket={bucket()} include={{ meals: false, tasks: false }} />);
    expect(cardProps().map(({ variant }) => variant)).toEqual(['chore']);
    expect(view.queryByText('Task shared')).toBeNull();
    expect(view.queryByText('Meal shared')).toBeNull();
  });

  test('selects owner colors, cooked-by before created-by, and per-kind fallbacks', () => {
    render(<OverlayItemsCell bucket={{
      chores: [chore('assigned', { assignedTo: assignee }), chore('unassigned')],
      tasks: [task('assigned', { assignedTo: assignee }), task('empty-color', {
        assignedTo: { ...assignee, color: '' },
      })],
      meals: [
        meal('cooked', { cookedBy: cook, createdBy: creator }),
        meal('created', { createdBy: creator }),
        meal('empty-cook-color', { cookedBy: { ...cook, color: '' }, createdBy: creator }),
        meal('unowned'),
      ],
    }} />);
    expect(cardProps().map(({ title, stripeColor }) => [title, stripeColor])).toEqual([
      ['Chore assigned', '#112233'], ['Chore unassigned', '#f59e0b'],
      ['Task assigned', '#112233'], ['Task empty-color', '#3b82f6'],
      ['Meal cooked', '#445566'], ['Meal created', '#778899'],
      ['Meal empty-cook-color', '#778899'], ['Meal unowned', '#10b981'],
    ]);
  });

  test('maps completion, approval, assignee and cooking metadata without confusing their states', () => {
    render(<OverlayItemsCell bucket={{
      chores: [chore('pending', {
        assignedTo: assignee,
        pendingApproval: {
          completionId: 'synthetic-completion', completedAt: '2026-08-17T13:00:00Z', completedBy: assignee,
        },
      }), chore('open')],
      tasks: [task('done', { assignedTo: assignee, completed: true }), task('open')],
      meals: [meal('cooked', { cookedAt: '2026-08-17T13:00:00Z', cookedBy: cook }), meal('planned', { cookedAt: null })],
    }} size="md" />);
    expect(cardProps().map(({ title, subtitle, pendingApproval, muted, timeLabel }) => ({
      title, subtitle, pendingApproval, muted, timeLabel,
    }))).toEqual([
      { title: 'Chore pending', subtitle: assignee.name, pendingApproval: true, muted: undefined, timeLabel: undefined },
      { title: 'Chore open', subtitle: undefined, pendingApproval: false, muted: undefined, timeLabel: undefined },
      { title: 'Task done', subtitle: assignee.name, pendingApproval: undefined, muted: true, timeLabel: undefined },
      { title: 'Task open', subtitle: undefined, pendingApproval: undefined, muted: false, timeLabel: undefined },
      { title: 'Meal cooked', subtitle: 'Cooked by Synthetic cook', pendingApproval: undefined, muted: true, timeLabel: 'dinner' },
      { title: 'Meal planned', subtitle: undefined, pendingApproval: undefined, muted: false, timeLabel: 'dinner' },
    ]);
  });

  test('applies a meal group color before any owner color and preserves other stream colors', () => {
    const data = {
      chores: [chore('assigned', { assignedTo: assignee })],
      tasks: [task('assigned', { assignedTo: assignee })],
      meals: [meal('owned', { cookedBy: cook, createdBy: creator }), meal('unowned')],
    };
    render(<OverlayItemsCell bucket={data} mealColor="#abcdef" />);
    expect(cardProps().map(({ stripeColor }) => stripeColor))
      .toEqual(['#112233', '#112233', '#abcdef', '#abcdef']);
    expect(cardProps().every(({ onClick }) => onClick === undefined)).toBe(true);
  });
});

describe('DroppableOverlayCell integration with the real overlay mapper', () => {
  beforeEach(() => mockWeekItemCard.mockClear());

  test('renders nothing for an unavailable bucket and delegates read-only defaults once it arrives', () => {
    const date = new Date('2026-08-17T12:00:00Z');
    const view = render(<DroppableOverlayCell date={date} bucket={undefined} />);
    expect(view.container.firstChild).toBeNull();
    expect(mockWeekItemCard).not.toHaveBeenCalled();
    view.rerender(<DroppableOverlayCell date={date} bucket={bucket()} />);
    expect(cardProps().map(({ size, layout, dragId }) => ({ size, layout, dragId })))
      .toEqual(Array(3).fill({ size: 'sm', layout: 'column', dragId: undefined }));
  });

  test('delegates drag IDs, density, filtering, meal color and item clicks to the real child', () => {
    const onItemClick = jest.fn();
    const view = render(<DroppableOverlayCell
      date={new Date('2026-08-17T12:00:00Z')}
      bucket={bucket()} size="lg" layout="row" enableDnd
      include={{ chores: false }} mealColor="#abcdef" onItemClick={onItemClick}
    />);
    expect(cardProps().map(({ variant, dragId, size, layout, stripeColor }) => ({
      variant, dragId, size, layout, stripeColor,
    }))).toEqual([
      { variant: 'task', dragId: 'task:shared', size: 'lg', layout: 'row', stripeColor: '#3b82f6' },
      { variant: 'meal', dragId: 'meal:shared', size: 'lg', layout: 'row', stripeColor: '#abcdef' },
    ]);
    fireEvent.click(view.getByRole('button', { name: 'Meal shared' }));
    expect(onItemClick.mock.calls).toEqual([[{ kind: 'meal', id: 'shared' }]]);
    expect(view.queryByText('Chore shared')).toBeNull();
  });

  test('removes drag identifiers when disabled and leaves an empty wrapper for an empty day', () => {
    const date = new Date('2026-08-17T12:00:00Z');
    const data = bucket();
    const view = render(<DroppableOverlayCell date={date} bucket={data} enableDnd />);
    expect(cardProps().map(({ dragId }) => dragId)).toEqual(['chore:shared', 'task:shared', 'meal:shared']);
    mockWeekItemCard.mockClear();
    view.rerender(<DroppableOverlayCell date={date} bucket={data} enableDnd={false} />);
    expect(cardProps().every(({ dragId }) => dragId === undefined)).toBe(true);
    mockWeekItemCard.mockClear();
    view.rerender(<DroppableOverlayCell date={date} bucket={{ chores: [], tasks: [], meals: [] }} />);
    expect(view.container.firstChild).not.toBeNull();
    expect(view.container.firstChild?.childNodes).toHaveLength(0);
    expect(mockWeekItemCard).not.toHaveBeenCalled();
  });
});
