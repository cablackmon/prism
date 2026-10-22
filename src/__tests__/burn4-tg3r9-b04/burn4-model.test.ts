import {
  WeeklyTaskError, completeWeeklyTask, isWeeklyTaskAcknowledged, nextWeeklyTaskDate, parseWeeklyTaskSnapshot,
  type WeeklyTask, type WeeklyTaskErrorCode,
} from '../../lib/burn4-recurring-task';
import { completionCommand, freezeInput, weeklySnapshot, weeklyTask } from './burn4-fixtures';

function expectCode(action: () => unknown, code: WeeklyTaskErrorCode): void {
  expect(action).toThrow(WeeklyTaskError);
  try { action(); } catch (error) {
    expect((error as WeeklyTaskError).code).toBe(code);
    expect((error as Error).message).toBe(`Weekly task operation rejected: ${code}.`);
  }
}

function completed(overrides: Partial<WeeklyTask> = {}): WeeklyTask {
  return weeklyTask({ completed: true, completedAt: '2026-02-01T00:00:00.000Z', completedBy: 'old-member', ...overrides });
}

describe('weekly completion returns real isolated task state', () => {
  test('completes one source and inserts exactly one successor with ordinary task fields', () => {
    const unrelated = weeklyTask({ id: 'other', seriesId: 'other-series' });
    const input = freezeInput(weeklySnapshot({ tasks: [unrelated, weeklyTask()] }));
    const before = JSON.stringify(input);
    const cmd = freezeInput(completionCommand());
    const result = completeWeeklyTask(input, cmd);
    expect(result.kind).toBe('applied');
    expect(result.snapshot.revision).toBe(5);
    expect(result.snapshot.tasks).toHaveLength(3);
    expect(result.snapshot.tasks.find(row => row.id === 'task-0')).toEqual({
      ...weeklyTask(), completed: true, completedAt: cmd.completedAt, completedBy: cmd.actorId,
    });
    expect(result.snapshot.tasks.find(row => row.id === 'task-1')).toEqual({
      ...weeklyTask(), id: 'task-1', occurrence: 1, dueDate: '2026-02-06',
    });
    expect(result.snapshot.tasks.find(row => row.id === 'other')).toEqual(unrelated);
    expect(result.snapshot.receipts).toEqual([{ command: cmd, resultRevision: 5 }]);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.snapshot.tasks[0]).not.toBe(input.tasks[0]);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.tasks)).toBe(true);
    expect(Object.isFrozen(result.snapshot.tasks[0])).toBe(true);
    expect(Object.isFrozen(result.snapshot.receipts[0]?.command)).toBe(true);
  });

  test('successive completions preserve original anchor and explicit historic actors', () => {
    const first = completeWeeklyTask(weeklySnapshot(), completionCommand());
    const second = completeWeeklyTask(first.snapshot, completionCommand({
      id: 'completion-2', taskId: 'task-1', successorId: 'task-2', expectedRevision: 5,
      actorId: 'retired-profile', completedAt: '2026-03-01T00:00:00.000Z',
    }));
    expect(second.snapshot.tasks.map(row => [row.id, row.dueDate, row.completed])).toEqual([
      ['task-0', '2026-01-30', true], ['task-1', '2026-02-06', true], ['task-2', '2026-02-13', false],
    ]);
    expect(second.snapshot.receipts).toHaveLength(2);
    expect(completeWeeklyTask(second.snapshot, completionCommand()).kind).toBe('replayed');
  });

  test('late completion advances one scheduled week without fabricating skipped completions', () => {
    const result = completeWeeklyTask(weeklySnapshot(), completionCommand({ completedAt: '2027-11-30T00:00:00.000Z' }));
    expect(result.snapshot.tasks).toHaveLength(2);
    expect(result.snapshot.tasks.find(row => !row.completed)?.dueDate).toBe('2026-02-06');
  });

  test('exact replay is unchanged even though expected revision is now old', () => {
    const first = completeWeeklyTask(weeklySnapshot(), completionCommand());
    const replay = completeWeeklyTask(first.snapshot, completionCommand());
    expect(replay.kind).toBe('replayed');
    expect(replay.snapshot).toEqual(first.snapshot);
    expect(replay.snapshot).not.toBe(first.snapshot);
  });

  test.each([
    ['actor', { actorId: 'other-actor' }], ['successor', { successorId: 'different-next' }],
    ['timestamp', { completedAt: '2026-02-21T12:34:56.789Z' }], ['revision', { expectedRevision: 5 }],
    ['task', { taskId: 'other-task' }],
  ])('same command identity with changed %s conflicts', (_name, override) => {
    const first = completeWeeklyTask(weeklySnapshot(), completionCommand());
    expectCode(() => completeWeeklyTask(first.snapshot, completionCommand(override)), 'command-conflict');
  });

  test('competing completions fail stale revision and then completed-source checks', () => {
    const first = completeWeeklyTask(weeklySnapshot(), completionCommand());
    expectCode(() => completeWeeklyTask(first.snapshot, completionCommand({ id: 'competing', successorId: 'competing-next' })), 'revision-conflict');
    expectCode(() => completeWeeklyTask(first.snapshot, completionCommand({ id: 'competing', successorId: 'competing-next', expectedRevision: 5 })), 'completed-task');
  });

  test.each([
    ['task-not-found', { taskId: 'absent' }], ['successor-conflict', { successorId: 'task-0' }],
    ['revision-conflict', { expectedRevision: 3 }],
  ] as const)('reports %s without changing source state', (code, override) => {
    const input = weeklySnapshot();
    const before = JSON.stringify(input);
    expectCode(() => completeWeeklyTask(input, completionCommand(override)), code);
    expect(JSON.stringify(input)).toBe(before);
  });

  test('rejects successor collision with an unrelated series and completed source without receipt', () => {
    const snapshot = weeklySnapshot({ tasks: [weeklyTask(), weeklyTask({ id: 'task-1', seriesId: 'other' })] });
    expectCode(() => completeWeeklyTask(snapshot, completionCommand()), 'successor-conflict');
    expectCode(() => completeWeeklyTask(weeklySnapshot({ tasks: [completed()] }), completionCommand()), 'completed-task');
  });
});

describe('Gregorian calendar cadence without ambient time', () => {
  test.each([
    ['2026-01-30', 1, '2026-02-06'], ['2026-12-29', 1, '2027-01-05'],
    ['2024-02-23', 1, '2024-03-01'], ['2024-02-22', 1, '2024-02-29'],
    ['1900-02-23', 1, '1900-03-02'], ['2000-02-23', 1, '2000-03-01'],
    ['0001-01-01', 0, '0001-01-01'], ['0001-01-01', 1, '0001-01-08'],
    ['0099-12-28', 1, '0100-01-04'], ['2026-01-30', 52, '2027-01-29'],
    ['9999-12-24', 1, '9999-12-31'],
  ])('%s occurrence %i is %s', (anchor, occurrence, due) => {
    expect(nextWeeklyTaskDate(anchor, occurrence)).toBe(due);
  });

  test.each(['2023-02-29', '1900-02-29', '2026-04-31', '0000-01-01', '2026-00-01', '2026-13-01', '2026-01-00', '2026-1-01', '2026-01-01junk'])('rejects invalid calendar date %s', date => {
    expectCode(() => nextWeeklyTaskDate(date, 0), 'invalid-input');
  });

  test.each([-1, 0.5, Infinity, NaN, 521723])('rejects invalid occurrence %s', occurrence => {
    expectCode(() => nextWeeklyTaskDate('2026-01-01', occurrence), 'invalid-input');
  });

  test('date overflow rejects atomically', () => {
    expectCode(() => nextWeeklyTaskDate('9999-12-31', 1), 'date-overflow');
    const input = weeklySnapshot({ tasks: [weeklyTask({ anchorDate: '9999-12-31', dueDate: '9999-12-31' })] });
    expectCode(() => completeWeeklyTask(input, completionCommand()), 'date-overflow');
    expect(input.tasks[0]?.completed).toBe(false);
  });
});

describe('whole snapshot and receipt validation', () => {
  test('canonical ordering is independent of row/receipt arrival order', () => {
    const first = completeWeeklyTask(weeklySnapshot(), completionCommand());
    const second = completeWeeklyTask(first.snapshot, completionCommand({ id: 'aaa', taskId: 'task-1', successorId: 'task-2', expectedRevision: 5 }));
    expect(parseWeeklyTaskSnapshot({ ...second.snapshot, tasks: [...second.snapshot.tasks].reverse(), receipts: [...second.snapshot.receipts].reverse() })).toEqual(second.snapshot);
  });

  test.each([
    ['duplicate task identity', [weeklyTask(), weeklyTask({ seriesId: 'other' })], 'invalid-input'],
    ['duplicate occurrence', [completed(), weeklyTask({ id: 'duplicate' })], 'invalid-input'],
    ['two open occurrences', [weeklyTask(), weeklyTask({ id: 'task-1', occurrence: 1, dueDate: '2026-02-06' })], 'frontier-conflict'],
    ['open occurrence behind history', [weeklyTask(), completed({ id: 'task-1', occurrence: 1, dueDate: '2026-02-06' })], 'frontier-conflict'],
    ['different anchors in one series', [completed(), weeklyTask({ id: 'task-1', anchorDate: '2026-02-06', dueDate: '2026-02-06' })], 'invalid-input'],
  ] as const)('rejects %s', (_name, tasks, code) => {
    expectCode(() => parseWeeklyTaskSnapshot(weeklySnapshot({ tasks })), code);
  });

  test.each([
    { dueDate: '2026-01-31' }, { origin: 'google' }, { priority: 'none' }, { title: ' ' },
    { title: 'x'.repeat(241) }, { description: 'x'.repeat(4001) }, { category: 'x'.repeat(81) },
    { id: 'invalid id' }, { assignedTo: '' }, { completed: true }, { completedBy: 'someone' },
    { completedAt: '2026-01-30T00:00:00.000Z' }, { providerId: 'must-not-be-copied' },
  ])('rejects malformed task fields %#', override => {
    expectCode(() => parseWeeklyTaskSnapshot(weeklySnapshot({ tasks: [{ ...weeklyTask(), ...override } as WeeklyTask] })), 'invalid-input');
  });

  test('accepts exact text boundaries and nullable optional fields without provider leakage', () => {
    const input = weeklyTask({ title: 'x'.repeat(240), description: 'x'.repeat(4000), category: 'x'.repeat(80), assignedTo: null, listId: null });
    const result = completeWeeklyTask(weeklySnapshot({ tasks: [input] }), completionCommand());
    expect(result.snapshot.tasks.find(row => !row.completed)).toEqual({ ...input, id: 'task-1', occurrence: 1, dueDate: '2026-02-06' });
    expect(Object.keys(result.snapshot.tasks[0] ?? {})).not.toContain('providerId');
  });

  test.each(['2026-02-30T00:00:00.000Z', '2026-01-01T24:00:00.000Z', '2026-01-01T00:60:00.000Z', '2026-01-01T00:00:60.000Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000+00:00'])('rejects invalid explicit timestamp %s', completedAt => {
    expectCode(() => completeWeeklyTask(weeklySnapshot(), completionCommand({ completedAt })), 'invalid-input');
  });

  test.each([null, [], {}, { revision: 4, tasks: [], receipts: [], provider: 'hidden' }, { revision: -1, tasks: [], receipts: [] }])('rejects malformed snapshot %#', value => {
    expectCode(() => parseWeeklyTaskSnapshot(value), 'invalid-input');
  });

  test('rejects accessors before observing their value', () => {
    const read = jest.fn(() => 'unexpected');
    const input = { ...weeklyTask() };
    Object.defineProperty(input, 'title', { enumerable: true, get: read });
    expectCode(() => parseWeeklyTaskSnapshot(weeklySnapshot({ tasks: [input] })), 'invalid-input');
    expect(read).not.toHaveBeenCalled();
  });

  test('validates every receipt against its completed source, successor and revision', () => {
    const result = completeWeeklyTask(weeklySnapshot(), completionCommand()).snapshot;
    const receipt = result.receipts[0];
    expect(receipt).toBeDefined();
    expectCode(() => parseWeeklyTaskSnapshot({ ...result, receipts: [receipt, receipt] }), 'invalid-input');
    expectCode(() => parseWeeklyTaskSnapshot({ ...result, receipts: [{ ...receipt, resultRevision: 6 }] }), 'invalid-input');
    expectCode(() => parseWeeklyTaskSnapshot({ ...result, revision: 4 }), 'invalid-input');
    expectCode(() => parseWeeklyTaskSnapshot({ ...result, tasks: result.tasks.filter(row => row.id !== 'task-1') }), 'invalid-input');
    expectCode(() => parseWeeklyTaskSnapshot({ ...result, tasks: result.tasks.map(row => row.id === 'task-0' ? { ...row, completedBy: 'different' } : row) }), 'invalid-input');
  });

  test('rejects two receipts claiming the same revision across different series', () => {
    const base = weeklySnapshot({ tasks: [weeklyTask(), weeklyTask({ id: 'other-0', seriesId: 'other-series' })] });
    const left = completeWeeklyTask(base, completionCommand()).snapshot;
    const right = completeWeeklyTask(base, completionCommand({ id: 'other-command', taskId: 'other-0', successorId: 'other-1' })).snapshot;
    expectCode(() => parseWeeklyTaskSnapshot({ revision: 5, tasks: [...left.tasks.filter(row => row.seriesId === 'series-1'), ...right.tasks.filter(row => row.seriesId === 'other-series')], receipts: [...left.receipts, ...right.receipts] }), 'invalid-input');
  });

  test('rejects sparse arrays and nonplain or extra command fields', () => {
    expectCode(() => parseWeeklyTaskSnapshot(weeklySnapshot({ tasks: new Array<WeeklyTask>(1) })), 'invalid-input');
    expectCode(() => parseWeeklyTaskSnapshot(weeklySnapshot({ receipts: new Array(1) })), 'invalid-input');
    expectCode(() => completeWeeklyTask(weeklySnapshot(), { ...completionCommand(), providerId: 'forbidden' }), 'invalid-input');
    expectCode(() => parseWeeklyTaskSnapshot(new Date(0)), 'invalid-input');
  });

  test('enforces row capacity before reading excessive entries', () => {
    const input = new Array<WeeklyTask>(5001).fill(weeklyTask());
    expectCode(() => parseWeeklyTaskSnapshot(weeklySnapshot({ tasks: input })), 'capacity');
    expectCode(() => parseWeeklyTaskSnapshot(weeklySnapshot({ receipts: new Array(2501).fill(null) })), 'capacity');
  });

  test('enforces aggregate text budget with modest bounded fixtures', () => {
    const tasks = Array.from({ length: 63 }, (_, i) => weeklyTask({ id: `task-${i}`, seriesId: `series-${i}`, description: 'x'.repeat(4000) }));
    expectCode(() => parseWeeklyTaskSnapshot(weeklySnapshot({ tasks })), 'capacity');
    expect(parseWeeklyTaskSnapshot(weeklySnapshot({ tasks: tasks.slice(0, 55) })).tasks).toHaveLength(55);
  });

  test('enforces capacity of the returned candidate as well as its input', () => {
    const tasks = Array.from({ length: 5000 }, (_, i) => weeklyTask({ id: `t${i}`, seriesId: `s${i}`, title: 'T', description: null, listId: null, assignedTo: null, category: null }));
    // Compact rows fit the input budget; inserting one more exceeds row capacity.
    expectCode(() => completeWeeklyTask(weeklySnapshot({ tasks }), completionCommand({ taskId: 't0' })), 'capacity');
  });
});

describe('host acknowledgement requires exact candidate state and receipt', () => {
  test('accepts exact canonical host candidate, including reordered transport arrays', () => {
    const cmd = completionCommand();
    const candidate = completeWeeklyTask(weeklySnapshot(), cmd).snapshot;
    expect(isWeeklyTaskAcknowledged(candidate, candidate, cmd)).toBe(true);
    expect(isWeeklyTaskAcknowledged({ ...candidate, tasks: [...candidate.tasks].reverse() }, candidate, cmd)).toBe(true);
  });

  test('rejects missing receipt, changed metadata, other revision, wrong command and malformed state', () => {
    const cmd = completionCommand();
    const candidate = completeWeeklyTask(weeklySnapshot(), cmd).snapshot;
    expect(isWeeklyTaskAcknowledged({ ...candidate, receipts: [] }, candidate, cmd)).toBe(false);
    expect(isWeeklyTaskAcknowledged({ ...candidate, tasks: candidate.tasks.map(row => ({ ...row, title: 'different' })) }, candidate, cmd)).toBe(false);
    expect(isWeeklyTaskAcknowledged({ ...candidate, revision: 6 }, candidate, cmd)).toBe(false);
    expect(isWeeklyTaskAcknowledged(candidate, candidate, { ...cmd, actorId: 'someone-else' })).toBe(false);
    expect(isWeeklyTaskAcknowledged(null, candidate, cmd)).toBe(false);
    expect(isWeeklyTaskAcknowledged(candidate, weeklySnapshot(), cmd)).toBe(false);
  });
});
