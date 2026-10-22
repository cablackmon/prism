import type { WeeklyCompletionCommand, WeeklyTask, WeeklyTaskSnapshot } from '../../lib/burn4-recurring-task';

export function weeklyTask(overrides: Partial<WeeklyTask> = {}): WeeklyTask {
  return {
    id: 'task-0', origin: 'local', seriesId: 'series-1', anchorDate: '2026-01-30', occurrence: 0,
    dueDate: '2026-01-30', title: 'Take out the recycling', description: 'Blue bin',
    listId: 'home', assignedTo: 'member-2', priority: 'high', category: 'Household',
    completed: false, completedAt: null, completedBy: null, ...overrides,
  };
}

export function weeklySnapshot(overrides: Partial<WeeklyTaskSnapshot> = {}): WeeklyTaskSnapshot {
  return { revision: 4, tasks: [weeklyTask()], receipts: [], ...overrides };
}

export function completionCommand(overrides: Partial<WeeklyCompletionCommand> = {}): WeeklyCompletionCommand {
  return {
    id: 'completion-1', expectedRevision: 4, taskId: 'task-0', successorId: 'task-1',
    actorId: 'historic-parent', completedAt: '2026-02-20T12:34:56.789Z', ...overrides,
  };
}

export function freezeInput<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeInput(child);
    Object.freeze(value);
  }
  return value;
}
