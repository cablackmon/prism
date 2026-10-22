import * as React from 'react';
import type { Chore, Meal, Task } from '@/types';
import type { WeekItemCard } from '@/components/calendar/cells/WeekItemCard';

type CardProps = React.ComponentProps<typeof WeekItemCard>;

export const mockWeekItemCard = jest.fn((props: CardProps) => {
  const Tag = props.onClick ? 'button' : 'article';
  return (
    <Tag
      type={props.onClick ? 'button' : undefined}
      onClick={props.onClick}
      data-kind={props.variant}
      data-drag-id={props.dragId}
      aria-label={props.title}
    >
      {props.title}
      {props.timeLabel && <span>{props.timeLabel}</span>}
      {props.subtitle && <span>{props.subtitle}</span>}
    </Tag>
  );
});

jest.mock('@/components/calendar/cells/WeekItemCard', () => ({
  WeekItemCard: (props: CardProps) => mockWeekItemCard(props),
}));

jest.mock('@/lib/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

export function cardProps(): CardProps[] {
  return mockWeekItemCard.mock.calls.map(([props]) => props);
}

export function chore(id: string, overrides: Partial<Chore> = {}): Chore {
  return {
    id,
    title: `Chore ${id}`,
    category: 'cleaning',
    frequency: 'weekly',
    enabled: true,
    requiresApproval: false,
    pointValue: 5,
    createdAt: '2026-08-17T12:00:00Z',
    ...overrides,
  };
}

export function task(id: string, overrides: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, completed: false, priority: 'medium', ...overrides };
}

export function meal(id: string, overrides: Partial<Meal> = {}): Meal {
  return {
    id,
    name: `Meal ${id}`,
    mealType: 'dinner',
    dayOfWeek: 'monday',
    weekOf: '2026-08-17',
    createdAt: '2026-08-17T12:00:00Z',
    ...overrides,
  };
}

export function bucket() {
  return { chores: [chore('shared')], tasks: [task('shared')], meals: [meal('shared')] };
}
