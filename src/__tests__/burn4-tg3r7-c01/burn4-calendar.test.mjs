import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { renderCalendar, previewChores } from '../../../scripts/burn4-chore-anchor-preview.mjs';
import { chore, snapshot } from './burn4-fixtures.mjs';

/** @param {string} source */
function events(source) { return new ICAL.Component(ICAL.parse(source)).getAllSubcomponents('vevent').map(component => new ICAL.Event(component)); }

test('calendar exports current/future dates only, with exclusive all-day ends', () => {
  const output = renderCalendar(snapshot({ asOf: '2028-02-29', through: '2028-03-01', chores: [chore({ nextDue: '2028-02-28' })] }));
  const parsed = events(output);
  assert.deepEqual(parsed.map(event => [event.startDate.year, event.startDate.month, event.startDate.day, event.endDate.month, event.endDate.day, event.startDate.isDate, event.endDate.isDate]), [[2028, 2, 29, 3, 1, true, true], [2028, 3, 1, 3, 2, true, true]]);
  assert.ok(parsed.every(event => !event.component.hasProperty('rrule') && !event.component.hasProperty('attach')));
  assert.equal(new ICAL.Component(ICAL.parse(output)).hasProperty('method'), false);
  assert.equal(String(parsed[0]?.component.getFirstPropertyValue('dtstamp')), '2000-01-01T00:00:00Z');
});
test('exclusive ends cross a year boundary without a timezone shift', () => {
  const output = renderCalendar(snapshot({ asOf: '0099-12-31', through: '0099-12-31', chores: [chore({ nextDue: '0099-12-31' })] }));
  const event = events(output)[0]; assert.ok(event);
  assert.deepEqual([event.startDate.year, event.startDate.month, event.startDate.day], [99, 12, 31]);
  assert.deepEqual([event.endDate.year, event.endDate.month, event.endDate.day], [100, 1, 1]);
});
test('empty/skipped snapshots retain JSON diagnostics and reject an empty calendar', () => {
  const input = snapshot({ chores: [{ id: 'skip', title: 'Skip', enabled: true, state: 'completed' }] });
  assert.equal(previewChores(input).skipped.length, 1);
  assert.throws(() => renderCalendar(input), /No current or future occurrences/);
  assert.throws(() => renderCalendar(snapshot({ chores: [] })), /No current or future occurrences/);
});
test('Unicode and hostile text round-trip without content-line injection', () => {
  const title = 'é漢🧽'.repeat(75) + '\\,;\r\nBEGIN:VEVENT\rEND:VCALENDAR\nATTACH:https://invalid.invalid\nBEGIN:VALARM';
  const output = renderCalendar(snapshot({ through: '2026-10-21', chores: [chore({ title, nextDueTime: '09:30' })] }));
  const physical = output.split('\r\n').filter(Boolean);
  assert.ok(physical.every(line => Buffer.byteLength(line, 'utf8') <= 75));
  assert.ok(physical.every(line => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(line)) === line));
  assert.equal(output.replace(/\r\n/g, '').includes('\n'), false);
  const parsed = events(output); assert.equal(parsed.length, 1);
  const event = parsed[0]; assert.ok(event);
  assert.equal(event.summary, title.replace(/\r\n?/g, '\n'));
  assert.equal(event.component.getAllSubcomponents().length, 0);
  assert.equal(event.component.hasProperty('attach'), false);
  assert.match(event.description, /Suggested time: 09:30; the entire due day stays open/);
});
test('UIDs stay unique for separator-rich IDs and stable across title/order/horizon changes', () => {
  const rows = ['a', 'a/b', 'a:b', 'a-2026-10-21'].map(id => chore({ id }));
  const source = snapshot({ chores: rows });
  const first = events(renderCalendar(source));
  assert.equal(new Set(first.map(event => event.uid)).size, 16);
  assert.ok(first.every(event => /^chore-[0-9a-f]{64}@prism\.invalid$/.test(event.uid)));
  const changed = events(renderCalendar({ ...source, asOf: '2026-10-22', through: '2026-10-23', chores: rows.reverse().map(row => ({ ...row, title: 'Changed' })) }));
  assert.ok(changed.every(event => first.some(original => original.uid === event.uid)));
  assert.equal(renderCalendar(source), renderCalendar(source));
});
test('UTF-8 folding counts continuation whitespace around the exact byte boundary', () => {
  for (const title of ['a'.repeat(67), 'é'.repeat(34), '漢'.repeat(23), '🧽'.repeat(18), 'a'.repeat(66) + '🧽']) {
    const output = renderCalendar(snapshot({ through: '2026-10-21', chores: [chore({ title })] }));
    assert.ok(output.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 75));
    assert.equal(events(output)[0]?.summary, title);
  }
});
test('event ordering is chronological and then stable by ID', () => {
  const output = renderCalendar(snapshot({ through: '2026-10-22', chores: [chore({ id: 'z', title: 'Z' }), chore({ id: 'a', title: 'A' })] }));
  assert.deepEqual(events(output).map(event => [event.startDate.day, event.summary]), [[21, 'A'], [21, 'Z'], [22, 'A'], [22, 'Z']]);
});
