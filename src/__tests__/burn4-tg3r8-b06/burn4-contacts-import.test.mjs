import test from 'node:test';
import assert from 'node:assert/strict';
import { ContactsInputError, prepareContactsMirror } from '../../../scripts/burn4-contacts-import.mjs';

/** @param {string} recordId @param {string|null} [uid] @param {Record<string, unknown>} [fields] */
function record(recordId, uid = recordId, fields = {}) {
  return { recordId, format: 'contact', contact: { uid, displayName: `Person ${recordId}`, emails: [], phones: [], ...fields } };
}
/** @param {readonly unknown[]} records @param {Record<string, unknown>} [options] */
function prepare(records, options = {}) {
  return prepareContactsMirror({ schemaVersion: 1, sourceId: 'synthetic-book', complete: true, records, ...options });
}
/** @param {string[]} lines @param {string} [version] */
function card(lines, version = '4.0') {
  return ['BEGIN:VCARD', `VERSION:${version}`, ...lines, 'END:VCARD'].join('\r\n');
}

test('explicit contacts normalize supported fields without mutating input', () => {
  const input = record('a', ' uid-a ', { displayName: '  Rene\u0301  Example  ', emails: [' B@example.invalid ', 'a@example.invalid', 'B@example.invalid'], phones: [' +1 555 0100 ', '+1 555 0100'] });
  const before = JSON.stringify(input);
  const result = prepare([input]);
  assert.deepEqual(result.snapshot.contacts, [{ identity: '["synthetic-book","uid","uid-a"]', uid: 'uid-a', recordIds: ['a'], displayName: 'René  Example', emails: ['B@example.invalid', 'a@example.invalid'], phones: ['+1 555 0100'] }]);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.snapshot.complete, true);
  assert.equal(result.diff.compared, false);
});

test('vCard 3.0 parses escaped names and repeated parameterized channels', () => {
  const result = prepare([{ recordId: 'card-a', format: 'vcard', vcardText: card(['UID:card-uid', 'FN:Example\\, Person', 'EMAIL;TYPE=HOME:home@example.invalid', 'EMAIL;TYPE=WORK:work@example.invalid', 'EMAIL:home@example.invalid', 'TEL;TYPE=CELL:+1 555 0101'], '3.0') }]);
  assert.equal(result.snapshot.contacts[0]?.displayName, 'Example, Person');
  assert.deepEqual(result.snapshot.contacts[0]?.emails, ['home@example.invalid', 'work@example.invalid']);
  assert.deepEqual(result.snapshot.contacts[0]?.phones, ['+1 555 0101']);
  assert.equal(result.snapshot.complete, true);
});

test('vCard 4.0 unfolds FN and preserves TEL URI text without resolving it', () => {
  const result = prepare([{ recordId: 'v4', format: 'vcard', vcardText: card(['UID:v4-id', 'FN:Long ', ' Name', 'TEL;VALUE=uri:tel:+15550102', 'PHOTO;VALUE=uri:https://never-read.invalid/photo', 'BDAY:20000101', 'ADR:;;Synthetic Street;Town;;;']) }]);
  assert.equal(result.snapshot.contacts[0]?.displayName, 'Long Name');
  assert.deepEqual(result.snapshot.contacts[0]?.phones, ['tel:+15550102']);
  assert.deepEqual(Object.keys(result.snapshot.contacts[0] ?? {}), ['identity', 'uid', 'recordIds', 'displayName', 'emails', 'phones']);
});

test('missing UID uses explicit source-scoped record identity and retains case', () => {
  const result = prepare([record('stable', null, { emails: ['Name@example.invalid', 'name@example.invalid'] })]);
  assert.equal(result.snapshot.contacts[0]?.identity, '["synthetic-book","record","stable"]');
  assert.deepEqual(result.snapshot.contacts[0]?.emails, ['Name@example.invalid', 'name@example.invalid']);
  assert.notEqual(result.snapshot.contacts[0]?.identity, prepare([record('stable', null)], { sourceId: 'other-book' }).snapshot.contacts[0]?.identity);
});

test('identity encoding prevents separator and identity-kind collisions', () => {
  const a = prepare([record('x', 'x')]).snapshot.contacts[0]?.identity;
  const b = prepare([record('x', null)]).snapshot.contacts[0]?.identity;
  assert.notEqual(a, b);
  const c = prepare([record('r', 'c')], { sourceId: 'a|b' }).snapshot.contacts[0]?.identity;
  const d = prepare([record('r', 'b|c')], { sourceId: 'a' }).snapshot.contacts[0]?.identity;
  assert.notEqual(c, d);
});

test('distinct identities with shared names and channels remain separate', () => {
  const result = prepare([record('a', 'a', { displayName: 'Shared', emails: ['shared@example.invalid'], phones: ['5550100'] }), record('b', 'b', { displayName: 'Shared', emails: ['shared@example.invalid'], phones: ['5550100'] })]);
  assert.equal(result.snapshot.contacts.length, 2);
  assert.equal(result.conflicts.length, 0);
});

test('identical UIDs coalesce with sorted origins independent of input order', () => {
  const records = [record('z', 'same', { displayName: 'Same Person' }), record('a', 'same', { displayName: 'Same Person' })];
  assert.deepEqual(prepare(records), prepare([...records].reverse()));
  assert.deepEqual(prepare(records).snapshot.contacts[0]?.recordIds, ['a', 'z']);
});

test('conflicting UID values quarantine all matches and preserve good siblings', () => {
  const result = prepare([record('a', 'same'), record('b', 'same'), record('good')]);
  assert.deepEqual(result.snapshot.contacts.map((contact) => contact.uid), ['good']);
  assert.equal(result.conflicts[0]?.code, 'conflicting_identity');
  assert.equal(result.snapshot.complete, false);
  assert.deepEqual(result.diff.suppressionReasons, ['no_previous_snapshot', 'identity_conflicts']);
});

test('duplicate record IDs quarantine even if their UIDs differ', () => {
  const result = prepare([record('same', 'a'), record('same', 'b'), record('good')]);
  assert.equal(result.snapshot.contacts.length, 1);
  assert.equal(result.issues.length, 2);
  assert.ok(result.issues.every((issue) => issue.code === 'duplicate_record_id'));
});

test('malformed records cannot discard valid sibling contacts', () => {
  const result = prepare([record('good'), { recordId: 'broken', format: 'vcard', vcardText: 'BEGIN:VCARD\nVERSION:4.0\nFN:Broken' }, record('blank', 'blank', { displayName: ' ' }), null]);
  assert.equal(result.snapshot.contacts.length, 1);
  assert.equal(result.issues.length, 3);
  assert.equal(result.snapshot.complete, false);
});

test('malformed optional channels do not become changes or missing prior contacts', () => {
  const previous = prepare([record('a', 'a', { emails: ['saved@example.invalid'] }), record('b')]).snapshot;
  const result = prepare([record('a', 'a', { emails: [null] }), record('b')], { previous });
  assert.deepEqual(result.diff.changed, []);
  assert.deepEqual(result.diff.missing, []);
  assert.deepEqual(result.diff.unchanged, ['["synthetic-book","uid","b"]']);
  assert.equal(result.diff.missingSuppressed, true);
  assert.deepEqual(previous.contacts.find((contact) => contact.uid === 'a')?.emails, ['saved@example.invalid']);
});

test('malformed explicit duplicate blocks a valid-looking record with the same UID', () => {
  const result = prepare([record('bad', 'shared', { phones: [false] }), record('good', 'shared')]);
  assert.deepEqual(result.snapshot.contacts, []);
  assert.equal(result.issues.length, 1);
});

test('recoverable UIDs on malformed vCards quarantine matching valid records', () => {
  const result = prepare([
    { recordId: 'missing-name', format: 'vcard', vcardText: card(['UID:shared']) },
    record('good', 'shared'),
    { recordId: 'two-uids', format: 'vcard', vcardText: card(['FN:Ambiguous', 'UID:first', 'UID:second']) },
    record('first', 'first'), record('second', 'second'),
  ]);
  assert.deepEqual(result.snapshot.contacts, []);
  assert.equal(result.issues.length, 2);
});

test('unreadable prior resource blocks its known old identity from ordinary comparison', () => {
  const previous = prepare([record('old-resource', 'stable')]).snapshot;
  const result = prepare([
    { recordId: 'old-resource', format: 'vcard', vcardText: 'BEGIN:VCARD' },
    record('different-resource', 'stable', { emails: [] }),
  ], { previous });
  assert.deepEqual(result.snapshot.contacts, []);
  assert.deepEqual(result.diff.changed, []);
  assert.deepEqual(result.diff.missing, []);
});

for (const [name, vcardText] of [
  ['wrong root', 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR'],
  ['multiple cards', `${card(['FN:First'])}\r\n${card(['FN:Second'])}`],
  ['unsupported version', card(['FN:Old'], '2.1')],
  ['missing version', 'BEGIN:VCARD\nFN:No Version\nEND:VCARD'],
  ['missing name', card(['UID:unnamed'])],
  ['repeated name', card(['FN:First', 'FN:Second'])],
  ['repeated UID', card(['FN:Person', 'UID:first', 'UID:second'])],
]) {
  test(`vCard ${name} is quarantined`, () => {
    const result = prepare([{ recordId: 'invalid', format: 'vcard', vcardText }]);
    assert.equal(result.issues.length, 1);
    assert.equal(result.snapshot.complete, false);
    assert.deepEqual(result.snapshot.contacts, []);
  });
}

test('diff names added, changed, unchanged, and missing contacts exactly', () => {
  const previous = prepare([record('stay'), record('edit', 'edit', { emails: ['old@example.invalid'] }), record('gone')]).snapshot;
  const result = prepare([record('stay'), record('edit', 'edit', { displayName: 'Edited', emails: [] }), record('new')], { previous });
  assert.deepEqual(result.diff.added.map((contact) => contact.uid), ['new']);
  assert.deepEqual(result.diff.changed.map((change) => change.fields), [['displayName', 'emails']]);
  assert.deepEqual(result.diff.unchanged, ['["synthetic-book","uid","stay"]']);
  assert.deepEqual(result.diff.missing.map((contact) => contact.uid), ['gone']);
  assert.equal(result.diff.missingSuppressed, false);
});

test('resource ID moves and contact reordering do not create value changes', () => {
  const previous = prepare([record('old', 'stable', { displayName: 'Stable' }), record('other')]).snapshot;
  const result = prepare([record('other'), record('new', 'stable', { displayName: 'Stable' })], { previous });
  assert.equal(result.diff.unchanged.length, 2);
  assert.deepEqual(result.diff.changed, []);
  assert.deepEqual(result.diff.missing, []);
});

test('normalized snapshot round trip is idempotent', () => {
  const records = [record('b'), record('a', null)];
  const first = prepare(records);
  const second = prepare(records, { previous: first.snapshot });
  assert.deepEqual(first.snapshot, second.snapshot);
  assert.equal(second.diff.unchanged.length, 2);
});

for (const reason of ['input_incomplete', 'previous_incomplete', 'rejected_records', 'identity_conflicts']) {
  test(`missing contacts are suppressed for ${reason}`, () => {
    const previous = prepare([record('prior')]).snapshot;
    const records = reason === 'rejected_records' ? [null] : reason === 'identity_conflicts' ? [record('a', 'same'), record('b', 'same')] : [];
    const result = prepare(records, { complete: reason !== 'input_incomplete', previous: { ...previous, complete: reason !== 'previous_incomplete' } });
    assert.deepEqual(result.diff.missing, []);
    assert.ok(result.diff.suppressionReasons.includes(reason));
  });
}

test('explicit complete empty source can report prior contacts missing', () => {
  const previous = prepare([record('prior')]).snapshot;
  const result = prepare([], { previous });
  assert.equal(result.diff.missing.length, 1);
  assert.equal(result.snapshot.complete, true);
});

test('wrong source, duplicate prior identity, and non-normalized prior fields fail closed', () => {
  const previous = prepare([record('a')]).snapshot;
  for (const bad of [{ ...previous, sourceId: 'other' }, { ...previous, contacts: [...previous.contacts, ...previous.contacts] }, { ...previous, contacts: previous.contacts.map((contact) => ({ ...contact, displayName: ' untrimmed ' })) }]) {
    assert.throws(() => prepare([], { previous: bad }), (error) => error instanceof ContactsInputError && error.code === 'invalid_previous_snapshot');
  }
});

test('ambiguous previous resource origins fail closed', () => {
  const previous = prepare([record('a'), record('b')]).snapshot;
  const ambiguous = { ...previous, contacts: previous.contacts.map((contact) => ({ ...contact, recordIds: ['same-resource'] })) };
  assert.throws(() => prepare([], { previous: ambiguous }), ContactsInputError);
});

test('sparse pure-API inputs cannot bypass record or field validation', () => {
  const sparseRecords = prepare(new Array(1));
  assert.equal(sparseRecords.snapshot.complete, false);
  assert.equal(sparseRecords.issues.length, 1);
  const sparseChannels = prepare([record('a', 'a', { emails: new Array(1) })]);
  assert.equal(sparseChannels.snapshot.complete, false);
  assert.deepEqual(sparseChannels.snapshot.contacts, []);
});

test('fallback previous identity cannot claim multiple resource origins', () => {
  const previous = prepare([record('a', null)]).snapshot;
  const invalid = { ...previous, contacts: previous.contacts.map((contact) => ({ ...contact, recordIds: ['a', 'b'] })) };
  assert.throws(() => prepare([], { previous: invalid }), ContactsInputError);
});

test('invalid envelope types and bounds are rejected', () => {
  for (const input of [null, {}, { schemaVersion: 1, sourceId: 's', complete: true, records: new Array(1001).fill(null) }, { schemaVersion: 1, sourceId: '', complete: true, records: [] }, { schemaVersion: 1, sourceId: 's', records: [] }]) {
    assert.throws(() => prepareContactsMirror(input), ContactsInputError);
  }
});

test('record bounds quarantine oversize text, channels, and vCard data', () => {
  const result = prepare([record('name', 'n', { displayName: 'x'.repeat(501) }), record('list', 'l', { phones: new Array(51).fill('phone') }), { recordId: 'card', format: 'vcard', vcardText: 'x'.repeat(256 * 1024 + 1) }]);
  assert.equal(result.issues.length, 3);
  assert.deepEqual(result.snapshot.contacts, []);
});

test('frozen previous and caller input remain unchanged through comparison', () => {
  const previous = prepare([record('a')]).snapshot;
  Object.freeze(previous.contacts[0]?.emails);
  Object.freeze(previous.contacts[0]);
  Object.freeze(previous.contacts);
  Object.freeze(previous);
  const row = record('a', 'a', { displayName: 'Changed' });
  Object.freeze(row.contact);
  Object.freeze(row);
  const result = prepare(Object.freeze([row]), { previous });
  assert.deepEqual(result.diff.changed[0]?.fields, ['displayName']);
});
