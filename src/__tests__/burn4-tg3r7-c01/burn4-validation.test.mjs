import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot, previewChores } from '../../../scripts/burn4-chore-anchor-preview.mjs';
import { chore, snapshot } from './burn4-fixtures.mjs';

const rootCases = [
  { name: 'null', value: null }, { name: 'array root', value: [] }, { name: 'Date instance', value: new Date(0) },
  { name: 'unknown field', value: snapshot({ secretSentinel: 'DO_NOT_ECHO' }) },
  { name: 'missing as-of', value: snapshot({ asOf: undefined }) },
  { name: 'reversed horizon', value: snapshot({ through: '2026-10-20' }) },
  { name: 'year zero', value: snapshot({ asOf: '0000-01-01' }) },
  { name: 'noncanonical date', value: snapshot({ asOf: '2026-1-01' }) },
  { name: 'impossible century leap day', value: snapshot({ asOf: '1900-02-29' }) },
  { name: 'impossible leap day', value: snapshot({ asOf: '2100-02-29' }) },
  { name: 'impossible month', value: snapshot({ asOf: '2026-13-01' }) },
  { name: 'day zero', value: snapshot({ asOf: '2026-10-00' }) },
  { name: 'impossible month day', value: snapshot({ asOf: '2026-04-31' }) },
  { name: 'absent chores', value: snapshot({ chores: undefined }) },
  { name: 'nonarray chores', value: snapshot({ chores: {} }) },
  { name: 'null chore', value: snapshot({ chores: [null] }) },
  { name: 'duplicate IDs', value: snapshot({ chores: [chore(), chore()] }) },
  { name: 'sparse array', value: snapshot({ chores: Array(1) }) },
  { name: 'own prototype key', value: JSON.parse('{"asOf":"2026-10-21","through":"2026-10-21","chores":[],"__proto__":{}}') },
];
for (const item of rootCases) test(`schema rejects ${item.name} without echoing raw data`, () => {
  assert.throws(() => parseSnapshot(item.value), error => error instanceof Error && !error.message.includes('DO_NOT_ECHO'));
});
const badRows = [
  { name: 'absent id', change: { id: undefined } }, { name: 'empty title', change: { title: '  ' } },
  { name: 'long id', change: { id: 'x'.repeat(129) } }, { name: 'long title', change: { title: 'x'.repeat(1001) } },
  { name: 'id whitespace', change: { id: 'a b' } }, { name: 'control character', change: { title: 'a\0b' } },
  { name: 'lone surrogate', change: { title: '\ud800' } }, { name: 'nonboolean enabled', change: { enabled: 'true' } },
  { name: 'missing state', change: { state: undefined } }, { name: 'unknown state', change: { state: 'pending' } },
  { name: 'unknown frequency', change: { frequency: 'sometimes' } }, { name: 'missing frequency', change: { frequency: undefined } },
  { name: 'missing due date', change: { nextDue: undefined } }, { name: 'impossible due date', change: { nextDue: '2026-02-30' } },
  { name: 'missing evidence', change: { noInterveningCompletion: undefined } }, { name: 'false evidence', change: { noInterveningCompletion: false } },
  { name: 'truthy evidence', change: { noInterveningCompletion: 'yes' } }, { name: 'contradictory evidence', change: { state: 'completed' } },
  { name: 'invalid hour', change: { nextDueTime: '24:00' } }, { name: 'invalid minute', change: { nextDueTime: '12:60' } },
  { name: 'time format', change: { nextDueTime: '1:00' } }, { name: 'null time', change: { nextDueTime: null } },
  { name: 'missing custom interval', change: { frequency: 'custom' } }, { name: 'zero interval', change: { frequency: 'custom', customIntervalDays: 0 } },
  { name: 'fractional interval', change: { frequency: 'custom', customIntervalDays: 1.5 } }, { name: 'excessive interval', change: { frequency: 'custom', customIntervalDays: 366 } },
  { name: 'string interval', change: { frequency: 'custom', customIntervalDays: '7' } }, { name: 'nonfinite interval', change: { frequency: 'custom', customIntervalDays: Infinity } },
  { name: 'irrelevant interval', change: { frequency: 'daily', customIntervalDays: 7 } }, { name: 'unknown metadata', change: { lastCompleted: null } },
];
for (const item of badRows) test(`chore rejects ${item.name}`, () => {
  assert.throws(() => parseSnapshot(snapshot({ chores: [chore(item.change)] })));
});
test('maximum text lengths and Unicode pairs remain valid', () => {
  const row = parseSnapshot(snapshot({ chores: [chore({ id: 'x'.repeat(128), title: '🧽'.repeat(500) })] })).chores[0];
  assert.equal(row?.id.length, 128); assert.equal(row?.title.length, 1000);
});
test('supplied invalid schedule fields still reject on skipped records', () => {
  assert.throws(() => parseSnapshot(snapshot({ chores: [{ id: 'skip', title: 'Skip', enabled: false, state: 'completed', nextDue: '2026-02-30' }] })), /Gregorian/);
});
test('row limit accepts 1000 skipped rows and rejects the next', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `skip-${i}`, title: 'Skip', enabled: false, state: 'completed' }));
  assert.equal(previewChores(snapshot({ chores: rows })).skipped.length, 1000);
  assert.throws(() => parseSnapshot(snapshot({ chores: [...rows, { id: 'extra', title: 'Skip', enabled: false, state: 'completed' }] })), /1000 rows/);
});
test('horizon accepts exactly 3660 days and rejects one more', () => {
  /** @param {number} offset */
  const day = (offset) => new Date(Date.UTC(2026, 0, 1) + offset * 86400000).toISOString().slice(0, 10);
  assert.equal(parseSnapshot({ asOf: '2026-01-01', through: day(3660), chores: [] }).through, day(3660));
  assert.throws(() => parseSnapshot({ asOf: '2026-01-01', through: day(3661), chores: [] }), /3660 days/);
});
test('accessor records and arrays reject without invoking their getters', () => {
  let reads = 0;
  const row = { id: 'skip', title: 'placeholder', enabled: false, state: 'completed' };
  Object.defineProperty(row, 'title', { enumerable: true, get() { reads++; return 'Getter title'; } });
  assert.throws(() => parseSnapshot(snapshot({ chores: [row] })), /Accessors/);
  const input = snapshot(); Object.defineProperty(input, 'asOf', { get() { reads++; return '2026-10-21'; } });
  assert.throws(() => parseSnapshot(input), /Accessors/);
  const array = [chore()]; Object.defineProperty(array, '0', { get() { reads++; return chore(); } });
  assert.throws(() => parseSnapshot(snapshot({ chores: array })), /accessors/);
  assert.equal(reads, 0);
});
test('symbol fields and extra array properties are rejected', () => {
  assert.throws(() => parseSnapshot({ ...snapshot(), [Symbol('unknown')]: 1 }), /Unknown/);
  const rows = Object.assign([chore()], { unknown: 1 });
  assert.throws(() => parseSnapshot(snapshot({ chores: rows })), /plain dense array/);
});

test('array subclasses and nonenumerable fields reject before normalization side effects', () => {
  let speciesReads = 0;
  class Subclass extends Array { static get [Symbol.species]() { speciesReads++; return Array; } }
  const rows = new Subclass(chore());
  assert.throws(() => parseSnapshot(snapshot({ chores: rows })), /plain array/);
  assert.equal(speciesReads, 0);
  const row = chore(); Object.defineProperty(row, 'nextDue', { value: '2026-10-21', enumerable: false });
  assert.throws(() => parseSnapshot(snapshot({ chores: [row] })), /nonenumerable/);
});
