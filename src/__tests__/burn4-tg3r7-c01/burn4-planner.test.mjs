import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot, previewChores } from '../../../scripts/burn4-chore-anchor-preview.mjs';
import { chore, snapshot, projected, dates } from './burn4-fixtures.mjs';

const vectors = [
  { frequency: 'daily', nextDue: '2028-02-28', asOf: '2028-02-29', through: '2028-03-01', expected: ['2028-02-28', '2028-02-29', '2028-03-01'] },
  { frequency: 'weekly', nextDue: '2026-12-27', asOf: '2027-01-04', through: '2027-01-17', expected: ['2026-12-27', '2027-01-03', '2027-01-10', '2027-01-17'] },
  { frequency: 'biweekly', nextDue: '2026-12-24', asOf: '2027-01-07', through: '2027-02-04', expected: ['2026-12-24', '2027-01-07', '2027-01-21', '2027-02-04'] },
  { frequency: 'monthly', nextDue: '2027-01-31', asOf: '2027-02-28', through: '2027-05-31', expected: ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31'] },
  { frequency: 'quarterly', nextDue: '2027-08-31', asOf: '2027-08-31', through: '2028-05-31', expected: ['2027-08-31', '2027-11-30', '2028-02-29', '2028-05-31'] },
  { frequency: 'semi-annually', nextDue: '2027-08-31', asOf: '2027-08-31', through: '2029-02-28', expected: ['2027-08-31', '2028-02-29', '2028-08-31', '2029-02-28'] },
  { frequency: 'annually', nextDue: '2024-02-29', asOf: '2024-02-29', through: '2028-02-29', expected: ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'] },
  { frequency: 'custom', customIntervalDays: 365, nextDue: '2027-03-01', asOf: '2027-03-01', through: '2029-02-28', expected: ['2027-03-01', '2028-02-29', '2029-02-28'] },
];
for (const vector of vectors) test(`${vector.frequency} preserves the original due-date anchor`, () => {
  const row = projected(snapshot({ asOf: vector.asOf, through: vector.through, chores: [chore({ frequency: vector.frequency, nextDue: vector.nextDue, ...(vector.customIntervalDays ? { customIntervalDays: vector.customIntervalDays } : {}) })] }));
  assert.deepEqual(dates(row), vector.expected);
  assert.equal(row.firstNonexpiredDue, vector.expected.find(day => day >= vector.asOf));
  assert.ok(row.missed.every(due => due.date < vector.asOf && due.projectedPoints === 0));
  assert.ok(row.current.every(due => due.date === vector.asOf));
  assert.ok(row.future.every(due => due.date > vector.asOf && due.date <= vector.through));
});

test('custom interval one matches daily day boundaries', () => {
  assert.deepEqual(dates(projected(snapshot({ chores: [chore({ frequency: 'custom', customIntervalDays: 1 })] }))), ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
});
test('today remains current at both suggestive time extremes', () => {
  const rows = ['00:00', '23:59'].map(nextDueTime => projected(snapshot({ through: '2026-10-21', chores: [chore({ nextDueTime })] })));
  assert.deepEqual(rows.map(row => [row.missed.length, row.current.length, row.future.length]), [[0, 1, 0], [0, 1, 0]]);
  assert.deepEqual(rows[0]?.current, rows[1]?.current);
});
test('future anchor beyond horizon creates no phantom history and reports its next due', () => {
  const row = projected(snapshot({ chores: [chore({ nextDue: '2030-01-31', frequency: 'monthly' })] }));
  assert.deepEqual(dates(row), []); assert.equal(row.firstNonexpiredDue, '2030-01-31');
});
test('next nonexpired occurrence is reported even when outside an inclusive one-day horizon', () => {
  const row = projected(snapshot({ through: '2026-10-21', chores: [chore({ nextDue: '2026-10-20', frequency: 'weekly' })] }));
  assert.deepEqual(row.missed.map(item => [item.date, item.projectedPoints]), [['2026-10-20', 0]]);
  assert.equal(row.firstNonexpiredDue, '2026-10-27'); assert.deepEqual(row.current, []); assert.deepEqual(row.future, []);
});
test('early Gregorian years and century leap rules avoid the JS year-0-to-99 trap', () => {
  for (const [start, end, expected] of [
    ['0001-12-31', '0002-01-01', ['0001-12-31', '0002-01-01']],
    ['0099-12-31', '0100-01-01', ['0099-12-31', '0100-01-01']],
    ['1900-02-28', '1900-03-01', ['1900-02-28', '1900-03-01']],
    ['2000-02-28', '2000-03-01', ['2000-02-28', '2000-02-29', '2000-03-01']],
  ]) assert.deepEqual(dates(projected(snapshot({ asOf: start, through: end, chores: [chore({ nextDue: start })] }))), expected);
});
test('skipped states produce stable diagnostics without fabricating missed work', () => {
  const rows = [
    { id: 'pending', title: 'Pending', enabled: true, state: 'pending-approval' },
    { id: 'done', title: 'Done', enabled: true, state: 'completed' },
    { id: 'disabled', title: 'Disabled', enabled: false, state: 'outstanding' },
  ];
  const result = previewChores(snapshot({ chores: rows }));
  assert.deepEqual(result.chores, []);
  assert.deepEqual(result.skipped, [{ id: 'disabled', reason: 'disabled' }, { id: 'done', reason: 'completed' }, { id: 'pending', reason: 'pending-approval' }]);
  assert.deepEqual(result.totals, { missed: 0, current: 0, future: 0 });
});
test('normalization is independent of input order and leaves frozen snapshots unchanged', () => {
  const input = snapshot({ chores: [Object.freeze(chore({ id: 'z' })), Object.freeze(chore({ id: 'a', title: 'Line1\r\nLine2\rLine3' }))] });
  Object.freeze(input.chores); Object.freeze(input);
  const before = JSON.stringify(input), first = previewChores(input);
  const second = previewChores({ ...input, chores: [...input.chores].reverse() });
  assert.deepEqual(first, second); assert.equal(JSON.stringify(input), before);
  assert.equal(parseSnapshot(input).chores[0]?.title, 'Line1\nLine2\nLine3');
});
test('combined occurrence budget includes historical rows and accepts its exact limit', () => {
  const through = new Date(Date.UTC(2026, 0, 1) + 999 * 86400000).toISOString().slice(0, 10);
  const rows = Array.from({ length: 10 }, (_, i) => chore({ id: `row-${i}`, nextDue: '2026-01-01' }));
  const result = previewChores(snapshot({ asOf: through, through, chores: rows }));
  assert.deepEqual(result.totals, { missed: 9990, current: 10, future: 0 });
  assert.throws(() => previewChores(snapshot({ asOf: through, through, chores: [...rows, chore({ id: 'extra', nextDue: '2026-01-01' })] })), /10000 occurrences/);
});
test('historical work rejects ancient anchors before any unbounded catch-up loop', () => {
  assert.throws(() => previewChores(snapshot({ chores: [chore({ nextDue: '0001-01-01' })] })), /3660 days/);
});
test('year-9999 boundary fails closed when an exclusive end or next due cannot exist', () => {
  assert.throws(() => previewChores(snapshot({ asOf: '9999-12-31', through: '9999-12-31', chores: [chore({ nextDue: '9999-12-31' })] })), /end beyond year 9999/);
  assert.throws(() => previewChores(snapshot({ asOf: '9999-12-31', through: '9999-12-31', chores: [chore({ nextDue: '9999-12-30', frequency: 'annually' })] })), /next nonexpired occurrence/);
  assert.deepEqual(dates(projected(snapshot({ asOf: '9999-12-30', through: '9999-12-30', chores: [chore({ nextDue: '9999-12-30' })] }))), ['9999-12-30']);
});
