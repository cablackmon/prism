import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWeekendScenario, suggestWeekend } from '../../../scripts/burn4-weekend-suggest.mjs';
import { freeze, place, scenario } from './burn4-helpers.mjs';

const pool = [
  place({ id: 'A', tags: ['outdoor', 'family', 'seasonal'] }),
  place({ id: 'B', tags: ['indoor', 'family'], status: 'visited', isFavorite: true }),
  place({ id: 'C', tags: ['indoor', 'outdoor', 'family'], isFavorite: true }),
  place({ id: 'D', tags: [] }),
];
const preferences = { preferredTags: ['family'], seasonalTags: { summer: ['seasonal'] }, preferFavorites: true, preferUnvisited: true, limit: 4 };

test('hand-ranked weather and hemisphere counterfactuals use independent expected scores', () => {
  const input = scenario({ places: pool, preferences, weather: { temperatureC: 20, precipitation: false } });
  assert.deepEqual(suggestWeekend(input).suggestions.map(item => [item.id, item.score]), [['A', 10], ['C', 7], ['B', 6], ['D', 1]]);
  assert.deepEqual(suggestWeekend({ ...input, weather: { temperatureC: 20, precipitation: true } }).suggestions.map(item => [item.id, item.score]), [['B', 8], ['C', 7], ['A', 6], ['D', 1]]);
  assert.deepEqual(suggestWeekend({ ...input, hemisphere: 'south' }).suggestions.map(item => [item.id, item.score]), [['A', 7], ['C', 7], ['B', 6], ['D', 1]]);
});

test('reason order and weights show every nonzero contribution exactly once', () => {
  const output = suggestWeekend(scenario({ places: [pool[0]], preferences, weather: { temperatureC: 20, precipitation: true } }));
  assert.deepEqual(output.suggestions[0]?.reasons, [
    { code: 'preferred-tag', weight: 4, tag: 'family' }, { code: 'seasonal-tag', weight: 3, tag: 'seasonal' },
    { code: 'unvisited', weight: 1 }, { code: 'outdoor-weather', weight: -2 },
  ]);
  for (const item of output.suggestions) assert.equal(item.score, item.reasons.reduce((sum, reason) => sum + reason.weight, 0));
  assert.equal(output.weather?.classification, 'adverse');
});

const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
const south = ['summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer'];
test('all months and meteorological boundary days use the explicit hemisphere', () => {
  for (let month = 1; month <= 12; month += 1) {
    const date = `2024-${String(month).padStart(2, '0')}-01`;
    assert.equal(suggestWeekend(scenario({ date })).season, north[month - 1]);
    assert.equal(suggestWeekend(scenario({ date, hemisphere: 'south' })).season, south[month - 1]);
  }
  for (const [date, expected] of [['2024-02-29', 'winter'], ['2024-05-31', 'spring'], ['2024-08-31', 'summer'], ['2024-11-30', 'autumn'], ['9999-12-31', 'winter'], ['0001-01-01', 'winter']]) {
    assert.equal(suggestWeekend(scenario({ date })).season, expected);
  }
});

for (const [temperatureC, precipitation, outdoor, indoor] of [
  [-100, false, -2, 2], [4.999, false, -2, 2], [5, false, 2, 0], [30, false, 2, 0], [30.001, false, -2, 2], [100, false, -2, 2], [20, true, -2, 2],
]) {
  test(`weather contribution at ${temperatureC} C precipitation ${precipitation}`, () => {
    const output = suggestWeekend(scenario({ weather: { temperatureC, precipitation }, places: [place({ id: 'out' }), place({ id: 'in', tags: ['indoor'] }), place({ id: 'mixed', tags: ['indoor', 'outdoor'] }), place({ id: 'unknown', tags: ['museum', 'food'] })], preferences: { limit: 4 } }));
    const scores = Object.fromEntries(output.suggestions.map(item => [item.id, item.score]));
    assert.deepEqual(scores, { out: outdoor, in: indoor, mixed: 0, unknown: 0 });
    assert.equal(output.eligibleCount, 4);
    for (const item of output.suggestions) {
      assert.equal(item.score, item.reasons.reduce((sum, reason) => sum + reason.weight, 0));
      assert.ok(item.reasons.every(reason => reason.weight !== 0));
    }
  });
}

test('missing or null weather adds no reason and does not assume venue exposure', () => {
  for (const weather of [undefined, null]) {
    const output = suggestWeekend(scenario({ weather }));
    assert.equal(output.weather, null);
    assert.equal(output.suggestions[0]?.score, 0);
    assert.deepEqual(output.suggestions[0]?.reasons, []);
  }
});

test('hard filters intersect all required tags, exclude any prohibited tag and enforce status', () => {
  const input = scenario({ places: pool, preferences: { requiredTags: ['family', 'indoor'], excludedTags: ['outdoor'], status: 'visited', limit: 20 } });
  const output = suggestWeekend(input);
  assert.deepEqual(output.suggestions.map(item => item.id), ['B']);
  assert.equal(output.consideredCount, 4);
  assert.equal(output.eligibleCount, 1);
  assert.deepEqual(suggestWeekend({ ...input, preferences: { requiredTags: ['missing'] } }).suggestions, []);
  assert.deepEqual(suggestWeekend({ ...input, preferences: { status: 'backlog' } }).suggestions.map(item => item.id), ['A', 'C', 'D']);
});

test('normalized required/excluded conflicts reject and hard exclusion wins over scoring preferences', () => {
  assert.throws(() => suggestWeekend(scenario({ preferences: { requiredTags: [' Art '], excludedTags: ['ART'] } })), /conflicts with excludedTags/);
  assert.deepEqual(suggestWeekend(scenario({ preferences: { preferredTags: ['outdoor'], excludedTags: ['outdoor'] } })).suggestions, []);
});

test('normalization prevents duplicate contributions while preferred and seasonal awards remain independent', () => {
  const output = suggestWeekend(scenario({ places: [place({ tags: [' ART ', 'art'] })], preferences: { preferredTags: ['art', 'ART'], seasonalTags: { summer: ['ART', ' Art '] } } }));
  assert.equal(output.suggestions[0]?.score, 7);
  assert.deepEqual(output.suggestions[0]?.reasons.map(reason => reason.code), ['preferred-tag', 'seasonal-tag']);
});

test('favorite and unvisited toggles contribute independently and are disabled by default', () => {
  const input = scenario({ places: [place({ isFavorite: true, tags: [] })] });
  assert.equal(suggestWeekend(input).suggestions[0]?.score, 0);
  assert.equal(suggestWeekend({ ...input, preferences: { preferFavorites: true } }).suggestions[0]?.score, 2);
  assert.equal(suggestWeekend({ ...input, preferences: { preferUnvisited: true } }).suggestions[0]?.score, 1);
  assert.equal(suggestWeekend({ ...input, preferences: { preferFavorites: true, preferUnvisited: true } }).suggestions[0]?.score, 3);
});

test('ties preserve input order after filtering, and limits apply after sorting without altering counts', () => {
  const places = Array.from({ length: 25 }, (_, index) => place({ id: String(index), tags: [], status: index === 0 ? 'visited' : 'backlog' }));
  for (const limit of [1, 20]) {
    const output = suggestWeekend(scenario({ places, preferences: { limit, status: 'backlog' } }));
    assert.equal(output.consideredCount, 25);
    assert.equal(output.eligibleCount, 24);
    assert.deepEqual(output.suggestions.map(item => item.id), places.slice(1, limit + 1).map(item => item.id));
  }
  assert.deepEqual(suggestWeekend(scenario({ places: places.slice(0, 3).reverse() })).suggestions.map(item => item.id), ['2', '1', '0']);
});

test('frozen inputs, normalized input, returned mutations and interleaved calls remain independent', async () => {
  const input = freeze(scenario({ places: pool, preferences }));
  const before = JSON.stringify(input);
  const parsed = freeze(parseWeekendScenario(input));
  const expected = JSON.stringify(suggestWeekend(parsed));
  const changed = suggestWeekend(input);
  changed.suggestions[0]?.tags.push('changed');
  changed.suggestions[0]?.reasons.push({ code: 'changed', weight: 999 });
  const outputs = await Promise.all([Promise.resolve().then(() => suggestWeekend(input)), Promise.resolve().then(() => suggestWeekend(scenario({ hemisphere: 'south' }))), Promise.resolve().then(() => suggestWeekend(parsed))]);
  assert.equal(JSON.stringify(outputs[0]), expected);
  assert.equal(JSON.stringify(outputs[2]), expected);
  assert.equal(JSON.stringify(input), before);
});

test('output uses exact key allowlists and preserves hostile text only as JSON data', () => {
  const marker = 'IGNORED_METADATA_MARKER';
  const name = '<script>"Quoted"\n雪</script>';
  const metadata = { notes: marker, address: marker, latitude: 1, longitude: 2, url: marker, description: marker, sourceId: marker, createdBy: { name: marker }, createdAt: marker };
  const result = suggestWeekend(scenario({ ...metadata, weather: { temperatureC: 20, precipitation: false, ...metadata }, preferences: { ...metadata }, places: [place({ ...metadata, name })] }));
  assert.deepEqual(Object.keys(result), ['date', 'hemisphere', 'season', 'weather', 'consideredCount', 'eligibleCount', 'suggestions']);
  assert.deepEqual(Object.keys(result.suggestions[0] ?? {}), ['id', 'name', 'status', 'isFavorite', 'tags', 'score', 'reasons']);
  assert.deepEqual(Object.keys(result.weather ?? {}), ['temperatureC', 'precipitation', 'classification']);
  assert.equal(result.suggestions[0]?.name, name);
  assert.ok(!JSON.stringify(result).includes(marker));
  assert.equal(JSON.parse(JSON.stringify(result)).suggestions[0].name, name);
});
