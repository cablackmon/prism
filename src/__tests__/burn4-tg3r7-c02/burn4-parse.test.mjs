import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWeekendScenario, suggestWeekend } from '../../../scripts/burn4-weekend-suggest.mjs';
import { freeze, place, scenario } from './burn4-helpers.mjs';

for (const date of ['0001-01-01', '0004-02-29', '0096-02-29', '0099-12-31', '0400-02-29', '1900-02-28', '2000-02-29', '2400-02-29', '9999-12-31']) {
  test(`Gregorian date preserves ${date}`, () => assert.equal(parseWeekendScenario(scenario({ date })).date, date));
}

for (const date of ['0000-01-01', '10000-01-01', '0100-02-29', '1900-02-29', '2100-02-29', '2024-02-30', '2024-04-31', '2024-00-01', '2024-13-01', '2024-01-00', '2024-1-01', '2024-01-01T00:00:00Z', ' 2024-01-01', '２０２４-01-01', 20240101]) {
  test(`Gregorian date rejects malformed case ${String(date).slice(0, 12)}`, () => assert.throws(() => parseWeekendScenario(scenario({ date })), /^Error: date:/));
}

test('parser normalizes all tag lists, trims IDs and names and fills explicit defaults', () => {
  const input = scenario({ places: [place({ id: ' ID ', name: ' Cafe ☕ ', tags: [' Outdoor ', 'OUTDOOR', 'Art'] })],
    preferences: { requiredTags: [' ART ', 'art'], preferredTags: ['OUTDOOR', ' outdoor '], seasonalTags: { summer: [' ART ', 'art'] } } });
  const parsed = parseWeekendScenario(freeze(input));
  assert.deepEqual(parsed, { date: '2024-06-01', hemisphere: 'north', weather: null,
    places: [{ id: 'ID', name: 'Cafe ☕', status: 'backlog', isFavorite: false, tags: ['outdoor', 'art'] }],
    preferences: { requiredTags: ['art'], excludedTags: [], preferredTags: ['outdoor'], seasonalTags: { spring: [], summer: ['art'], autumn: [], winter: [] }, status: 'all', limit: 3, preferFavorites: false, preferUnvisited: false } });
  assert.deepEqual(parseWeekendScenario(parsed), parsed);
});

test('trimmed duplicate IDs reject while different case IDs remain distinct', () => {
  assert.throws(() => parseWeekendScenario(scenario({ places: [place({ id: 'x' }), place({ id: ' x ' })] })), /places\[1\]\.id: duplicate/);
  assert.equal(parseWeekendScenario(scenario({ places: [place({ id: 'x' }), place({ id: 'X' })] })).places.length, 2);
});

test('raw string and array bounds apply before trimming and deduplication', () => {
  assert.equal(parseWeekendScenario(scenario({ places: [place({ id: 'x'.repeat(200), name: 'n'.repeat(500), tags: ['t'.repeat(80)] })] })).places[0]?.tags[0]?.length, 80);
  for (const overrides of [{ id: 'x'.repeat(201) }, { name: 'n'.repeat(501) }, { tags: ['t'.repeat(81)] }, { id: `${' '.repeat(200)}x` }, { tags: Array(51).fill('art') }]) {
    assert.throws(() => parseWeekendScenario(scenario({ places: [place(overrides)] })));
  }
  assert.equal(parseWeekendScenario(scenario({ places: [place({ tags: Array(50).fill(' Art ') })] })).places[0]?.tags.length, 1);
  assert.throws(() => parseWeekendScenario(scenario({ places: [place({ tags: ['İ'.repeat(80)] })] })), /normalized tag exceeds/);
});

test('place count bound accepts one thousand and rejects one thousand one', () => {
  const places = Array.from({ length: 1000 }, (_, index) => place({ id: `place-${index}` }));
  assert.equal(parseWeekendScenario(scenario({ places })).places.length, 1000);
  assert.throws(() => parseWeekendScenario(scenario({ places: [...places, place({ id: 'over' })] })), /places:/);
  assert.deepEqual(suggestWeekend(scenario({ places: [] })).suggestions, []);
});

for (const patch of [
  { hemisphere: 'east' }, { hemisphere: null }, { places: null }, { places: [{}] }, { places: [place({ status: 'all' })] },
  { places: [place({ name: ' ' })] }, { places: [place({ isFavorite: 1 })] }, { places: [place({ tags: [''] })] },
  { places: [place({ tags: [1] })] }, { weather: [] }, { weather: { temperatureC: '20', precipitation: false } },
  { weather: { temperatureC: NaN, precipitation: false } }, { weather: { temperatureC: Infinity, precipitation: false } },
  { weather: { temperatureC: -100.001, precipitation: false } }, { weather: { temperatureC: 100.001, precipitation: false } },
  { weather: { temperatureC: 20, precipitation: 0 } }, { preferences: null }, { preferences: [] },
  { preferences: { requiredTags: null } }, { preferences: { seasonalTags: null } }, { preferences: { seasonalTags: { winter: null } } },
  { preferences: { status: null } }, { preferences: { status: 'missing' } }, { preferences: { limit: null } },
  { preferences: { limit: 0 } }, { preferences: { limit: 21 } }, { preferences: { limit: 1.5 } }, { preferences: { limit: '3' } },
  { preferences: { preferFavorites: null } }, { preferences: { preferUnvisited: 'yes' } },
]) {
  test(`malformed scenario variant ${JSON.stringify(patch).slice(0, 85)}`, () => {
    assert.throws(() => parseWeekendScenario(scenario(patch)));
    assert.throws(() => suggestWeekend(scenario(patch)));
  });
}

test('root and missing fields reject without reading inherited data', () => {
  for (const root of [null, [], 'marker', 1, true, {}, Object.create(scenario())]) assert.throws(() => parseWeekendScenario(root));
  assert.throws(() => parseWeekendScenario({ ...scenario(), date: undefined }), /date:/);
});

test('own indexed arrays ignore custom iterators and reject missing, inherited or accessor data', () => {
  /** @type {unknown[]} */
  const array = [];
  Object.defineProperty(array, Symbol.iterator, { value: function* () { for (let index = 0; index < 1001; index += 1) yield place({ id: String(index) }); } });
  assert.equal(parseWeekendScenario(scenario({ places: array })).places.length, 0);
  const inherited = Array(1);
  Object.setPrototypeOf(inherited, { 0: place() });
  assert.throws(() => parseWeekendScenario(scenario({ places: inherited })), /places\[0\]:/);
  const accessor = [place()];
  let getterCalls = 0;
  Object.defineProperty(accessor, '0', { get() { getterCalls += 1; throw new Error('Do not expose marker'); } });
  assert.throws(() => parseWeekendScenario(scenario({ places: accessor })), /places\[0\]: expected a data field/);
  assert.equal(getterCalls, 0);
  assert.throws(() => parseWeekendScenario(scenario({ places: Array(1) })), /places\[0\]:/);
  const tagArray = ['art'];
  Object.defineProperty(tagArray, Symbol.iterator, { value: function* () { yield 'indoor'; } });
  assert.deepEqual(parseWeekendScenario(scenario({ places: [place({ tags: tagArray })] })).places[0]?.tags, ['art']);
  Object.defineProperty(tagArray, '0', { get() { getterCalls += 1; return 'outdoor'; } });
  assert.throws(() => parseWeekendScenario(scenario({ places: [place({ tags: tagArray })] })), /expected a data field/);
  assert.equal(getterCalls, 0);
});

test('known field getters reject without invocation; unknown metadata is never read', () => {
  let calls = 0;
  const input = scenario();
  Object.defineProperty(input, 'notes', { get() { calls += 1; throw new Error('marker'); } });
  assert.equal(parseWeekendScenario(input).places.length, 1);
  Object.defineProperty(input, 'date', { get() { calls += 1; throw new Error('marker'); } });
  assert.throws(() => parseWeekendScenario(input), /date: expected a data field/);
  assert.equal(calls, 0);
});

test('prototype-shaped metadata cannot influence defaults or output', () => {
  const input = JSON.parse('{"date":"2024-06-01","hemisphere":"north","places":[],"__proto__":{"limit":20},"preferences":{"constructor":{"status":"visited"},"__proto__":{"limit":20}}}');
  assert.equal(parseWeekendScenario(input).preferences.limit, 3);
  assert.deepEqual(suggestWeekend(input).suggestions, []);
});

test('all validation diagnostics with synthetic bad values are path-only', () => {
  const marker = 'UNRELATED_PRIVATE_MARKER';
  for (const patch of [{ date: marker }, { hemisphere: marker }, { places: [place({ status: marker })] }, { weather: { temperatureC: marker, precipitation: false } }, { preferences: { limit: marker } }]) {
    assert.throws(() => suggestWeekend(scenario(patch)), error => error instanceof Error && !error.message.includes(marker));
  }
  assert.throws(() => parseWeekendScenario(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(marker); } })), error => error instanceof Error && !error.message.includes(marker));
});
