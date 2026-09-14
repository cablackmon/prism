/** @jest-environment jsdom */
import React, { useRef } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { resolveKystTheme } from '@/lib/theme/kystTheme';
import { BoardThemeContext, BoardStarfield } from '../KystTheme';
import { useScrollEdges } from '../useScrollEdges';

jest.mock('@/components/widgets/WidgetContainer', () => ({
  WidgetContainer: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
}));
import { TasksWidget } from '@/components/widgets/TasksWidget';
import type { Task } from '@/types';

const tasks = Array.from({ length: 9 }, (_, i) => ({
  id: `task-${i}`, title: `Task number ${i}`, priority: 'low', completed: false,
} as Task));

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

test.each([[undefined, 'nox'], ['nox', 'nox'], ['classic', 'classic'], ['typo', 'classic']])('runtime value %s selects %s', (value, expected) => {
  expect(resolveKystTheme(value)).toBe(expected);
});

test('classic retains the cap; nox exposes every task and preserves its edit callback', () => {
  const onTaskClick = jest.fn();
  const view = render(<BoardThemeContext.Provider value="classic"><TasksWidget tasks={tasks} maxTasks={2} onTaskClick={onTaskClick} /></BoardThemeContext.Provider>);
  expect(screen.queryByText('Task number 8')).toBeNull();
  expect(screen.getByText('+7 more tasks')).toBeTruthy();
  view.rerender(<BoardThemeContext.Provider value="nox"><TasksWidget tasks={tasks} maxTasks={2} onTaskClick={onTaskClick} /></BoardThemeContext.Provider>);
  expect(screen.queryByText('+7 more tasks')).toBeNull();
  fireEvent.click(screen.getByText('Task number 8'));
  expect(onTaskClick).toHaveBeenCalledWith(tasks[8]);
});

function ScrollFixture({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollEdges(ref, enabled, 'Tasks');
  return <div ref={ref}><div data-board-scroll data-testid="scroll"><p>Task content</p></div></div>;
}

test('scroll region exposes focus and a fade only while more rows remain, then restores classic attributes', () => {
  const height = jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400);
  const client = jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
  const view = render(<ScrollFixture />);
  const el = screen.getByTestId('scroll');
  expect(el.dataset.moreBelow).toBe('true');
  expect(el.tabIndex).toBe(0);
  expect(el.getAttribute('aria-label')).toBe('Tasks — scroll for more');
  fireEvent.scroll(el, { target: { scrollTop: 300 } });
  expect(el.dataset.moreBelow).toBe('false');
  view.rerender(<ScrollFixture enabled={false} />);
  expect(el.getAttribute('tabindex')).toBeNull();
  expect(el.getAttribute('aria-label')).toBeNull();
  expect(el.dataset.moreBelow).toBeUndefined();
  height.mockRestore(); client.mockRestore();
});

test('short lists have no fade and no extra tab stop', () => {
  render(<ScrollFixture />);
  const el = screen.getByTestId('scroll');
  expect(el.dataset.moreBelow).toBe('false');
  expect(el.tabIndex).toBe(-1);
});

test('starfield pauses when the document is hidden', () => {
  const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const { container } = render(<BoardStarfield />);
  expect(container.firstElementChild?.getAttribute('data-paused')).toBe('false');
  hidden.mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  expect(container.firstElementChild?.getAttribute('data-paused')).toBe('true');
  hidden.mockRestore();
});
