/** Standalone, caller-owned local weekly task state. No application adapter is implied. */
export interface WeeklyTask {
  readonly id: string;
  readonly origin: 'local';
  readonly seriesId: string;
  readonly anchorDate: string;
  readonly occurrence: number;
  readonly dueDate: string;
  readonly title: string;
  readonly description: string | null;
  readonly listId: string | null;
  readonly assignedTo: string | null;
  readonly priority: 'high' | 'medium' | 'low';
  readonly category: string | null;
  readonly completed: boolean;
  readonly completedAt: string | null;
  readonly completedBy: string | null;
}

export interface WeeklyCompletionCommand {
  readonly id: string;
  readonly expectedRevision: number;
  readonly taskId: string;
  readonly successorId: string;
  readonly actorId: string;
  readonly completedAt: string;
}

export interface WeeklyCompletionReceipt {
  readonly command: WeeklyCompletionCommand;
  readonly resultRevision: number;
}

export interface WeeklyTaskSnapshot {
  readonly revision: number;
  readonly tasks: readonly WeeklyTask[];
  readonly receipts: readonly WeeklyCompletionReceipt[];
}

export interface WeeklyCompletionResult {
  readonly kind: 'applied' | 'replayed';
  readonly command: WeeklyCompletionCommand;
  readonly snapshot: WeeklyTaskSnapshot;
}

export type WeeklyTaskErrorCode =
  | 'invalid-input' | 'date-overflow' | 'capacity' | 'frontier-conflict'
  | 'revision-conflict' | 'command-conflict' | 'task-not-found'
  | 'completed-task' | 'successor-conflict';

/** Errors expose a fixed code, never caller-supplied field values. */
export class WeeklyTaskError extends Error {
  constructor(readonly code: WeeklyTaskErrorCode) {
    super(`Weekly task operation rejected: ${code}.`);
    this.name = 'WeeklyTaskError';
  }
}

const TASK_KEYS = ['id', 'origin', 'seriesId', 'anchorDate', 'occurrence', 'dueDate',
  'title', 'description', 'listId', 'assignedTo', 'priority', 'category',
  'completed', 'completedAt', 'completedBy'];
const COMMAND_KEYS = ['id', 'expectedRevision', 'taskId', 'successorId', 'actorId', 'completedAt'];
const MAX_TASKS = 5000;
const MAX_RECEIPTS = 2500;
const MAX_TEXT = 250000;
const MAX_REVISION = 1000000000;
const LAST_ORDINAL = 3652059;

function fail(code: WeeklyTaskErrorCode = 'invalid-input'): never {
  throw new WeeklyTaskError(code);
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  if (keys.some(key => !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail();
  return value as Record<string, unknown>;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)) fail();
  return value;
}

function integer(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) fail();
  return value;
}

function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail();
  return value;
}

function nullableText(value: unknown, max: number): string | null {
  return value === null ? null : text(value, max);
}

function nullableId(value: unknown): string | null {
  return value === null ? null : identifier(value);
}

function leap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function monthDays(year: number, month: number): number {
  return month === 2 ? (leap(year) ? 29 : 28) : ([4, 6, 9, 11].includes(month) ? 30 : 31);
}

function yearStart(year: number): number {
  const previous = year - 1;
  return previous * 365 + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400) + 1;
}

function ordinal(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail();
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays(year, month)) fail();
  let result = yearStart(year) + day - 1;
  for (let i = 1; i < month; i++) result += monthDays(year, i);
  return result;
}

function dateFromOrdinal(value: number): string {
  if (value > LAST_ORDINAL) fail('date-overflow');
  let low = 1;
  let high = 9999;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (yearStart(middle) <= value) low = middle;
    else high = middle - 1;
  }
  let remaining = value - yearStart(low) + 1;
  let month = 1;
  while (remaining > monthDays(low, month)) remaining -= monthDays(low, month++);
  return `${String(low).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(remaining).padStart(2, '0')}`;
}

/** Date of an explicit occurrence, using fixed seven-day local calendar cadence. */
export function nextWeeklyTaskDate(anchorDate: string, occurrence: number): string {
  const start = ordinal(anchorDate);
  const offset = integer(occurrence, 521722) * 7;
  return dateFromOrdinal(start + offset);
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail();
  ordinal(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) fail();
  return value;
}

function command(value: unknown): WeeklyCompletionCommand {
  const item = record(value, COMMAND_KEYS);
  const result: WeeklyCompletionCommand = {
    id: identifier(item.id), expectedRevision: integer(item.expectedRevision, MAX_REVISION - 1),
    taskId: identifier(item.taskId), successorId: identifier(item.successorId),
    actorId: identifier(item.actorId), completedAt: timestamp(item.completedAt),
  };
  if (result.taskId === result.successorId) fail('successor-conflict');
  return Object.freeze(result);
}

function task(value: unknown): WeeklyTask {
  const item = record(value, TASK_KEYS);
  if (item.origin !== 'local' || typeof item.completed !== 'boolean' || typeof item.priority !== 'string' || !['high', 'medium', 'low'].includes(item.priority)) fail();
  const anchorDate = text(item.anchorDate, 10, true);
  const occurrence = integer(item.occurrence, 521722);
  const dueDate = text(item.dueDate, 10, true);
  if (nextWeeklyTaskDate(anchorDate, occurrence) !== dueDate) fail();
  const completedAt = item.completedAt === null ? null : timestamp(item.completedAt);
  const completedBy = nullableId(item.completedBy);
  if (item.completed ? completedAt === null || completedBy === null : completedAt !== null || completedBy !== null) fail();
  return Object.freeze({
    id: identifier(item.id), origin: 'local', seriesId: identifier(item.seriesId),
    anchorDate, occurrence, dueDate, title: text(item.title, 240, true),
    description: nullableText(item.description, 4000), listId: nullableId(item.listId),
    assignedTo: nullableId(item.assignedTo), priority: item.priority as WeeklyTask['priority'],
    category: nullableText(item.category, 80), completed: item.completed, completedAt, completedBy,
  });
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Validate, allowlist, clone, order and freeze the whole supplied snapshot. */
export function parseWeeklyTaskSnapshot(value: unknown): WeeklyTaskSnapshot {
  const item = record(value, ['revision', 'tasks', 'receipts']);
  const revision = integer(item.revision, MAX_REVISION);
  if (!Array.isArray(item.tasks) || !Array.isArray(item.receipts)) fail();
  if (item.tasks.length > MAX_TASKS || item.receipts.length > MAX_RECEIPTS) fail('capacity');
  const tasks = Array.from(item.tasks, task).sort(compareIds);
  const byId = new Map<string, WeeklyTask>();
  const coordinates = new Set<string>();
  const series = new Map<string, { anchor: string; max: number; open: number[] }>();
  let budget = 0;
  for (const row of tasks) {
    if (byId.has(row.id) || coordinates.has(`${row.seriesId}/${row.occurrence}`)) fail();
    byId.set(row.id, row);
    coordinates.add(`${row.seriesId}/${row.occurrence}`);
    for (const value of Object.values(row)) if (typeof value === 'string') budget += value.length;
    const group = series.get(row.seriesId) ?? { anchor: row.anchorDate, max: row.occurrence, open: [] };
    if (group.anchor !== row.anchorDate) fail();
    group.max = Math.max(group.max, row.occurrence);
    if (!row.completed) group.open.push(row.occurrence);
    series.set(row.seriesId, group);
  }
  for (const group of series.values()) {
    if (group.open.length > 1 || (group.open.length === 1 && group.open[0] !== group.max)) fail('frontier-conflict');
  }
  const seen = new Set<string>();
  const completedSources = new Set<string>();
  const resultRevisions = new Set<number>();
  const receipts = Array.from(item.receipts, (value): WeeklyCompletionReceipt => {
    const row = record(value, ['command', 'resultRevision']);
    const cmd = command(row.command);
    const resultRevision = integer(row.resultRevision, MAX_REVISION);
    if (seen.has(cmd.id) || completedSources.has(cmd.taskId) || resultRevisions.has(resultRevision) || resultRevision !== cmd.expectedRevision + 1 || resultRevision > revision) fail();
    seen.add(cmd.id);
    resultRevisions.add(resultRevision);
    completedSources.add(cmd.taskId);
    const source = byId.get(cmd.taskId);
    const successor = byId.get(cmd.successorId);
    if (!source?.completed || source.completedAt !== cmd.completedAt || source.completedBy !== cmd.actorId || !successor ||
      successor.seriesId !== source.seriesId || successor.anchorDate !== source.anchorDate || successor.occurrence !== source.occurrence + 1) fail();
    for (const value of Object.values(cmd)) if (typeof value === 'string') budget += value.length;
    return Object.freeze({ command: cmd, resultRevision });
  }).sort((a, b) => compareIds(a.command, b.command));
  if (budget > MAX_TEXT) fail('capacity');
  return Object.freeze({ revision, tasks: Object.freeze(tasks), receipts: Object.freeze(receipts) });
}

/** Atomically return completed source, one successor and one receipt, or throw. */
export function completeWeeklyTask(snapshotValue: unknown, commandValue: unknown): WeeklyCompletionResult {
  const snapshot = parseWeeklyTaskSnapshot(snapshotValue);
  const cmd = command(commandValue);
  const prior = snapshot.receipts.find(row => row.command.id === cmd.id);
  if (prior) {
    if (JSON.stringify(prior.command) !== JSON.stringify(cmd)) fail('command-conflict');
    return Object.freeze({ kind: 'replayed', command: cmd, snapshot });
  }
  if (snapshot.revision !== cmd.expectedRevision) fail('revision-conflict');
  const source = snapshot.tasks.find(row => row.id === cmd.taskId);
  if (!source) fail('task-not-found');
  if (source.completed) fail('completed-task');
  if (snapshot.tasks.some(row => row.id === cmd.successorId)) fail('successor-conflict');
  if (snapshot.tasks.length === MAX_TASKS || snapshot.receipts.length === MAX_RECEIPTS) fail('capacity');
  const successor: WeeklyTask = {
    ...source, id: cmd.successorId, occurrence: source.occurrence + 1,
    dueDate: nextWeeklyTaskDate(source.anchorDate, source.occurrence + 1),
    completed: false, completedAt: null, completedBy: null,
  };
  const result = parseWeeklyTaskSnapshot({
    revision: snapshot.revision + 1,
    tasks: [...snapshot.tasks.map(row => row.id === source.id ? {
      ...row, completed: true, completedAt: cmd.completedAt, completedBy: cmd.actorId,
    } : row), successor],
    receipts: [...snapshot.receipts, { command: cmd, resultRevision: snapshot.revision + 1 }],
  });
  return Object.freeze({ kind: 'applied', command: cmd, snapshot: result });
}

/** A promise is not persistence: require the exact canonical candidate and receipt. */
export function isWeeklyTaskAcknowledged(actualValue: unknown, candidateValue: unknown, commandValue: unknown): boolean {
  try {
    const actual = parseWeeklyTaskSnapshot(actualValue);
    const candidate = parseWeeklyTaskSnapshot(candidateValue);
    const cmd = command(commandValue);
    if (candidate.revision !== cmd.expectedRevision + 1) return false;
    const receipt = candidate.receipts.find(row => row.command.id === cmd.id);
    return !!receipt && JSON.stringify(receipt.command) === JSON.stringify(cmd) && JSON.stringify(actual) === JSON.stringify(candidate);
  } catch {
    return false;
  }
}
