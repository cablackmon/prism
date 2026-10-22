import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { URL } from 'node:url';
import { groupPhotosByTrip, PHOTO_TRIP_LIMITS, runPhotoTripCli } from '../../../scripts/burn4-photo-trip-group.mjs';

/** @typedef {Record<string, unknown>} Row */
/** @typedef {{id: string, name: string, pins: Row[]}} FixtureTrip */

/** @param {string} [id] @param {number} [latitude] @param {number} [longitude] */
function photo(id = 'photo-a', latitude = 0, longitude = 0) {
  return { id, latitude, longitude };
}

/** @param {string} [id] @param {number} [latitude] @param {number} [longitude] */
function pin(id = 'pin-a', latitude = 0, longitude = 0) {
  return { id, latitude, longitude };
}

/** @param {string} [id] @param {Row[]} [pins] @returns {FixtureTrip} */
function trip(id = 'trip-a', pins = [pin()]) {
  return { id, name: 'Example trip', pins };
}

/** @param {Row[]} [photos] @param {FixtureTrip[]} [trips] */
function fixture(photos = [photo()], trips = [trip()]) {
  return { schemaVersion: 1, photos, trips };
}

/** @param {ReturnType<typeof groupPhotosByTrip>} result @param {string} [id] */
function group(result, id = 'trip-a') {
  const found = result.groups.find((candidate) => candidate.tripId === id);
  assert.ok(found, 'expected trip group');
  return found;
}

/** @param {Uint8Array[]} chunks @param {readonly string[]} [args] */
async function invokeChunks(chunks, args = []) {
  /** @type {string[]} */
  const output = [];
  /** @type {string[]} */
  const errors = [];
  const code = await runPhotoTripCli({
    input: (async function* () { yield* chunks; })(),
    writeOutput: (text) => { output.push(text); },
    writeError: (text) => { errors.push(text); },
  }, args);
  return { code, stdout: output.join(''), stderr: errors.join('') };
}

/** @param {string} text @param {readonly string[]} [args] */
function invoke(text, args = []) {
  return invokeChunks([Buffer.from(text)], args);
}

/** @param {string} input @param {string[]} [args] */
function executable(input, args = []) {
  return spawnSync(process.execPath, [new URL('../../../scripts/burn4-photo-trip-group.mjs', import.meta.url).pathname, ...args], {
    input, encoding: 'utf8', env: {}, timeout: 5000, maxBuffer: 1024 * 1024,
  });
}

test('whole-trip manifest includes one zero-distance photo and no ungrouped entries', () => {
  assert.deepEqual(groupPhotosByTrip(fixture()), {
    schemaVersion: 1,
    radiusKm: 50,
    groups: [{ tripId: 'trip-a', name: 'Example trip', photos: [{ photoId: 'photo-a', matchedPins: [{ pinId: 'pin-a', distanceKm: 0 }] }] }],
    overlaps: [], ungrouped: [],
  });
});

test('whole-trip album includes photos at different stops and deduplicates matching pins', () => {
  const result = groupPhotosByTrip(fixture([photo('near-second', 10, 20), photo('near-first')], [
    trip('trip-a', [pin('z-first'), pin('a-first', 0, 0.1), pin('second', 10, 20)]),
  ]));
  assert.deepEqual(group(result).photos.map((item) => item.photoId), ['near-first', 'near-second']);
  assert.deepEqual(group(result).photos[0]?.matchedPins, [
    { pinId: 'a-first', distanceKm: 11.119493 }, { pinId: 'z-first', distanceKm: 0 },
  ]);
  assert.deepEqual(group(result).photos[1]?.matchedPins, [{ pinId: 'second', distanceKm: 0 }]);
});

test('all overlapping trips remain albums even when one pin is closer', () => {
  const result = groupPhotosByTrip(fixture([photo()], [trip('trip-z', [pin('same-pin', 0, 0.1)]), trip('trip-a', [pin('same-pin')])]));
  assert.deepEqual(result.groups.map((item) => [item.tripId, item.photos.map((p) => p.photoId)]), [
    ['trip-a', ['photo-a']], ['trip-z', ['photo-a']],
  ]);
  assert.deepEqual(result.overlaps, [{ photoId: 'photo-a', tripIds: ['trip-a', 'trip-z'] }]);
});

test('identical display names keep distinct trip IDs and empty requested albums', () => {
  const result = groupPhotosByTrip(fixture([photo()], [trip('empty', [pin('far', 80, 100)]), trip('matched')]));
  assert.deepEqual(result.groups.map((item) => [item.tripId, item.name, item.photos.length]), [
    ['empty', 'Example trip', 0], ['matched', 'Example trip', 1],
  ]);
});

test('nearby-looking names and paths do not assign far photos', () => {
  const result = groupPhotosByTrip(fixture([{ ...photo('far', 40, 100), name: 'Example trip', path: 'trip-a/photo.jpg' }]));
  assert.deepEqual(result.ungrouped, [{ photoId: 'far', reason: 'no-nearby-trip' }]);
  assert.deepEqual(group(result).photos, []);
});

/** @type {[string, Row][]} */
const missingGps = [
  ['both absent', {}], ['both null', { latitude: null, longitude: null }],
  ['latitude absent', { longitude: 0 }], ['longitude absent', { latitude: 0 }],
  ['one null', { latitude: null, longitude: 0 }], ['undefined', { latitude: undefined, longitude: 0 }],
];
for (const [label, metadata] of missingGps) {
  test(`missing GPS: ${label}`, () => {
    const result = groupPhotosByTrip(fixture([{ id: 'missing', ...metadata }]));
    assert.deepEqual(result.ungrouped, [{ photoId: 'missing', reason: 'missing-gps' }]);
    assert.deepEqual(group(result).photos, []);
  });
}

/** @type {[string, unknown, unknown][]} */
const invalidGps = [
  ['numeric string', '0', 0], ['boolean', 0, false], ['object', {}, 0], ['NaN', NaN, 0],
  ['infinite', 0, Infinity], ['latitude high', 90.0001, 0], ['latitude low', -90.0001, 0],
  ['longitude high', 0, 180.0001], ['longitude low', 0, -180.0001],
];
for (const [label, latitude, longitude] of invalidGps) {
  test(`invalid photo GPS: ${label}`, () => {
    const result = groupPhotosByTrip(fixture([{ id: 'invalid', latitude, longitude }]));
    assert.deepEqual(result.ungrouped, [{ photoId: 'invalid', reason: 'invalid-gps' }]);
  });
}

test('missing GPS takes precedence over malformed remaining coordinate', () => {
  assert.deepEqual(groupPhotosByTrip(fixture([{ id: 'partial', latitude: null, longitude: 'wrong' }])).ungrouped,
    [{ photoId: 'partial', reason: 'missing-gps' }]);
});

test('zero coordinates are valid GPS and radius zero allows exact location', () => {
  assert.equal(group(groupPhotosByTrip({ ...fixture(), radiusKm: 0 })).photos.length, 1);
});

test('negative zero radius produces canonical positive zero', () => {
  assert.equal(Object.is(groupPhotosByTrip({ ...fixture(), radiusKm: -0 }).radiusKm, -0), false);
});

test('capture timestamps and other unused metadata do not influence membership or output', () => {
  const baseline = groupPhotosByTrip(fixture());
  for (const capturedAt of [undefined, null, '2026-01-01T00:00:00Z', '1999-04-03', 'malformed']) {
    const input = fixture([{ ...photo(), capturedAt, sourcePriority: 3, width: 100, tags: ['screensaver'] }]);
    assert.deepEqual(groupPhotosByTrip(input), baseline);
  }
});

test('capture time cannot rescue a photo without GPS', () => {
  const result = groupPhotosByTrip(fixture([{ id: 'dated', capturedAt: '2026-01-01T00:00:00Z' }]));
  assert.deepEqual(result.ungrouped, [{ photoId: 'dated', reason: 'missing-gps' }]);
});

test('repeat visits with unrelated dates retain geographic ambiguity', () => {
  const trips = [
    { ...trip('old'), startDate: '2000-01-01', endDate: '2000-01-02' },
    { ...trip('new'), startDate: '2026-01-01', endDate: '2026-01-02' },
  ];
  const result = groupPhotosByTrip(fixture([{ ...photo(), capturedAt: '2026-01-01T12:00:00Z' }], trips));
  assert.deepEqual(result.overlaps, [{ photoId: 'photo-a', tripIds: ['new', 'old'] }]);
});

test('default 50 km radius includes inside photo and excludes outside photo', () => {
  const result = groupPhotosByTrip(fixture([photo('inside', 0, 0.4), photo('outside', 0, 0.5)]));
  assert.deepEqual(group(result).photos, [{ photoId: 'inside', matchedPins: [{ pinId: 'pin-a', distanceKm: 44.477971 }] }]);
  assert.deepEqual(result.ungrouped, [{ photoId: 'outside', reason: 'no-nearby-trip' }]);
});

test('explicit radius override changes only the deliberate geographic threshold', () => {
  const result = groupPhotosByTrip({ ...fixture([photo('outside-default', 0, 0.5)]), radiusKm: 60 });
  assert.equal(result.radiusKm, 60);
  assert.equal(group(result).photos.length, 1);
});

test('radius equality is inclusive, smaller threshold excludes same position', () => {
  // Quarter circumference has a known spherical distance without repeating Haversine.
  const radiusKm = Math.PI * 6371 / 2;
  const input = fixture([photo('quarter', 0, 90)]);
  assert.equal(group(groupPhotosByTrip({ ...input, radiusKm })).photos.length, 1);
  assert.equal(group(groupPhotosByTrip({ ...input, radiusKm: radiusKm + 0.000001 })).photos.length, 1);
  assert.deepEqual(groupPhotosByTrip({ ...input, radiusKm: radiusKm - 0.000001 }).ungrouped,
    [{ photoId: 'quarter', reason: 'no-nearby-trip' }]);
});

test('rounded displayed distance does not decide membership', () => {
  const quarter = Math.PI * 6371 / 2;
  const rounded = Number(quarter.toFixed(6));
  assert.ok(rounded < quarter);
  const input = fixture([photo('quarter', 0, 90)]);
  assert.deepEqual(groupPhotosByTrip({ ...input, radiusKm: rounded }).ungrouped,
    [{ photoId: 'quarter', reason: 'no-nearby-trip' }]);
  assert.deepEqual(group(groupPhotosByTrip({ ...input, radiusKm: quarter })).photos[0]?.matchedPins,
    [{ pinId: 'pin-a', distanceKm: rounded }]);
});

test('antimeridian neighbors match by short spherical distance', () => {
  const result = groupPhotosByTrip(fixture([photo('date-line', 0, 179.9)], [trip('trip-a', [pin('other-side', 0, -179.9)])]));
  assert.deepEqual(group(result).photos[0]?.matchedPins, [{ pinId: 'other-side', distanceKm: 22.238985 }]);
});

test('equivalent antimeridian endpoints and polar longitudes match at zero radius', () => {
  const input = fixture([photo('date-line', 0, 180), photo('pole', 90, 100)], [trip('trip-a', [pin('wrap', 0, -180), pin('north', 90, -50)])]);
  const result = groupPhotosByTrip({ ...input, radiusKm: 0 });
  assert.deepEqual(group(result).photos, [
    { photoId: 'date-line', matchedPins: [{ pinId: 'wrap', distanceKm: 0 }] },
    { photoId: 'pole', matchedPins: [{ pinId: 'north', distanceKm: 0 }] },
  ]);
});

test('valid polar and nearly antipodal coordinates produce finite evidence', () => {
  const input = fixture([photo('south', -90, 180), photo('almost-opposite', -0.000001, 179.999999)], [trip('trip-a', [pin('origin'), pin('north', 90, -180)])]);
  const result = groupPhotosByTrip({ ...input, radiusKm: 21000 });
  assert.equal(group(result).photos.length, 2);
  for (const item of group(result).photos) {
    assert.equal(item.matchedPins.length, 2);
    for (const match of item.matchedPins) assert.ok(Number.isFinite(match.distanceKm) && match.distanceKm >= 0 && match.distanceKm <= Math.PI * 6371);
  }
});

test('empty photo and trip collections have complete deterministic outputs', () => {
  assert.deepEqual(groupPhotosByTrip(fixture([], [])), { schemaVersion: 1, radiusKm: 50, groups: [], overlaps: [], ungrouped: [] });
  assert.deepEqual(groupPhotosByTrip(fixture([], [trip('empty')])).groups, [{ tripId: 'empty', name: 'Example trip', photos: [] }]);
  assert.deepEqual(groupPhotosByTrip(fixture([photo()], [])).ungrouped, [{ photoId: 'photo-a', reason: 'no-nearby-trip' }]);
});

test('input permutation and locale-sensitive-looking IDs produce canonical ID order', () => {
  const photos = [photo('ä'), photo('z'), photo('A'), { id: 'unmatched-z' }, { id: 'unmatched-a' }];
  const trips = [trip('ä', [pin('z'), pin('A')]), trip('z', [pin('z'), pin('A')])];
  const forward = groupPhotosByTrip(fixture(photos, trips));
  const reversed = groupPhotosByTrip(fixture([...photos].reverse(), [...trips].reverse().map((t) => ({ ...t, pins: [...t.pins].reverse() }))));
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward.groups.map((item) => item.tripId), ['z', 'ä']);
  assert.deepEqual(forward.groups[0]?.photos.map((item) => item.photoId), ['A', 'z', 'ä']);
  assert.deepEqual(forward.overlaps.map((item) => item.photoId), ['A', 'z', 'ä']);
  assert.deepEqual(forward.ungrouped.map((item) => item.photoId), ['unmatched-a', 'unmatched-z']);
});

test('deeply frozen caller input is neither mutated nor reused for output', () => {
  const p = Object.freeze(photo());
  const anchor = Object.freeze(pin());
  const t = Object.freeze({ ...trip(), pins: Object.freeze([anchor]) });
  const input = Object.freeze({ schemaVersion: 1, photos: Object.freeze([p]), trips: Object.freeze([t]) });
  const result = groupPhotosByTrip(input);
  assert.equal(group(result).photos.length, 1);
  group(result).photos.length = 0;
  assert.equal(input.photos.length, 1);
  assert.equal(input.trips[0]?.pins.length, 1);
});

/** @type {[string, unknown, RegExp][]} */
const invalidInputs = [
  ['null root', null, /input must be an object/],
  ['array root', [], /input must be an object/],
  ['missing version', { photos: [], trips: [] }, /schemaVersion must be 1/],
  ['unsupported version', { ...fixture(), schemaVersion: 2 }, /schemaVersion must be 1/],
  ['photos not array', { ...fixture(), photos: {} }, /photos must be an array/],
  ['trips not array', { ...fixture(), trips: null }, /trips must be an array/],
  ['photo not object', { ...fixture(), photos: [null] }, /photos\[0\] must be an object/],
  ['blank photo ID', fixture([{ id: '  ' }]), /photos\[0\].id must be a nonempty string/],
  ['numeric photo ID', fixture([{ id: 1 }]), /photos\[0\].id must be a nonempty string/],
  ['duplicate photo ID', fixture([photo(), photo()]), /photos\[1\].id must be unique/],
  ['trip not object', { ...fixture(), trips: [false] }, /trips\[0\] must be an object/],
  ['missing trip ID', { ...fixture(), trips: [{ name: 'name', pins: [] }] }, /trips\[0\].id must be a nonempty string/],
  ['duplicate trip ID', fixture([], [trip(), trip()]), /trips\[1\].id must be unique/],
  ['invalid name', { ...fixture(), trips: [{ ...trip(), name: 1 }] }, /name must be a string/],
  ['pins not array', { ...fixture(), trips: [{ ...trip(), pins: null }] }, /pins must be an array/],
  ['pin not object', { ...fixture(), trips: [{ ...trip(), pins: [null] }] }, /pins\[0\] must be an object/],
  ['missing pin ID', fixture([], [trip('trip-a', [{ latitude: 0, longitude: 0 }])]), /pins\[0\].id must be a nonempty string/],
  ['duplicate pin ID', fixture([], [trip('trip-a', [pin(), pin()])]), /pins\[1\].id must be unique/],
  ['missing pin GPS', fixture([], [trip('trip-a', [{ id: 'pin' }])]), /valid GPS coordinates/],
  ['invalid pin GPS', fixture([], [trip('trip-a', [pin('pin', 91, 0)])]), /valid GPS coordinates/],
];
for (const [label, value, pattern] of invalidInputs) {
  test(`structural validation: ${label}`, () => { assert.throws(() => groupPhotosByTrip(value), pattern); });
}

for (const radiusKm of [-1, NaN, Infinity, '50', null]) {
  test(`invalid radius rejected: ${String(radiusKm)}`, () => {
    assert.throws(() => groupPhotosByTrip({ ...fixture(), radiusKm }), /radiusKm must be a finite nonnegative number/);
  });
}

test('sparse array elements fail structural validation rather than disappear', () => {
  assert.throws(() => groupPhotosByTrip({ ...fixture(), photos: new Array(1) }), /photos\[0\] must be an object/);
});

test('photo count overflow fails before duplicate or GPS processing', () => {
  assert.throws(() => groupPhotosByTrip({ ...fixture(), photos: new Array(PHOTO_TRIP_LIMITS.photos + 1) }), /photos exceeds the count limit/);
});

test('trip count overflow fails before inspecting trip entries', () => {
  assert.throws(() => groupPhotosByTrip({ ...fixture(), trips: new Array(PHOTO_TRIP_LIMITS.trips + 1) }), /trips exceeds the count limit/);
});

test('aggregate pin count overflow spans multiple trips', () => {
  const pins = Array.from({ length: PHOTO_TRIP_LIMITS.pins }, (_, index) => pin(`pin-${index}`));
  assert.throws(() => groupPhotosByTrip(fixture([], [trip('a', pins), trip('b')])), /pins exceeds the total count limit/);
});

test('comparison work overflow is rejected before photos are inspected or matched', () => {
  const pins = Array.from({ length: 1000 }, (_, index) => pin(`pin-${index}`));
  assert.throws(() => groupPhotosByTrip({ ...fixture([], [trip('a', pins)]), photos: new Array(10001) }), /comparison limit/);
});

test('individual count limits are inclusive when matching work is empty', () => {
  const photos = Array.from({ length: PHOTO_TRIP_LIMITS.photos }, (_, index) => ({ id: `photo-${index}` }));
  assert.equal(groupPhotosByTrip(fixture(photos, [])).ungrouped.length, PHOTO_TRIP_LIMITS.photos);
  const trips = Array.from({ length: PHOTO_TRIP_LIMITS.trips }, (_, index) => trip(`trip-${index}`, []));
  assert.equal(groupPhotosByTrip(fixture([], trips)).groups.length, PHOTO_TRIP_LIMITS.trips);
  const pins = Array.from({ length: PHOTO_TRIP_LIMITS.pins }, (_, index) => pin(`pin-${index}`));
  assert.equal(groupPhotosByTrip(fixture([], [trip('a', pins)])).groups.length, 1);
});

test('repeated long pin evidence is rejected during bounded accumulation', () => {
  const pins = Array.from({ length: 300 }, (_, index) => pin(`pin-${index}-${'x'.repeat(800)}`));
  const photos = Array.from({ length: 200 }, (_, index) => photo(`photo-${index}`));
  const input = fixture(photos, [trip('trip-a', pins)]);
  assert.ok(Buffer.byteLength(JSON.stringify(input)) < 300000);
  assert.ok(photos.length * pins.length < PHOTO_TRIP_LIMITS.comparisons);
  assert.throws(() => groupPhotosByTrip(input), /manifest exceeds the conservative output byte budget/);
});

test('CLI output-budget failure has controlled status and no partial manifest', async () => {
  const pins = Array.from({ length: 300 }, (_, index) => pin(`pin-${index}-${'x'.repeat(800)}`));
  const photos = Array.from({ length: 200 }, (_, index) => photo(`photo-${index}`));
  const result = await invoke(JSON.stringify(fixture(photos, [trip('trip-a', pins)])));
  assert.deepEqual(result, {
    code: 1, stdout: '', stderr: 'photo-trip-group: manifest exceeds the conservative output byte budget.\n',
  });
});

test('overlap trip-ID expansion is included in the manifest budget', () => {
  const trips = Array.from({ length: 20 }, (_, index) => trip(`trip-${index}-${'x'.repeat(9000)}`));
  const photos = Array.from({ length: 200 }, (_, index) => photo(`photo-${index}`));
  assert.throws(() => groupPhotosByTrip(fixture(photos, trips)), /conservative output byte budget/);
});

test('large group labels and ungrouped IDs are budgeted without serializing the result', () => {
  const name = 'x'.repeat(Math.floor(PHOTO_TRIP_LIMITS.manifestBytes / 6) + 1);
  assert.throws(() => groupPhotosByTrip(fixture([], [{ ...trip(), name }])), /conservative output byte budget/);
  const photos = Array.from({ length: 200 }, (_, index) => ({ id: `photo-${index}-${'x'.repeat(30000)}` }));
  assert.throws(() => groupPhotosByTrip(fixture(photos, [])), /conservative output byte budget/);
});

test('CLI writes exactly one deterministic JSON value and trailing newline', async () => {
  const result = await invoke(JSON.stringify(fixture()));
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(groupPhotosByTrip(fixture()), null, 2)}\n`);
});

test('CLI preserves multibyte Unicode split across input byte chunks', async () => {
  const input = Buffer.from(JSON.stringify(fixture([photo('é')])));
  const position = input.indexOf(Buffer.from('é')) + 1;
  const result = await invokeChunks([input.subarray(0, position), input.subarray(position)]);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), groupPhotosByTrip(fixture([photo('é')])));
});

for (const input of ['', '{', '{} {}', '{"unused":"do-not-echo",']) {
  test(`CLI malformed JSON is nonzero and sanitized: ${input.length} bytes`, async () => {
    const result = await invoke(input);
    assert.deepEqual(result, { code: 1, stdout: '', stderr: 'photo-trip-group: input must be one valid UTF-8 JSON value.\n' });
  });
}

test('CLI rejects malformed UTF-8 instead of replacement-character data', async () => {
  const result = await invokeChunks([Buffer.from([0xff])]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /valid UTF-8 JSON/);
});

test('CLI shape errors are nonzero and do not echo supplied values', async () => {
  const result = await invoke('{"schemaVersion":"do-not-echo","photos":[],"trips":[]}');
  assert.deepEqual(result, { code: 1, stdout: '', stderr: 'photo-trip-group: schemaVersion must be 1.\n' });
});

test('CLI permits exactly the UTF-8 byte limit with valid trailing whitespace', async () => {
  const input = JSON.stringify(fixture([], [])).padEnd(PHOTO_TRIP_LIMITS.inputBytes, ' ');
  const result = await invoke(input);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), groupPhotosByTrip(fixture([], [])));
});

test('CLI byte overflow stops its iterator and produces no partial manifest', async () => {
  let closed = false;
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const output = [];
  async function* input() {
    try {
      yield Buffer.alloc(PHOTO_TRIP_LIMITS.inputBytes, 0x20);
      yield Buffer.from(' ');
      assert.fail('CLI consumed input after the cap');
    } finally {
      closed = true;
    }
  }
  const code = await runPhotoTripCli({ input: input(), writeOutput: (text) => { output.push(text); }, writeError: (text) => { errors.push(text); } });
  assert.equal(code, 1);
  assert.equal(closed, true);
  assert.deepEqual(output, []);
  assert.deepEqual(errors, ['photo-trip-group: input exceeds the byte limit.\n']);
});

test('CLI ignores empty input fragments while preserving the valid JSON bytes', async () => {
  const empty = new Uint8Array(0);
  const result = await invokeChunks([
    ...Array.from({ length: 512 }, () => empty),
    Buffer.from(JSON.stringify(fixture())),
    ...Array.from({ length: 512 }, () => empty),
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), groupPhotosByTrip(fixture()));
});

test('CLI chunk work overflow is bounded even when every fragment is empty', async () => {
  let closed = false;
  let reads = 0;
  /** @type {string[]} */
  const output = [];
  /** @type {string[]} */
  const errors = [];
  const empty = new Uint8Array(0);
  async function* input() {
    try {
      for (let index = 0; index <= PHOTO_TRIP_LIMITS.inputChunks; index += 1) {
        reads += 1;
        yield empty;
      }
      assert.fail('reader consumed beyond the declared chunk cap');
      yield Buffer.from(JSON.stringify(fixture()));
    } finally {
      closed = true;
    }
  }
  const code = await runPhotoTripCli({ input: input(), writeOutput: (text) => { output.push(text); }, writeError: (text) => { errors.push(text); } });
  assert.equal(code, 1);
  assert.equal(closed, true);
  assert.equal(reads, PHOTO_TRIP_LIMITS.inputChunks + 1);
  assert.deepEqual(output, []);
  assert.deepEqual(errors, ['photo-trip-group: input exceeds the chunk limit.\n']);
});

test('CLI permits the exact chunk cap using tiny nonempty fragments', async () => {
  const bytes = Buffer.from(JSON.stringify(fixture([], [])).padEnd(PHOTO_TRIP_LIMITS.inputChunks, ' '));
  /** @type {string[]} */
  const output = [];
  /** @type {string[]} */
  const errors = [];
  const code = await runPhotoTripCli({
    input: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
    writeOutput: (text) => { output.push(text); },
    writeError: (text) => { errors.push(text); },
  });
  assert.equal(code, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(JSON.parse(output.join('')), groupPhotosByTrip(fixture([], [])));
});

test('CLI read failures report generic error without underlying details', async () => {
  /** @type {string[]} */
  const errors = [];
  const code = await runPhotoTripCli({
    input: (async function* () { yield Buffer.from(' '); throw new Error('internal read details'); })(),
    writeOutput: () => { assert.fail('unexpected output'); },
    writeError: (text) => { errors.push(text); },
  });
  assert.equal(code, 1);
  assert.deepEqual(errors, ['photo-trip-group: unable to read or write planner input/output.\n']);
});

test('CLI help and unsupported arguments do not read stdin', async () => {
  let reads = 0;
  /** @type {string[]} */
  const output = [];
  /** @type {string[]} */
  const errors = [];
  const io = {
    input: (async function* () { reads += 1; yield Buffer.from('not JSON'); })(),
    /** @param {string} text */
    writeOutput: (text) => { output.push(text); },
    /** @param {string} text */
    writeError: (text) => { errors.push(text); },
  };
  assert.equal(await runPhotoTripCli(io, ['--help']), 0);
  assert.match(output.join(''), /Usage:/);
  assert.deepEqual(errors, []);
  output.length = 0;
  assert.equal(await runPhotoTripCli(io, ['--radius', '10']), 1);
  assert.deepEqual(output, []);
  assert.match(errors.join(''), /unsupported arguments/);
  assert.equal(reads, 0);
});

test('CLI writer failures return nonzero without leaking underlying details', async () => {
  /** @type {string[]} */
  const errors = [];
  const code = await runPhotoTripCli({
    input: (async function* () { yield Buffer.from(JSON.stringify(fixture())); })(),
    writeOutput: () => { throw new Error('internal writer details'); },
    writeError: (text) => { errors.push(text); },
  });
  assert.equal(code, 1);
  assert.deepEqual(errors, ['photo-trip-group: unable to read or write planner input/output.\n']);
});

test('real CLI succeeds with explicit empty child environment', () => {
  const child = executable(JSON.stringify(fixture()));
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), groupPhotosByTrip(fixture()));
});

test('real CLI exits nonzero for malformed input with no stdout', () => {
  const child = executable('{');
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, 'photo-trip-group: input must be one valid UTF-8 JSON value.\n');
});

test('real import leaves stdin and output untouched', () => {
  const moduleUrl = new URL('../../../scripts/burn4-photo-trip-group.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--import', moduleUrl, '--input-type=module', '--eval',
    "let text = ''; for await (const chunk of process.stdin) text += chunk; if (text !== 'import-sentinel') process.exitCode = 2;"], {
    input: 'import-sentinel', encoding: 'utf8', env: {}, timeout: 5000, maxBuffer: 1024 * 1024,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
});
