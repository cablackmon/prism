import {
  locationDraft, parseLocationPlace, parseLocationPlaces, parseLocationResults, validateLocationDraft,
} from '../../app/weekend/locations/burn4-location-model';
import { first, second, suggestion } from './burn4-fixtures';

describe('saved place response boundary', () => {
  test('copies only the six location-view fields and preserves zero coordinates', () => {
    const input = { ...first, latitude: 0, longitude: 0, notes: 'unrelated data' };
    const parsed = parseLocationPlace(input);
    expect(parsed).toEqual({ ...first, latitude: 0, longitude: 0 });
    expect(parsed).not.toBe(input);
  });
  test('allows blank optional text and null or partially missing coordinates', () => {
    expect(parseLocationPlace({ ...second, latitude: 0, placeName: '', address: '' })).toEqual({ ...second, latitude: 0, placeName: '', address: '' });
  });
  test.each([
    null, [], 'place', 7, {}, { ...first, id: '' }, { ...first, id: 'a'.repeat(129) },
    { ...first, name: ' ' }, { ...first, name: 'a'.repeat(256) },
    { ...first, latitude: '1' }, { ...first, latitude: NaN }, { ...first, latitude: Infinity },
    { ...first, latitude: -90.01 }, { ...first, longitude: 180.01 },
    { ...first, placeName: undefined }, { ...first, placeName: 2 }, { ...first, placeName: 'a'.repeat(256) },
    { ...first, address: false }, { ...first, address: 'a'.repeat(501) },
  ])('rejects malformed saved place %#', (value) => expect(() => parseLocationPlace(value)).toThrow());
  test('accepts inclusive coordinate bounds without mutating input', () => {
    const input = Object.freeze({ ...first, latitude: -90, longitude: 180 });
    expect(parseLocationPlace(input)).toEqual(input);
  });
  test('list copies records and accepts an empty result', () => {
    expect(parseLocationPlaces({ places: [] })).toEqual([]);
    expect(parseLocationPlaces({ places: [first, second] })).toEqual([first, second]);
  });
  test.each([null, [], {}, { places: null }, { places: [first, null] }, { places: [first, first] }, { places: Array(2001).fill(first) }])('rejects malformed or unbounded list %#', (value) => expect(() => parseLocationPlaces(value)).toThrow());
});

describe('location search response boundary', () => {
  test('projects valid result fields with an explicit stable identifier', () => {
    expect(parseLocationResults({ results: [suggestion] })).toEqual([{ id: '17', displayName: suggestion.displayName, fullName: suggestion.fullName, latitude: 0, longitude: -12.5 }]);
    expect(parseLocationResults({ results: [] })).toEqual([]);
  });
  test.each([
    null, [], {}, { results: null }, { results: [null] }, { results: [suggestion, suggestion] },
    { results: Array(21).fill(suggestion) },
    ...[null, '1', NaN, Infinity, -91].map((latitude) => ({ results: [{ ...suggestion, latitude }] })),
    ...[null, '2', -181].map((longitude) => ({ results: [{ ...suggestion, longitude }] })),
    ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '17', undefined].map((placeId) => ({ results: [{ ...suggestion, placeId }] })),
    { results: [{ ...suggestion, displayName: '' }] },
    { results: [{ ...suggestion, fullName: 'a'.repeat(2001) }] },
  ])('rejects malformed or unbounded search response %#', (value) => expect(() => parseLocationResults(value)).toThrow());
});

describe('location drafts and location-only mutations', () => {
  test('creates fresh drafts with legitimate zeroes and empty null fields', () => {
    expect(locationDraft(second)).toEqual({ latitude: '', longitude: '', placeName: '', address: '' });
    expect(locationDraft({ ...first, latitude: 0, longitude: 0 })).toEqual({ latitude: '0', longitude: '0', placeName: first.placeName, address: first.address });
    expect(locationDraft(first)).not.toBe(locationDraft(first));
  });
  test('trims fields and emits exactly four patch properties', () => {
    const draft = Object.freeze({ latitude: ' +.5 ', longitude: ' -12.50 ', placeName: ' East ', address: ' Town ' });
    expect(validateLocationDraft(draft)).toEqual({ ok: true, patch: { latitude: .5, longitude: -12.5, placeName: 'East', address: 'Town' } });
  });
  test('blank coordinate pair clears coordinates while independently trimming optional text', () => {
    expect(validateLocationDraft({ latitude: ' ', longitude: '', placeName: '', address: ' Here ' })).toEqual({ ok: true, patch: { latitude: null, longitude: null, placeName: null, address: 'Here' } });
  });
  test.each([['0', '0'], ['-90', '180'], ['90', '-180'], ['.25', '-.5'], ['1.', '+12']])('accepts valid decimal pair %s %s', (latitude, longitude) => expect(validateLocationDraft({ ...locationDraft(second), latitude, longitude }).ok).toBe(true));
  test.each([
    ['', '1'], ['1', ''], ['91', '0'], ['-90.1', '0'], ['0', '181'], ['0', '-180.1'],
    ['NaN', '0'], ['Infinity', '0'], ['1e2', '0'], ['0x10', '0'], ['1,2', '0'], ['-', '0'],
    ['1 2', '0'], ['1'.repeat(33), '0'],
  ])('rejects invalid decimal pair %s %s', (latitude, longitude) => expect(validateLocationDraft({ ...locationDraft(second), latitude, longitude }).ok).toBe(false));
  test.each([{ placeName: 'a'.repeat(256) }, { address: 'a'.repeat(501) }])('rejects overlong draft text %#', (changes) => expect(validateLocationDraft({ ...locationDraft(second), ...changes }).ok).toBe(false));
});
