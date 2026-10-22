import { constants, writeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** @typedef {'spring' | 'summer' | 'autumn' | 'winter'} Season */
/** @typedef {'backlog' | 'visited'} Status */
/** @typedef {{temperatureC: number, precipitation: boolean}} Weather */
/** @typedef {{id: string, name: string, status: Status, isFavorite: boolean, tags: string[]}} Place */
/** @typedef {{requiredTags: string[], excludedTags: string[], preferredTags: string[], seasonalTags: Record<Season, string[]>, preferFavorites: boolean, preferUnvisited: boolean, status: Status | 'all', limit: number}} Preferences */
/** @typedef {{date: string, hemisphere: 'north' | 'south', weather: Weather | null, places: Place[], preferences: Preferences}} Scenario */
/** @typedef {{code: string, weight: number, tag?: string}} Reason */
/** @typedef {Place & {score: number, reasons: Reason[]}} Suggestion */
/** @typedef {{readFile(path: string, maxBytes: number): Promise<Uint8Array>, stdout(text: string): void | Promise<void>, stderr(text: string): void | Promise<void>}} CliIO */

const MAX_BYTES = 2 * 1024 * 1024;
/** @type {Season[]} */
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const USAGE = `Usage: node scripts/burn4-weekend-suggest.mjs <scenario.json>
       node scripts/burn4-weekend-suggest.mjs --help

Read one local regular UTF-8 JSON file, at most 2097152 bytes.
Provide date (YYYY-MM-DD), hemisphere (north or south), places and optional
weather/preferences. Output deterministic outing suggestions as JSON.
Weather is supplied by the caller. No network or database is used.
See src/__tests__/burn4-tg3r7-c02/burn4-README.md for the schema and example.
`;

class ScenarioError extends Error {}

/** @param {string} path @param {string} expectation @returns {never} */
function invalid(path, expectation) {
  throw new ScenarioError(`${path}: ${expectation}.`);
}

/** @param {unknown} value @param {string} path @returns {object} */
function object(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'expected an object');
  return value;
}

/** Read only own data fields. Unknown metadata and inherited values are ignored.
 * @param {object} record @param {string} key @param {string} path @returns {unknown}
 */
function field(record, key, path) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor && !Object.hasOwn(descriptor, 'value')) invalid(path, 'expected a data field');
  return descriptor?.value;
}

/** @param {unknown} value @param {string} path @param {number} max @returns {string} */
function text(value, path, max) {
  if (typeof value !== 'string' || value.length > max || !value.trim()) invalid(path, `expected nonblank text of at most ${max} UTF-16 code units`);
  return value.trim();
}

/** @param {unknown} value @param {string} path @param {boolean} [fallback] @returns {boolean} */
function boolean(value, path, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'boolean') invalid(path, 'expected a boolean');
  return value;
}

/** Copy bounded own indexed data without invoking a custom iterator or getter.
 * @param {unknown} value @param {string} path @param {number} max @returns {unknown[]}
 */
function entries(value, path, max) {
  if (!Array.isArray(value)) invalid(path, `expected an array of at most ${max} raw entries`);
  const length = field(value, 'length', path);
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > max) invalid(path, `expected an array of at most ${max} raw entries`);
  /** @type {unknown[]} */
  const copied = [];
  for (let index = 0; index < length; index += 1) copied.push(field(value, String(index), `${path}[${index}]`));
  return copied;
}

/** @param {unknown} value @param {string} path @returns {string[]} */
function tags(value, path) {
  const values = entries(value, path, 50);
  /** @type {string[]} */
  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < values.length; index += 1) {
    const tag = text(values[index], `${path}[${index}]`, 80).toLowerCase();
    if (tag.length > 80) invalid(`${path}[${index}]`, 'normalized tag exceeds 80 UTF-16 code units');
    if (!seen.has(tag)) { seen.add(tag); normalized.push(tag); }
  }
  return normalized;
}

/** Validate without Date, timezone conversion or two-digit-year adjustment.
 * @param {unknown} value @returns {string}
 */
function calendarDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) invalid('date', 'expected YYYY-MM-DD');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const length = lengths[month - 1];
  if (year < 1 || !length || day < 1 || day > length) invalid('date', 'expected a real Gregorian date in years 0001 through 9999');
  return value;
}

/** Validate and copy a JSON-like scenario. Errors contain schema paths, never values.
 * IDs and names trim; IDs retain case. Tags lowercase without locale dependence.
 * Raw string and array limits apply before normalization.
 * @param {unknown} input @returns {Scenario}
 */
export function parseWeekendScenario(input) {
  try {
    const root = object(input, 'scenario');
    const date = calendarDate(field(root, 'date', 'date'));
    const hemisphere = field(root, 'hemisphere', 'hemisphere');
    if (hemisphere !== 'north' && hemisphere !== 'south') invalid('hemisphere', 'expected north or south');
    const rawWeather = field(root, 'weather', 'weather');
    /** @type {Weather | null} */
    let weather = null;
    if (rawWeather !== undefined && rawWeather !== null) {
      const item = object(rawWeather, 'weather');
      const temperatureC = field(item, 'temperatureC', 'weather.temperatureC');
      if (typeof temperatureC !== 'number' || !Number.isFinite(temperatureC) || temperatureC < -100 || temperatureC > 100) invalid('weather.temperatureC', 'expected a finite number from -100 through 100');
      weather = { temperatureC, precipitation: boolean(field(item, 'precipitation', 'weather.precipitation'), 'weather.precipitation') };
    }
    const rawPlaces = entries(field(root, 'places', 'places'), 'places', 1000);
    const ids = new Set();
    const places = Array.from(rawPlaces, (value, index) => {
      const path = `places[${index}]`;
      const item = object(value, path);
      const id = text(field(item, 'id', `${path}.id`), `${path}.id`, 200);
      if (ids.has(id)) invalid(`${path}.id`, 'duplicate ID after trimming');
      ids.add(id);
      const name = text(field(item, 'name', `${path}.name`), `${path}.name`, 500);
      const status = field(item, 'status', `${path}.status`);
      if (status !== 'backlog' && status !== 'visited') invalid(`${path}.status`, 'expected backlog or visited');
      /** @type {Place} */
      const parsedPlace = { id, name, status, isFavorite: boolean(field(item, 'isFavorite', `${path}.isFavorite`), `${path}.isFavorite`), tags: tags(field(item, 'tags', `${path}.tags`), `${path}.tags`) };
      return parsedPlace;
    });
    const rawPreferences = field(root, 'preferences', 'preferences');
    const item = rawPreferences === undefined ? {} : object(rawPreferences, 'preferences');
    /** @param {string} key */
    const preferenceTags = key => {
      const raw = field(item, key, `preferences.${key}`);
      return tags(raw === undefined ? [] : raw, `preferences.${key}`);
    };
    const requiredTags = preferenceTags('requiredTags');
    const excludedTags = preferenceTags('excludedTags');
    const preferredTags = preferenceTags('preferredTags');
    if (requiredTags.some(tag => excludedTags.includes(tag))) invalid('preferences.requiredTags', 'conflicts with excludedTags');
    const rawSeasonal = field(item, 'seasonalTags', 'preferences.seasonalTags');
    const seasonal = rawSeasonal === undefined ? {} : object(rawSeasonal, 'preferences.seasonalTags');
    /** @param {Season} season */
    const seasonTags = season => {
      const path = `preferences.seasonalTags.${season}`;
      const raw = field(seasonal, season, path);
      return tags(raw === undefined ? [] : raw, path);
    };
    const seasonalTags = { spring: seasonTags('spring'), summer: seasonTags('summer'), autumn: seasonTags('autumn'), winter: seasonTags('winter') };
    const rawStatus = field(item, 'status', 'preferences.status');
    const status = rawStatus === undefined ? 'all' : rawStatus;
    if (status !== 'all' && status !== 'backlog' && status !== 'visited') invalid('preferences.status', 'expected all, backlog or visited');
    const rawLimit = field(item, 'limit', 'preferences.limit');
    const limit = rawLimit === undefined ? 3 : rawLimit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20) invalid('preferences.limit', 'expected an integer from 1 through 20');
    return { date, hemisphere, weather, places, preferences: { requiredTags, excludedTags, preferredTags, seasonalTags, status, limit,
      preferFavorites: boolean(field(item, 'preferFavorites', 'preferences.preferFavorites'), 'preferences.preferFavorites', false),
      preferUnvisited: boolean(field(item, 'preferUnvisited', 'preferences.preferUnvisited'), 'preferences.preferUnvisited', false) } };
  } catch (error) {
    if (error instanceof ScenarioError) throw error;
    throw new ScenarioError('scenario: expected JSON-compatible data fields.');
  }
}

/** Rank raw input or parser output. Both paths validate and copy; callers cannot
 * bypass validation by supplying a modified normalized object.
 * @param {unknown} input
 */
export function suggestWeekend(input) {
  const scenario = parseWeekendScenario(input);
  const month = Number(scenario.date.slice(5, 7));
  const northIndex = Math.floor((month + 9) % 12 / 3);
  const season = /** @type {Season} */ (SEASONS[(northIndex + (scenario.hemisphere === 'south' ? 2 : 0)) % 4]);
  const weather = scenario.weather === null ? null : { ...scenario.weather, classification: scenario.weather.precipitation || scenario.weather.temperatureC < 5 || scenario.weather.temperatureC > 30 ? 'adverse' : 'mild-dry' };
  const preferences = scenario.preferences;
  const eligible = scenario.places.filter(place =>
    (preferences.status === 'all' || place.status === preferences.status) &&
    preferences.requiredTags.every(tag => place.tags.includes(tag)) &&
    !preferences.excludedTags.some(tag => place.tags.includes(tag)));
  const ranked = eligible.map((place, index) => {
    /** @type {Reason[]} */
    const reasons = [];
    for (const tag of preferences.preferredTags) if (place.tags.includes(tag)) reasons.push({ code: 'preferred-tag', weight: 4, tag });
    for (const tag of preferences.seasonalTags[season]) if (place.tags.includes(tag)) reasons.push({ code: 'seasonal-tag', weight: 3, tag });
    if (preferences.preferFavorites && place.isFavorite) reasons.push({ code: 'favorite', weight: 2 });
    if (preferences.preferUnvisited && place.status === 'backlog') reasons.push({ code: 'unvisited', weight: 1 });
    const indoor = place.tags.includes('indoor');
    const outdoor = place.tags.includes('outdoor');
    if (weather && indoor !== outdoor) {
      if (weather.classification === 'adverse') reasons.push({ code: indoor ? 'indoor-weather' : 'outdoor-weather', weight: indoor ? 2 : -2 });
      else if (outdoor) reasons.push({ code: 'outdoor-weather', weight: 2 });
    }
    /** @type {Suggestion} */
    const suggestion = { ...place, score: reasons.reduce((score, reason) => score + reason.weight, 0), reasons };
    return { index, suggestion };
  });
  ranked.sort((left, right) => right.suggestion.score - left.suggestion.score || left.index - right.index);
  return { date: scenario.date, hemisphere: scenario.hemisphere, season, weather, consideredCount: scenario.places.length, eligibleCount: eligible.length,
    suggestions: ranked.slice(0, preferences.limit).map(item => item.suggestion) };
}

/** Open nonblocking, inspect the opened descriptor, then cap actual bytes read.
 * A stale size cannot cause an unbounded read. Symlinks to regular files work.
 * @param {string} path @param {number} maxBytes @returns {Promise<Uint8Array>}
 */
async function readInput(path, maxBytes) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Input file rejected');
    const bytes = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset > maxBytes) throw new Error('Input size rejected');
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}

/** @param {number} descriptor @param {string} text */
function writeOutput(descriptor, text) {
  const bytes = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written === 0) throw new Error('Output write failed');
    offset += written;
  }
}

/** @type {CliIO} */
const defaultIO = { readFile: readInput, stdout: text => writeOutput(1, text), stderr: text => writeOutput(2, text) };

/** @param {CliIO} io @param {string} text @param {boolean} failed */
async function emit(io, text, failed) {
  try {
    if (failed) await io.stderr(text); else await io.stdout(text);
    return failed ? 1 : 0;
  } catch {
    if (!failed) { try { await io.stderr('Unable to write output.\n'); } catch { /* Failure status survives an unavailable diagnostic stream. */ } }
    return 1;
  }
}

/** Run explicitly with injected I/O or bounded local-file defaults. Returns an
 * exit status instead of exiting the host. No read occurs on help/bad arguments.
 * @param {readonly string[]} args @param {CliIO} [io] @returns {Promise<number>}
 */
export async function runCli(args, io = defaultIO) {
  if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) return emit(io, 'Invalid arguments. Use --help.\n', true);
  if (args.length === 1 && args[0] === '--help') return emit(io, USAGE, false);
  const path = args[0];
  if (args.length !== 1 || !path || path.startsWith('-')) return emit(io, 'Expected one input file. Use --help.\n', true);
  let bytes;
  try {
    bytes = await io.readFile(path, MAX_BYTES);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) throw new Error('Input size rejected');
  } catch { return emit(io, 'Unable to read a regular input file within 2097152 bytes.\n', true); }
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return emit(io, 'Input must contain valid UTF-8 JSON.\n', true); }
  try { return await emit(io, `${JSON.stringify(suggestWeekend(input), null, 2)}\n`, false); }
  catch (error) { return emit(io, `${error instanceof ScenarioError ? error.message : 'Invalid scenario input.'}\n`, true); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runCli(process.argv.slice(2));
