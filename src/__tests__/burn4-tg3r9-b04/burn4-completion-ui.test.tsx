import React, { Suspense, startTransition, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WeeklyTaskCompletion, type WeeklyTaskCommitRequest, type WeeklyTaskCompletionProps } from '../../components/tasks/burn4-recurring-task-completion';
import { completeWeeklyTask } from '../../lib/burn4-recurring-task';
import { completionCommand, weeklySnapshot, weeklyTask } from './burn4-fixtures';

afterEach(cleanup);

function props(overrides: Partial<WeeklyTaskCompletionProps> = {}): WeeklyTaskCompletionProps {
  return {
    snapshot: weeklySnapshot(), taskId: 'task-0', actorId: 'historic-parent',
    completedAt: '2026-02-20T12:34:56.789Z', commandId: 'completion-1', successorId: 'task-1',
    onCommit: jest.fn(), ...overrides,
  };
}

function openConfirmation(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Complete and create next task' }));
}

function submit(): void {
  openConfirmation();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm completion' }));
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
  let resolve = (): void => { throw new Error('uninitialized local deferred'); };
  let reject = (): void => { throw new Error('uninitialized local deferred'); };
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = () => no(new Error('synthetic host rejection')); });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

test('renders next date and labeled controls without calling the host or taking initial focus', () => {
  const host = jest.fn();
  render(<WeeklyTaskCompletion {...props({ onCommit: host })} />);
  expect(screen.getByRole('region', { name: 'Complete weekly task' })).toBeDefined();
  expect(screen.getByText('Take out the recycling')).toBeDefined();
  expect(screen.getByText('2026-02-06').getAttribute('datetime')).toBe('2026-02-06');
  expect(host).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(document.body);
});

test('confirmation is focused and cancel restores the main completion button without mutation', () => {
  const host = jest.fn();
  render(<WeeklyTaskCompletion {...props({ onCommit: host })} />);
  openConfirmation();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm completion' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Complete and create next task' }));
  expect(host).not.toHaveBeenCalled();
});

test('submits one frozen real candidate and disables duplicate submission while pending', () => {
  const work = deferred();
  const host = jest.fn((_request: WeeklyTaskCommitRequest) => work.promise);
  const initial = props({ onCommit: host });
  render(<WeeklyTaskCompletion {...initial} />);
  openConfirmation();
  const confirm = screen.getByRole('button', { name: 'Confirm completion' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(host).toHaveBeenCalledTimes(1);
  const request = host.mock.calls[0]?.[0];
  expect(request?.command).toEqual(completionCommand());
  expect(request?.snapshot).toEqual(completeWeeklyTask(initial.snapshot, completionCommand()).snapshot);
  expect(Object.isFrozen(request)).toBe(true);
  expect(Object.keys(request ?? {})).toEqual(['command', 'snapshot']);
  expect(Object.isFrozen(request?.snapshot.tasks[0])).toBe(true);
  expect((screen.getByRole('button', { name: 'Saving completion' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('true');
});

test('resolved host callback waits for exact authoritative state rather than claiming saved', async () => {
  render(<WeeklyTaskCompletion {...props({ onCommit: jest.fn(() => Promise.resolve()) })} />);
  submit();
  await flush();
  expect(screen.getByRole('status').textContent).toContain('Waiting for the host');
  expect(screen.queryByText('Task completed and next weekly task saved.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry same operation' })).toBeDefined();
});

test('acknowledges exact host candidate before callback settles and ignores its later rejection', async () => {
  const work = deferred();
  const host = jest.fn((_request: WeeklyTaskCommitRequest) => work.promise);
  const initial = props({ onCommit: host });
  const view = render(<WeeklyTaskCompletion {...initial} />);
  submit();
  const request = host.mock.calls[0]?.[0];
  if (!request) throw new Error('missing synthetic submission');
  view.rerender(<WeeklyTaskCompletion {...initial} snapshot={request.snapshot} />);
  expect(screen.getByRole('status').textContent).toBe('Task completed and next weekly task saved.');
  expect(document.activeElement).toBe(screen.getByRole('status'));
  await act(async () => { work.reject(); await Promise.resolve(); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry same operation' })).toBeNull();
});

test.each(['missing receipt', 'changed title', 'new revision'] as const)('rejects %s as host acknowledgement', async variation => {
  const host = jest.fn((_request: WeeklyTaskCommitRequest) => Promise.resolve());
  const initial = props({ onCommit: host });
  const view = render(<WeeklyTaskCompletion {...initial} />);
  submit();
  await flush();
  const request = host.mock.calls[0]?.[0];
  if (!request) throw new Error('missing synthetic submission');
  const snapshot = variation === 'missing receipt' ? { ...request.snapshot, receipts: [] }
    : variation === 'changed title' ? { ...request.snapshot, tasks: request.snapshot.tasks.map(row => ({ ...row, title: 'changed host content' })) }
    : { ...request.snapshot, revision: request.snapshot.revision + 1 };
  view.rerender(<WeeklyTaskCompletion {...initial} snapshot={snapshot} />);
  expect(screen.getByRole('status').textContent).toContain('host task state changed');
  expect(screen.queryByText('Task completed and next weekly task saved.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry same operation' })).toBeNull();
});

test('same-revision host edit conflicts and explicit reload shows authoritative new task state', async () => {
  const host = jest.fn(() => Promise.resolve());
  const initial = props({ onCommit: host });
  const view = render(<WeeklyTaskCompletion {...initial} />);
  submit();
  await flush();
  const changed = { ...initial.snapshot, tasks: initial.snapshot.tasks.map(row => ({ ...row, title: 'Updated task' })) };
  view.rerender(<WeeklyTaskCompletion {...initial} snapshot={changed} />);
  expect(screen.getByRole('status').textContent).toContain('host task state changed');
  fireEvent.click(screen.getByRole('button', { name: 'Reload current task' }));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText('Updated task')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Complete and create next task' })).toBeDefined();
});

test('asynchronous rejection preserves exact command, candidate and retry object despite changed ID/time props', async () => {
  const first = deferred();
  const second = deferred();
  const host = jest.fn((_request: WeeklyTaskCommitRequest) => first.promise).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const initial = props({ onCommit: host });
  const view = render(<WeeklyTaskCompletion {...initial} />);
  submit();
  await act(async () => { first.reject(); await Promise.resolve(); });
  expect(screen.getByRole('alert').textContent).toContain('could not be confirmed');
  view.rerender(<WeeklyTaskCompletion {...initial} commandId="new-command" successorId="new-next" completedAt="2026-05-01T00:00:00.000Z" />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry same operation' }));
  expect(host).toHaveBeenCalledTimes(2);
  expect(host.mock.calls[1]?.[0]).toBe(host.mock.calls[0]?.[0]);
  expect(host.mock.calls[1]?.[0]?.command).toEqual(completionCommand());
});

test('uncertain resolved retry also preserves exact identity', async () => {
  const host = jest.fn((_request: WeeklyTaskCommitRequest) => Promise.resolve());
  render(<WeeklyTaskCompletion {...props({ onCommit: host })} />);
  submit();
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Retry same operation' }));
  await flush();
  expect(host.mock.calls[1]?.[0]).toBe(host.mock.calls[0]?.[0]);
  expect(screen.getByRole('status').textContent).toContain('Waiting for the host');
});

test('synchronous host throw yields a controlled uncertain retry and never exposes host error text', () => {
  const host = jest.fn(() => { throw new Error('synthetic sensitive host details'); });
  render(<WeeklyTaskCompletion {...props({ onCommit: host })} />);
  submit();
  expect(screen.getByRole('status').textContent).toContain('Saving is uncertain');
  expect(screen.getByRole('alert').textContent).not.toContain('sensitive');
  expect(screen.getByRole('button', { name: 'Retry same operation' })).toBeDefined();
});

test('a conflicting host snapshot cannot be overwritten by late callback settlement', async () => {
  const work = deferred();
  const initial = props({ onCommit: () => work.promise });
  const view = render(<WeeklyTaskCompletion {...initial} />);
  submit();
  view.rerender(<WeeklyTaskCompletion {...initial} snapshot={{ ...initial.snapshot, revision: 5 }} />);
  await act(async () => { work.resolve(); await Promise.resolve(); });
  expect(screen.getByRole('status').textContent).toContain('host task state changed');
});

test.each(['resolve', 'reject'] as const)('task switch fences old async %s and preserves new confirmation', async settlement => {
  const old = deferred();
  const host = jest.fn(() => old.promise);
  const initial = props({ onCommit: host });
  const view = render(<WeeklyTaskCompletion {...initial} />);
  submit();
  const otherSnapshot = weeklySnapshot({ tasks: [weeklyTask({ id: 'other', seriesId: 'other-series', title: 'Different weekly task' })] });
  view.rerender(<WeeklyTaskCompletion {...initial} snapshot={otherSnapshot} taskId="other" commandId="other-command" successorId="other-next" />);
  openConfirmation();
  await act(async () => { old[settlement](); await Promise.resolve(); });
  expect(screen.getByText('Different weekly task')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Confirm completion' })).toBeDefined();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});

test('profile switch also fences the prior pending operation', async () => {
  const old = deferred();
  const initial = props({ onCommit: () => old.promise });
  const view = render(<WeeklyTaskCompletion {...initial} />);
  submit();
  view.rerender(<WeeklyTaskCompletion {...initial} actorId="other-member" />);
  await act(async () => { old.reject(); await Promise.resolve(); });
  expect(screen.getByRole('button', { name: 'Complete and create next task' })).toBeDefined();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('unmount fences pending settlement without host calls or React state warnings', async () => {
  const old = deferred();
  const host = jest.fn(() => old.promise);
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const view = render(<WeeklyTaskCompletion {...props({ onCommit: host })} />);
    submit();
    view.unmount();
    await act(async () => { old.reject(); await Promise.resolve(); });
    expect(host).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

test('reload fences the prior request before a new operation starts', async () => {
  const old = deferred();
  const next = deferred();
  const host = jest.fn(() => old.promise).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => next.promise);
  const initial = props({ onCommit: host });
  const view = render(<WeeklyTaskCompletion {...initial} />);
  submit();
  view.rerender(<WeeklyTaskCompletion {...initial} snapshot={{ ...initial.snapshot, revision: 5 }} commandId="replacement" successorId="replacement-next" />);
  fireEvent.click(screen.getByRole('button', { name: 'Reload current task' }));
  submit();
  await act(async () => { old.reject(); await Promise.resolve(); });
  expect(screen.getByRole('status').textContent).toContain('Sending completion');
  expect(screen.queryByRole('alert')).toBeNull();
});

test.each(['missing', 'complete', 'exhausted', 'invalid'] as const)('does not offer completion for %s input', kind => {
  const snapshot = kind === 'missing' ? weeklySnapshot({ tasks: [] })
    : kind === 'complete' ? weeklySnapshot({ tasks: [weeklyTask({ completed: true, completedAt: '2026-01-30T00:00:00.000Z', completedBy: 'someone' })] })
    : kind === 'exhausted' ? weeklySnapshot({ tasks: [weeklyTask({ anchorDate: '9999-12-31', dueDate: '9999-12-31' })] })
    : weeklySnapshot({ tasks: [weeklyTask({ dueDate: 'impossible' })] });
  const host = jest.fn();
  render(<WeeklyTaskCompletion {...props({ snapshot, onCommit: host })} />);
  expect(screen.queryByRole('button', { name: 'Complete and create next task' })).toBeNull();
  expect(host).not.toHaveBeenCalled();
  if (kind !== 'complete') expect(screen.getByRole('alert')).toBeDefined();
});

test('invalid command fails before host invocation while retaining confirmation', () => {
  const host = jest.fn();
  render(<WeeklyTaskCompletion {...props({ commandId: '', onCommit: host })} />);
  submit();
  expect(host).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('could not be confirmed');
  expect(screen.getByRole('button', { name: 'Confirm completion' })).toBeDefined();
});

test('renders markup-shaped task text safely as text', () => {
  const title = '<img src=x onerror=unexpected()>';
  const view = render(<WeeklyTaskCompletion {...props({ snapshot: weeklySnapshot({ tasks: [weeklyTask({ title })] }) })} />);
  expect(screen.getByText(title)).toBeDefined();
  expect(view.container.querySelector('img')).toBeNull();
});


test('a later host rollback never leaves the saved status visible', async () => {
  const host = jest.fn((_request: WeeklyTaskCommitRequest) => Promise.resolve());
  const initial = props({ onCommit: host });
  const view = render(<WeeklyTaskCompletion {...initial} />);
  submit();
  await flush();
  const request = host.mock.calls[0]?.[0];
  if (!request) throw new Error('missing synthetic submission');
  view.rerender(<WeeklyTaskCompletion {...initial} snapshot={request.snapshot} />);
  expect(screen.getByRole('status').textContent).toContain('next weekly task saved');
  view.rerender(<WeeklyTaskCompletion {...initial} />);
  expect(screen.getByRole('status').textContent).toContain('host task state changed');
  expect(screen.queryByRole('button', { name: 'Retry same operation' })).toBeNull();
});

test('reentrant retry clicks cannot create concurrent host calls', async () => {
  const host = jest.fn((_request: WeeklyTaskCommitRequest) => Promise.resolve());
  const initial = props({ onCommit: host });
  const view = render(<WeeklyTaskCompletion {...initial} />);
  submit();
  await flush();
  const work = deferred();
  const reentrant = jest.fn((_request: WeeklyTaskCommitRequest) => {
    fireEvent.click(screen.getByRole('button', { name: 'Retry same operation' }));
    return work.promise;
  });
  view.rerender(<WeeklyTaskCompletion {...initial} onCommit={reentrant} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry same operation' }));
  expect(reentrant).toHaveBeenCalledTimes(1);
});


function suspendedHost(): {
  work: ReturnType<typeof deferred>;
  observation: { request: WeeklyTaskCommitRequest | null; suspendedRenders: number };
  update: (snapshot: WeeklyTaskCompletionProps['snapshot'], block: boolean) => void;
} {
  const work = deferred();
  const observation = { request: null as WeeklyTaskCommitRequest | null, suspendedRenders: 0 };
  const never = new Promise<never>(() => undefined);
  type State = { snapshot: WeeklyTaskCompletionProps['snapshot']; block: boolean };
  let updateHost: React.Dispatch<React.SetStateAction<State>> | null = null;
  function Gate({ block }: { block: boolean }): null {
    if (block) { observation.suspendedRenders++; throw never; }
    return null;
  }
  function Host(): React.ReactElement {
    const [state, update] = useState<State>({ snapshot: weeklySnapshot(), block: false });
    updateHost = update;
    return <Suspense fallback={<p>Uncommitted replacement view</p>}>
      <WeeklyTaskCompletion {...props({ snapshot: state.snapshot, onCommit: request => {
        observation.request = request;
        return work.promise;
      } })} />
      <Gate block={state.block} />
    </Suspense>;
  }
  render(<Host />);
  submit();
  return { work, observation, update(snapshot, block) {
    if (!updateHost) throw new Error('missing synthetic host updater');
    updateHost({ snapshot, block });
  } };
}

test('a suspended uncommitted acknowledgement cannot suppress the committed rejection retry', async () => {
  const host = suspendedHost();
  const request = host.observation.request;
  if (!request) throw new Error('missing synthetic submission');
  await act(async () => { startTransition(() => host.update(request.snapshot, true)); });
  expect(host.observation.suspendedRenders).toBeGreaterThan(0);
  expect(screen.queryByText('Uncommitted replacement view')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('Sending completion to the host.');
  await act(async () => { host.work.reject(); await Promise.resolve(); });
  expect(screen.getByRole('button', { name: 'Retry same operation' })).toBeDefined();
  expect(screen.getByRole('alert')).toBeDefined();
});

test('abandoning a suspended acknowledgement does not create a sticky committed conflict', async () => {
  const host = suspendedHost();
  const request = host.observation.request;
  if (!request) throw new Error('missing synthetic submission');
  await act(async () => { startTransition(() => host.update(request.snapshot, true)); });
  expect(host.observation.suspendedRenders).toBeGreaterThan(0);
  expect(screen.getByRole('status').textContent).toBe('Sending completion to the host.');
  await act(async () => { host.update(weeklySnapshot(), false); });
  expect(screen.getByRole('status').textContent).toBe('Sending completion to the host.');
  expect(screen.queryByRole('button', { name: 'Reload current task' })).toBeNull();
  await act(async () => { host.work.resolve(); await Promise.resolve(); });
  expect(screen.getByRole('status').textContent).toContain('Waiting for the host');
});
