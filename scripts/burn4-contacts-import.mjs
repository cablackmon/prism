import ICAL from 'ical.js';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{identity: string, uid: string|null, recordIds: string[], displayName: string, emails: string[], phones: string[]}} Contact */
/** @typedef {{schemaVersion: 1, sourceId: string, complete: boolean, contacts: Contact[]}} Snapshot */
/** @typedef {{index: number, recordId: string|null, identity: string|null, code: string}} RecordIssue */
/** @typedef {{identity: string, recordIds: string[], code: string}} Conflict */
/** @typedef {{contact: Contact|null, issue: RecordIssue|null, recordId: string|null, identity: string|null, identities: string[], index: number}} ParsedRecord */
/** @typedef {{identity: string, fields: string[], before: Contact, after: Contact}} Change */
/** @typedef {{readText: (path: string, maxBytes: number) => Promise<string>, writeOutput: (text: string) => void, writeError: (text: string) => void}} CliIO */

export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 1000;
const MAX_VCARD_BYTES = 256 * 1024;

export class ContactsInputError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'ContactsInputError';
    this.code = code;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @param {string} code @param {number} [max] */
function text(value, code, max = 1000) {
  if (typeof value !== 'string' || value.length > max) throw new ContactsInputError(code);
  const result = value.normalize('NFC').trim();
  if (!result) throw new ContactsInputError(code);
  return result;
}

/** @param {string} a @param {string} b */
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** @param {unknown} value @param {string} code @returns {string[]} */
function channels(value, code) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new ContactsInputError(code);
  return [...new Set(Array.from(value, (entry) => text(entry, code)))].sort(compare);
}

/** @param {string} sourceId @param {string|null} uid @param {string} recordId */
function identity(sourceId, uid, recordId) {
  return JSON.stringify([sourceId, uid === null ? 'record' : 'uid', uid ?? recordId]);
}

/** @param {unknown} raw @param {string} sourceId @param {string} recordId @returns {Contact} */
function normalizeContact(raw, sourceId, recordId) {
  if (!object(raw)) throw new ContactsInputError('invalid_contact');
  const uid = raw.uid === undefined || raw.uid === null ? null : text(raw.uid, 'invalid_uid', 500);
  return {
    identity: identity(sourceId, uid, recordId),
    uid,
    recordIds: [recordId],
    displayName: text(raw.displayName, 'invalid_display_name', 500),
    emails: channels(raw.emails, 'invalid_emails'),
    phones: channels(raw.phones, 'invalid_phones'),
  };
}

/** @param {ICAL.Component} component @param {string} name @returns {unknown[]} */
function propertyValues(component, name) {
  return component.getAllProperties(name).flatMap((property) => property.getValues());
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function parseVCard(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_VCARD_BYTES) {
    throw new ContactsInputError('invalid_vcard_size');
  }
  try {
    /** @type {unknown} */
    const parsed = ICAL.parse(value);
    if (!Array.isArray(parsed) || parsed[0] !== 'vcard') throw new ContactsInputError('invalid_vcard_root');
    const component = new ICAL.Component(parsed);
    const versions = propertyValues(component, 'version');
    const names = propertyValues(component, 'fn');
    const uids = propertyValues(component, 'uid');
    const issue = versions.length !== 1 || (versions[0] !== '3.0' && versions[0] !== '4.0') ? 'unsupported_vcard_version'
      : names.length !== 1 ? 'ambiguous_or_missing_name'
      : uids.length > 1 ? 'ambiguous_uid'
      : component.getAllSubcomponents().length ? 'invalid_vcard_components' : null;
    return { displayName: names[0], uid: uids[0], emails: propertyValues(component, 'email'), phones: propertyValues(component, 'tel'), parsedUids: uids, validationIssue: issue };
  } catch (error) {
    if (error instanceof ContactsInputError) throw error;
    throw new ContactsInputError('invalid_vcard');
  }
}

/** @param {unknown} raw @param {string} sourceId @param {number} index @returns {ParsedRecord} */
function parseRecord(raw, sourceId, index) {
  /** @type {string|null} */
  let recordId = null;
  /** @type {string|null} */
  let key = null;
  /** @type {string[]} */
  const identities = [];
  try {
    if (!object(raw)) throw new ContactsInputError('invalid_record');
    recordId = text(raw.recordId, 'invalid_record_id', 200);
    key = identity(sourceId, null, recordId);
    /** @type {unknown} */
    let contact;
    if (raw.format === 'vcard' && raw.contact === undefined) contact = parseVCard(raw.vcardText);
    else if (raw.format === 'contact' && raw.vcardText === undefined) contact = raw.contact;
    else throw new ContactsInputError('invalid_record_format');
    if (object(contact) && typeof contact.uid === 'string') {
      key = identity(sourceId, text(contact.uid, 'invalid_uid', 500), recordId);
    }
    if (raw.format === 'vcard' && object(contact)) {
      if (Array.isArray(contact.parsedUids)) {
        for (const uid of contact.parsedUids) {
          if (typeof uid === 'string' && uid.trim() && uid.length <= 500) identities.push(identity(sourceId, uid.normalize('NFC').trim(), recordId));
        }
      }
      if (typeof contact.validationIssue === 'string') throw new ContactsInputError(contact.validationIssue);
    }
    const normalized = normalizeContact(contact, sourceId, recordId);
    return { contact: normalized, issue: null, recordId, identity: normalized.identity, identities: [normalized.identity], index };
  } catch (error) {
    const code = error instanceof ContactsInputError ? error.code : 'invalid_record';
    if (key) identities.push(key);
    return { contact: null, issue: { index, recordId, identity: key, code }, recordId, identity: key, identities, index };
  }
}

/** @param {Contact} contact */
function contactValues(contact) {
  return JSON.stringify([contact.displayName, contact.emails, contact.phones]);
}

/** @param {unknown} raw @param {string} sourceId @returns {Snapshot|null} */
function previousSnapshot(raw, sourceId) {
  if (raw === undefined) return null;
  if (!object(raw) || raw.schemaVersion !== 1 || raw.sourceId !== sourceId || typeof raw.complete !== 'boolean' ||
      !Array.isArray(raw.contacts) || raw.contacts.length > MAX_RECORDS) throw new ContactsInputError('invalid_previous_snapshot');
  /** @type {Contact[]} */
  const contacts = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Set<string>} */
  const seenRecordIds = new Set();
  try {
    for (const entry of raw.contacts) {
      if (!object(entry) || !Array.isArray(entry.recordIds) || entry.recordIds.length < 1 || entry.recordIds.length > MAX_RECORDS) {
        throw new ContactsInputError('invalid_previous_snapshot');
      }
      const ids = [...new Set(Array.from(entry.recordIds, (id) => text(id, 'invalid_previous_snapshot', 200)))].sort(compare);
      if (ids.some((id) => seenRecordIds.has(id))) throw new ContactsInputError('invalid_previous_snapshot');
      for (const id of ids) seenRecordIds.add(id);
      const first = ids[0];
      if (first === undefined) throw new ContactsInputError('invalid_previous_snapshot');
      const normalized = normalizeContact(entry, sourceId, first);
      if (normalized.uid === null && ids.length !== 1) throw new ContactsInputError('invalid_previous_snapshot');
      normalized.recordIds = ids;
      if (normalized.identity !== entry.identity || seen.has(normalized.identity) ||
          JSON.stringify(normalized) !== JSON.stringify({
            identity: entry.identity, uid: entry.uid, recordIds: entry.recordIds,
            displayName: entry.displayName, emails: entry.emails, phones: entry.phones,
          })) throw new ContactsInputError('invalid_previous_snapshot');
      seen.add(normalized.identity);
      contacts.push(normalized);
    }
  } catch {
    throw new ContactsInputError('invalid_previous_snapshot');
  }
  return { schemaVersion: 1, sourceId, complete: raw.complete, contacts: contacts.sort((a, b) => compare(a.identity, b.identity)) };
}

/**
 * Prepare only caller-supplied records. Accepted contacts can be an incomplete
 * subset; the snapshot.complete flag and diff suppression reasons are required
 * when interpreting it. No mutation or provider operation is performed.
 * @param {unknown} input
 */
export function prepareContactsMirror(input) {
  if (!object(input) || input.schemaVersion !== 1 || typeof input.complete !== 'boolean' ||
      !Array.isArray(input.records) || input.records.length > MAX_RECORDS) throw new ContactsInputError('invalid_envelope');
  const sourceId = text(input.sourceId, 'invalid_source_id', 200);
  const previous = previousSnapshot(input.previous, sourceId);
  const parsed = Array.from(input.records, (record, index) => parseRecord(record, sourceId, index));
  /** @type {RecordIssue[]} */
  const issues = [];
  /** @type {Conflict[]} */
  const conflicts = [];
  /** @type {Set<string>} */
  const blocked = new Set();
  /** @type {Map<string, ParsedRecord[]>} */
  const byRecordId = new Map();
  for (const result of parsed) {
    if (result.issue) {
      issues.push(result.issue);
      for (const key of result.identities) blocked.add(key);
      for (const old of previous?.contacts ?? []) {
        if (result.recordId && old.recordIds.includes(result.recordId)) blocked.add(old.identity);
      }
    }
    if (result.recordId) {
      const group = byRecordId.get(result.recordId) ?? [];
      group.push(result);
      byRecordId.set(result.recordId, group);
    }
  }
  for (const [recordId, group] of byRecordId) {
    if (group.length < 2) continue;
    for (const result of group) {
      for (const key of result.identities) blocked.add(key);
      issues.push({ index: result.index, recordId, identity: result.identity, code: 'duplicate_record_id' });
    }
  }
  /** @type {Map<string, Contact[]>} */
  const byIdentity = new Map();
  for (const result of parsed) {
    if (!result.contact) continue;
    const group = byIdentity.get(result.contact.identity) ?? [];
    group.push(result.contact);
    byIdentity.set(result.contact.identity, group);
  }
  /** @type {Contact[]} */
  const contacts = [];
  for (const [key, group] of byIdentity) {
    const first = group[0];
    if (!first) continue;
    const recordIds = [...new Set(group.flatMap((contact) => contact.recordIds))].sort(compare);
    if (group.some((contact) => contactValues(contact) !== contactValues(first))) {
      blocked.add(key);
      conflicts.push({ identity: key, recordIds, code: 'conflicting_identity' });
    }
    if (blocked.has(key)) continue;
    contacts.push({ ...first, recordIds });
  }
  contacts.sort((a, b) => compare(a.identity, b.identity));
  issues.sort((a, b) => compare(a.recordId ?? '', b.recordId ?? '') || compare(a.code, b.code) || a.index - b.index);
  conflicts.sort((a, b) => compare(a.identity, b.identity));
  const complete = input.complete && issues.length === 0 && conflicts.length === 0;
  /** @type {Snapshot} */
  const snapshot = { schemaVersion: 1, sourceId, complete, contacts };
  const suppressionReasons = [];
  if (!previous) suppressionReasons.push('no_previous_snapshot');
  else if (!previous.complete) suppressionReasons.push('previous_incomplete');
  if (!input.complete) suppressionReasons.push('input_incomplete');
  if (issues.length) suppressionReasons.push('rejected_records');
  if (conflicts.length) suppressionReasons.push('identity_conflicts');
  /** @type {Contact[]} */
  const added = [];
  /** @type {Change[]} */
  const changed = [];
  /** @type {string[]} */
  const unchanged = [];
  /** @type {Contact[]} */
  const missing = [];
  if (previous) {
    const before = new Map(previous.contacts.map((contact) => [contact.identity, contact]));
    for (const contact of contacts) {
      const old = before.get(contact.identity);
      if (!old) added.push(contact);
      else {
        const fields = ['displayName', 'emails', 'phones'].filter((field) => {
          const key = /** @type {'displayName'|'emails'|'phones'} */ (field);
          return JSON.stringify(old[key]) !== JSON.stringify(contact[key]);
        });
        if (fields.length) changed.push({ identity: contact.identity, fields, before: old, after: contact });
        else unchanged.push(contact.identity);
      }
    }
    if (suppressionReasons.length === 0) {
      const present = new Set(contacts.map((contact) => contact.identity));
      missing.push(...previous.contacts.filter((contact) => !present.has(contact.identity)));
    }
  }
  return {
    snapshot, issues, conflicts,
    diff: { compared: previous !== null, added, changed, unchanged, missing, missingSuppressed: suppressionReasons.length > 0, suppressionReasons },
  };
}

/** Read only the explicit regular input file, bounded even if it grows. @param {string} path @param {number} maxBytes */
async function readBoundedText(path, maxBytes) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new ContactsInputError('input_too_large_or_not_file');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const chunk = await file.read(buffer, size, buffer.length - size, size);
      if (!chunk.bytesRead) break;
      size += chunk.bytesRead;
    }
    if (size > maxBytes) throw new ContactsInputError('input_too_large_or_not_file');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  } finally {
    await file.close();
  }
}

/** @param {readonly string[]} args @param {CliIO} io @returns {Promise<number>} */
export async function runContactsImportCli(args, io) {
  try {
    const path = args[0];
    if (args.length !== 1 || !path || path.startsWith('-') || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
      throw new ContactsInputError('usage_expected_one_json_file');
    }
    let content;
    try { content = await io.readText(path, MAX_INPUT_BYTES); }
    catch (error) {
      if (error instanceof ContactsInputError) throw error;
      throw new ContactsInputError('input_read_failed');
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_INPUT_BYTES) throw new ContactsInputError('input_too_large');
    /** @type {unknown} */
    let input;
    try { input = JSON.parse(content); }
    catch { throw new ContactsInputError('invalid_json'); }
    const result = prepareContactsMirror(input);
    io.writeOutput(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof ContactsInputError ? error.code : 'contacts_preparation_failed';
    io.writeError(`${JSON.stringify({ error: code })}\n`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runContactsImportCli(process.argv.slice(2), {
    readText: readBoundedText,
    writeOutput: (value) => { process.stdout.write(value); },
    writeError: (value) => { process.stderr.write(value); },
  });
}
