import { createHash } from 'node:crypto';
import { constants, write } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{year:number, month:number, day:number, ordinal:number, iso:string}} Day */
/** @typedef {'daily'|'weekly'|'biweekly'|'monthly'|'quarterly'|'semi-annually'|'annually'|'custom'} Frequency */
/** @typedef {{id:string,title:string,enabled:boolean,state:'outstanding'|'pending-approval'|'completed',nextDue?:string,frequency?:Frequency,customIntervalDays?:number,nextDueTime?:string,noInterveningCompletion?:boolean}} Chore */
/** @typedef {{asOf:string,through:string,chores:Chore[]}} Snapshot */
/** @typedef {{date:string,uid:string}} Occurrence */
/** @typedef {{id:string,title:string,suggestedTime:string|null,firstNonexpiredDue:string,missed:(Occurrence & {projectedPoints:0})[],current:Occurrence[],future:Occurrence[]}} Projection */
/** @typedef {{schemaVersion:1,semantics:string,asOf:string,through:string,chores:Projection[],skipped:{id:string,reason:string}[],totals:{missed:number,current:number,future:number}}} Preview */
/** @typedef {{readInput:(path:string)=>Promise<string>,stdout:(text:string)=>void|Promise<void>,stderr:(text:string)=>void|Promise<void>}} CliIO */

const MAX_BYTES = 1048576;
const MAX_ROWS = 1000;
const MAX_SPAN = 3660;
const MAX_OCCURRENCES = 10000;
const frequencies = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semi-annually', 'annually', 'custom'];
const rowKeys = ['id', 'title', 'enabled', 'state', 'nextDue', 'frequency', 'customIntervalDays', 'nextDueTime', 'noInterveningCompletion'];
class InputError extends Error {}
/** @param {string} message @returns {never} */
function invalid(message) { throw new InputError(message); }
/** @param {number} year */
function leap(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
/** @param {number} year @param {number} month */
function monthDays(year, month) { return month === 2 ? leap(year) ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31; }
/** @param {number} year */
function yearStart(year) { const y = year - 1; return 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400); }
const MAX_DAY = yearStart(10000) - 1;
/** @param {number} year @param {number} month @param {number} day @returns {Day} */
function dayParts(year, month, day) {
  let ordinal = yearStart(year) + day - 1;
  for (let m = 1; m < month; m++) ordinal += monthDays(year, m);
  return { year, month, day, ordinal, iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}
/** @param {unknown} value @returns {Day} */
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('Dates must use YYYY-MM-DD.');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays(year, month)) invalid('A date is outside the Gregorian calendar.');
  return dayParts(year, month, day);
}
/** @param {number} ordinal @returns {Day|null} */
function fromOrdinal(ordinal) {
  if (ordinal < 0 || ordinal > MAX_DAY) return null;
  let low = 1, high = 9999;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (yearStart(mid) <= ordinal) low = mid; else high = mid - 1;
  }
  let remaining = ordinal - yearStart(low), month = 1;
  while (remaining >= monthDays(low, month)) { remaining -= monthDays(low, month); month++; }
  return dayParts(low, month, remaining + 1);
}
/** @param {unknown} value @param {string[]} keys @returns {Record<string,unknown>} */
function record(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Expected a plain data object.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) invalid('Unknown input field.');
  if (Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)) invalid('Accessors and nonenumerable fields are not plain data fields.');
  /** @type {Record<string,unknown>} */
  const plain = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) plain[key] = descriptor.value;
  return plain;
}
/** @param {unknown} value @param {number} maximum */
function text(value, maximum) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || !value.trim()) invalid('A text field is empty or too long.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value)) invalid('A text field contains unsupported characters.');
  return value.replace(/\r\n?/g, '\n');
}
/**
 * Validate explicit caller evidence. Skipped rows may omit scheduling fields;
 * every supplied field still validates. No application history is inferred.
 * @param {unknown} value @returns {Snapshot}
 */
export function parseSnapshot(value) {
  const root = record(value, ['asOf', 'through', 'chores']);
  const asOf = date(root.asOf), through = date(root.through);
  if (through.ordinal < asOf.ordinal || through.ordinal - asOf.ordinal > MAX_SPAN) invalid('The inclusive horizon must span zero to 3660 days.');
  if (!Array.isArray(root.chores) || root.chores.length > MAX_ROWS) invalid('Chores must be an array of at most 1000 rows.');
  const array = root.chores;
  if (Object.getPrototypeOf(array) !== Array.prototype) invalid('Chores must use a plain array.');
  if (Reflect.ownKeys(array).some(key => typeof key !== 'string' || (key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= array.length)))) invalid('Chores must be a plain dense array.');
  for (let index = 0; index < array.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid('Chores must be a dense array without accessors.');
  }
  const ids = new Set();
  /** @type {Chore[]} */
  const chores = [];
  for (let index = 0; index < array.length; index++) {
    const value = array[index];
    const row = record(value, rowKeys);
    const id = text(row.id, 128), title = text(row.title, 1000);
    if (/[\s]/u.test(id)) invalid('IDs cannot contain whitespace.');
    if (ids.has(id)) invalid('Duplicate chore ID.');
    ids.add(id);
    if (typeof row.enabled !== 'boolean') invalid('Every chore needs a Boolean enabled field.');
    if (!['outstanding', 'pending-approval', 'completed'].includes(/** @type {string} */ (row.state))) invalid('Every chore needs an explicit supported state.');
    if (row.nextDue !== undefined) date(row.nextDue);
    if (row.frequency !== undefined && !frequencies.includes(/** @type {string} */ (row.frequency))) invalid('Unsupported frequency.');
    if (row.customIntervalDays !== undefined && (typeof row.customIntervalDays !== 'number' || !Number.isInteger(row.customIntervalDays) || row.customIntervalDays < 1 || row.customIntervalDays > 365)) invalid('Custom intervals must be integers from 1 to 365.');
    if (row.customIntervalDays !== undefined && row.frequency !== 'custom') invalid('A custom interval requires custom frequency.');
    if (row.nextDueTime !== undefined && (typeof row.nextDueTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.nextDueTime))) invalid('Suggested time must use valid HH:mm.');
    if (row.noInterveningCompletion !== undefined && typeof row.noInterveningCompletion !== 'boolean') invalid('Completion attestation must be Boolean.');
    if (row.state !== 'outstanding' && row.noInterveningCompletion === true) invalid('Completion attestation contradicts the chore state.');
    if (row.enabled && row.state === 'outstanding') {
      if (row.noInterveningCompletion !== true) invalid('Outstanding work requires explicit noInterveningCompletion: true.');
      if (row.nextDue === undefined || row.frequency === undefined) invalid('Outstanding work requires nextDue and frequency.');
      if (row.frequency === 'custom' && row.customIntervalDays === undefined) invalid('Custom frequency requires an interval.');
      if (through.ordinal - Math.min(date(row.nextDue).ordinal, asOf.ordinal) > MAX_SPAN) invalid('Historical and future projection must fit within 3660 days.');
    }
    chores.push(/** @type {Chore} */ ({ ...row, id, title }));
  }
  chores.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { asOf: asOf.iso, through: through.iso, chores };
}
/** @param {Day} anchor @param {Chore} chore @param {number} index @returns {Day|null} */
function occurrence(anchor, chore, index) {
  const dayStep = chore.frequency === 'daily' ? 1 : chore.frequency === 'weekly' ? 7 : chore.frequency === 'biweekly' ? 14 : chore.frequency === 'custom' ? chore.customIntervalDays : undefined;
  if (dayStep !== undefined) return fromOrdinal(anchor.ordinal + index * dayStep);
  const months = chore.frequency === 'monthly' ? 1 : chore.frequency === 'quarterly' ? 3 : chore.frequency === 'semi-annually' ? 6 : 12;
  const target = (anchor.year - 1) * 12 + anchor.month - 1 + index * months;
  const year = Math.floor(target / 12) + 1, month = target % 12 + 1;
  return year > 9999 ? null : dayParts(year, month, Math.min(anchor.day, monthDays(year, month)));
}
/** @param {string} id @param {string} date */
function uid(id, date) { return `chore-${createHash('sha256').update(JSON.stringify([id, date])).digest('hex')}@prism.invalid`; }
/**
 * Rehearse proposed due-date semantics without changing any server state.
 * Dates equal to asOf are current; only earlier occurrences are missed.
 * @param {unknown} value @returns {Preview}
 */
export function previewChores(value) {
  const snapshot = parseSnapshot(value), asOf = date(snapshot.asOf), through = date(snapshot.through);
  /** @type {Preview} */
  const result = { schemaVersion: 1, semantics: 'proposed-due-date-preview', asOf: snapshot.asOf, through: snapshot.through, chores: [], skipped: [], totals: { missed: 0, current: 0, future: 0 } };
  let count = 0;
  for (const chore of snapshot.chores) {
    if (!chore.enabled || chore.state !== 'outstanding') {
      result.skipped.push({ id: chore.id, reason: !chore.enabled ? 'disabled' : chore.state });
      continue;
    }
    const anchor = date(chore.nextDue);
    /** @type {Projection} */
    const projection = { id: chore.id, title: chore.title, suggestedTime: chore.nextDueTime ?? null, firstNonexpiredDue: '', missed: [], current: [], future: [] };
    for (let index = 0; ; index++) {
      const due = occurrence(anchor, chore, index);
      if (!due) {
        if (!projection.firstNonexpiredDue) invalid('The next nonexpired occurrence exceeds year 9999.');
        break;
      }
      if (due.ordinal >= asOf.ordinal && !projection.firstNonexpiredDue) projection.firstNonexpiredDue = due.iso;
      if (due.ordinal > through.ordinal) break;
      if (++count > MAX_OCCURRENCES) invalid('Combined projection exceeds 10000 occurrences.');
      const entry = { date: due.iso, uid: uid(chore.id, due.iso) };
      if (due.ordinal < asOf.ordinal) {
        projection.missed.push({ ...entry, projectedPoints: 0 }); result.totals.missed++;
      } else {
        if (due.ordinal === MAX_DAY) invalid('An exported occurrence cannot end beyond year 9999.');
        if (due.ordinal === asOf.ordinal) { projection.current.push(entry); result.totals.current++; }
        else { projection.future.push(entry); result.totals.future++; }
      }
    }
    result.chores.push(projection);
  }
  return result;
}
/** @param {string} value */
function escapeText(value) { return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
/** @param {string} value */
function fold(value) {
  const lines = [];
  let current = '', octets = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, 'utf8');
    if (octets + size > 75) { lines.push(current); current = ' '; octets = 1; }
    current += char; octets += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}
/**
 * Export only current/future occurrences inside the inclusive horizon.
 * Expanded all-day events use deterministic stamps and no timezone inference.
 * @param {unknown} value @returns {string}
 */
export function renderCalendar(value) {
  const preview = previewChores(value);
  const entries = preview.chores.flatMap(chore => [...chore.current, ...chore.future].map(due => ({ chore, due })));
  if (entries.length === 0) invalid('No current or future occurrences to export; use JSON preview.');
  entries.sort((a, b) => a.due.date < b.due.date ? -1 : a.due.date > b.due.date ? 1 : a.chore.id < b.chore.id ? -1 : 1);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prism//Offline Chore Preview//EN', 'CALSCALE:GREGORIAN'];
  for (const { chore, due } of entries) {
    const end = fromOrdinal(date(due.date).ordinal + 1);
    if (!end) invalid('An exported occurrence cannot end beyond year 9999.');
    const description = `Offline preview of proposed chore due dates. No server state changed.${chore.suggestedTime ? ` Suggested time: ${chore.suggestedTime}; the entire due day stays open.` : ''}`;
    lines.push('BEGIN:VEVENT', `UID:${due.uid}`, 'DTSTAMP:20000101T000000Z', `DTSTART;VALUE=DATE:${due.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${end.iso.replace(/-/g, '')}`, `SUMMARY:${escapeText(chore.title)}`, `DESCRIPTION:${escapeText(description)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
const HELP = `Usage: node scripts/burn4-chore-anchor-preview.mjs --input snapshot.json [--format json|ics]

Preview proposed chore due-date recurrence from explicit local data.
Snapshot: {"asOf":"2026-10-21","through":"2026-10-28","chores":[...]}
Each row: id, title, enabled, state. Enabled outstanding rows also need
nextDue, frequency and noInterveningCompletion:true. Custom frequency needs
customIntervalDays (1..365). Optional nextDueTime is suggestive HH:mm only.
States: outstanding, pending-approval, completed. Disabled/pending/completed
rows are skipped; all supplied fields still validate. No history is inferred.
Limits: 1 MiB UTF-8 input, 1000 rows, 3660-day combined historical/future span
per active row, and 10000 total projected occurrences. Dates: 0001..9999.
JSON includes missed/current/future; ICS includes current/future only and
requires at least one occurrence. Empty ICS exports fail with exit 2.
Output goes to stdout. Redirect it explicitly to save a file.
This tool does not change server recurrence, points, archives or application UI.
`;
/** @param {string} path @returns {Promise<string>} */
async function readInput(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) invalid('Input must be a regular local file of at most 1 MiB.');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size <= MAX_BYTES) {
      const read = await handle.read(buffer, size, buffer.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > MAX_BYTES) invalid('Input exceeds 1 MiB.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)); }
    catch { return invalid('Input must be valid UTF-8.'); }
  } finally { await handle.close(); }
}
/** @param {number} descriptor @param {string} text @returns {Promise<void>} */
function writeOutput(descriptor, text) {
  const bytes = Buffer.from(text, 'utf8');
  let offset = 0;
  return new Promise((resolve, reject) => {
    function next() {
      if (offset === bytes.length) { resolve(); return; }
      write(descriptor, bytes, offset, bytes.length - offset, null, (error, written) => {
        if (error || written <= 0) { reject(error ?? new Error('Output unavailable')); return; }
        offset += written;
        next();
      });
    }
    next();
  });
}
/**
 * Run the explicit CLI. Returns 0 on success/help, 2 on a controlled failure.
 * Injected I/O is for local tests; the real CLI reads one bounded regular file.
 * @param {string[]} argv @param {CliIO} [io] @returns {Promise<number>}
 */
export async function runCli(argv, io = { readInput, stdout: text => writeOutput(1, text), stderr: text => writeOutput(2, text) }) {
  try {
    if (argv.length === 1 && argv[0] === '--help') { await io.stdout(HELP); return 0; }
    let input, format = 'json';
    const seen = new Set();
    for (let index = 0; index < argv.length; index += 2) {
      const option = argv[index], value = argv[index + 1];
      if (option !== '--input' && option !== '--format') invalid('Use --input and optional --format, or --help alone.');
      if (seen.has(option) || value === undefined || value.startsWith('--')) invalid('Duplicate option or missing option value.');
      seen.add(option);
      if (option === '--input') input = value; else format = value;
    }
    if (!input || (format !== 'json' && format !== 'ics')) invalid('A local input path and json or ics format are required.');
    const source = await io.readInput(input);
    if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) invalid('Input exceeds 1 MiB.');
    let snapshot;
    try { snapshot = JSON.parse(source); } catch { return invalid('Input is not valid JSON.'); }
    const output = format === 'json' ? JSON.stringify(previewChores(snapshot), null, 2) + '\n' : renderCalendar(snapshot);
    await io.stdout(output);
    return 0;
  } catch (error) {
    try { await io.stderr(`Chore preview: ${error instanceof InputError ? error.message : 'Unable to read or validate the local snapshot.'}\n`); } catch { /* A broken error sink cannot report diagnostics. */ }
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runCli(process.argv.slice(2));
}
