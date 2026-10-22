import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTripRouteGeoJSON, splitAntimeridianLeg, TRIP_ROUTE_LIMITS } from '../../../scripts/burn4-trip-route-geometry.mjs';
import { snapshot, stop } from './burn4-test-helpers.mjs';

/** @param {Record<string, unknown>} changes */
function changedStop(changes) {
  return { trips: [{ id: 'trip', style: 'route', stops: [{ ...stop('a', 10), ...changes }] }] };
}

const invalidSnapshots = [
  { name: 'null root', input: null, match: /input: expected an object/ },
  { name: 'array root', input: [], match: /input: expected an object/ },
  { name: 'missing trips', input: {}, match: /trips: expected an array/ },
  { name: 'nonarray trips', input: { trips: {} }, match: /trips: expected an array/ },
  { name: 'null trip', input: { trips: [null] }, match: /trips\[0\]: expected an object/ },
  { name: 'blank trip ID', input: { trips: [{ id: ' ', style: 'route', stops: [] }] }, match: /trips\[0\]\.id: expected nonblank text/ },
  { name: 'invalid style', input: { trips: [{ id: 't', style: 'plane', stops: [] }] }, match: /trips\[0\]\.style: expected route, loop or hub/ },
  { name: 'missing stops', input: { trips: [{ id: 't', style: 'route' }] }, match: /trips\[0\]\.stops: expected an array/ },
  { name: 'null stop', input: { trips: [{ id: 't', style: 'route', stops: [null] }] }, match: /stops\[0\]: expected an object/ },
  { name: 'numeric stop ID', input: changedStop({ id: 9 }), match: /stops\[0\]\.id: expected nonblank text/ },
  { name: 'blank stop ID', input: changedStop({ id: '\t' }), match: /stops\[0\]\.id: expected nonblank text/ },
  { name: 'longitude too high', input: changedStop({ longitude: 181 }), match: /\.longitude: expected a finite number/ },
  { name: 'longitude too low', input: changedStop({ longitude: -181 }), match: /\.longitude: expected a finite number/ },
  { name: 'latitude too high', input: changedStop({ latitude: 91 }), match: /\.latitude: expected a finite number/ },
  { name: 'latitude too low', input: changedStop({ latitude: -91 }), match: /\.latitude: expected a finite number/ },
  { name: 'string coordinate', input: changedStop({ latitude: '20' }), match: /\.latitude: expected a finite number/ },
  { name: 'null coordinate', input: changedStop({ longitude: null }), match: /\.longitude: expected a finite number/ },
  { name: 'NaN coordinate', input: changedStop({ latitude: NaN }), match: /\.latitude: expected a finite number/ },
  { name: 'infinite coordinate', input: changedStop({ longitude: Infinity }), match: /\.longitude: expected a finite number/ },
  { name: 'fractional order', input: changedStop({ sortOrder: 1.5 }), match: /\.sortOrder: expected a safe integer/ },
  { name: 'unsafe order', input: changedStop({ sortOrder: Number.MAX_SAFE_INTEGER + 1 }), match: /\.sortOrder: expected a safe integer/ },
  { name: 'missing order', input: changedStop({ sortOrder: undefined }), match: /\.sortOrder: expected a safe integer/ },
  { name: 'string hub', input: changedStop({ isHub: 'true' }), match: /\.isHub: expected a boolean/ },
  { name: 'null hub', input: changedStop({ isHub: null }), match: /\.isHub: expected a boolean/ },
];
for (const example of invalidSnapshots) {
  test(`reject ${example.name} with its field path`, () => {
    assert.throws(() => buildTripRouteGeoJSON(example.input), example.match);
  });
}

test('reject duplicate trip IDs before producing any geometry', () => {
  const input = snapshot();
  input.trips.push({ id: 'trip', style: 'route', stops: [] });
  assert.throws(() => buildTripRouteGeoJSON(input), /trips\[1\]\.id: duplicate trip ID/);
});

test('public snapshot API rejects sparse trip and stop arrays rather than omitting records', () => {
  assert.throws(() => buildTripRouteGeoJSON({ trips: new Array(1) }), /trips\[0\]: expected an object/);
  assert.throws(() => buildTripRouteGeoJSON({ trips: [{ id: 't', style: 'route', stops: new Array(2) }] }), /stops\[0\]: expected an object/);
});

test('reject duplicate stop IDs within a trip', () => {
  assert.throws(() => buildTripRouteGeoJSON(snapshot('route', [stop('a', 0), stop('a', 20)])), /stops\[1\]\.id: duplicate stop ID/);
});

test('reject multiple hubs even when trip style would otherwise ignore them', () => {
  assert.throws(() => buildTripRouteGeoJSON(snapshot('route', [{ ...stop('a', 0), isHub: true }, { ...stop('b', 20), isHub: true }])), /at most one stop may be a hub/);
});

test('allow one true hub, false hub and extreme safe integer orders', () => {
  const input = snapshot('hub', [
    { ...stop('a', 0, 0, Number.MAX_SAFE_INTEGER), isHub: true },
    { ...stop('b', 20, 10, Number.MIN_SAFE_INTEGER), isHub: false },
  ]);
  assert.equal(buildTripRouteGeoJSON(input).features[0]?.properties.fromStopId, 'a');
});

test('IDs retain exact text identity instead of silently trimming it', () => {
  const output = buildTripRouteGeoJSON(snapshot('route', [stop('a', 0), stop(' a ', 10)]));
  assert.equal(output.features[0]?.properties.toStopId, ' a ');
});

test('IDs that resemble object property names remain independent', () => {
  const output = buildTripRouteGeoJSON(snapshot('route', [stop('__proto__', 0), stop('constructor', 10)]));
  assert.equal(output.features.length, 1);
  assert.equal(output.features[0]?.properties.fromStopId, '__proto__');
});

test('reject inherited custom-prototype records while allowing null-prototype JSON-like records', () => {
  assert.throws(() => buildTripRouteGeoJSON(Object.create({ trips: [] })), /expected a plain object/);
  const input = Object.assign(Object.create(null), { trips: [] });
  assert.deepEqual(buildTripRouteGeoJSON(input).features, []);
});

test('unknown metadata including own __proto__ does not enter output', () => {
  const input = JSON.parse('{"trips":[],"__proto__":{"pollution":true}}');
  assert.deepEqual(buildTripRouteGeoJSON(input), { type: 'FeatureCollection', features: [] });
});

test('name is optional but present names must be nonblank text within bounds', () => {
  for (const name of [null, '', ' ', 7, 'x'.repeat(TRIP_ROUTE_LIMITS.nameLength + 1)]) {
    assert.throws(() => buildTripRouteGeoJSON({ trips: [{ id: 't', style: 'route', stops: [], name }] }), /trips\[0\]\.name:/);
  }
});

test('maximum ID and name lengths remain valid', () => {
  const input = { trips: [{ id: 't'.repeat(TRIP_ROUTE_LIMITS.idLength), name: 'n'.repeat(TRIP_ROUTE_LIMITS.nameLength), style: 'route', stops: [stop('a'.repeat(TRIP_ROUTE_LIMITS.idLength), 0), stop('b'.repeat(TRIP_ROUTE_LIMITS.idLength), 20)] }] };
  assert.equal(buildTripRouteGeoJSON(input).features.length, 1);
});

test('overlong IDs are rejected on both trip and stop paths', () => {
  const id = 'x'.repeat(TRIP_ROUTE_LIMITS.idLength + 1);
  assert.throws(() => buildTripRouteGeoJSON({ trips: [{ id, style: 'route', stops: [] }] }), /trips\[0\]\.id: text exceeds/);
  assert.throws(() => buildTripRouteGeoJSON(changedStop({ id })), /stops\[0\]\.id: text exceeds/);
});

test('trip count budget is inclusive and rejects the next trip', () => {
  const trips = Array.from({ length: TRIP_ROUTE_LIMITS.trips }, (_, index) => ({ id: `t${index}`, style: 'route', stops: [] }));
  assert.deepEqual(buildTripRouteGeoJSON({ trips }).features, []);
  assert.throws(() => buildTripRouteGeoJSON({ trips: [...trips, { id: 'extra', style: 'route', stops: [] }] }), /too many trips/);
});

test('per-trip stop budget is inclusive and rejects the next stop', () => {
  const stops = Array.from({ length: TRIP_ROUTE_LIMITS.stopsPerTrip }, (_, index) => stop(`s${index}`, index % 170, 0, index));
  assert.equal(buildTripRouteGeoJSON(snapshot('loop', stops)).features.length, stops.length);
  assert.throws(() => buildTripRouteGeoJSON(snapshot('loop', [...stops, stop('extra', 0)])), /too many stops/);
});

test('aggregate stop and position budgets allow their maximum modest metadata case', () => {
  const trips = Array.from({ length: TRIP_ROUTE_LIMITS.totalStops / TRIP_ROUTE_LIMITS.stopsPerTrip }, (_, index) => ({
    id: `t${index}`,
    style: 'loop',
    stops: Array.from({ length: TRIP_ROUTE_LIMITS.stopsPerTrip }, (_, stopIndex) => stop(`s${stopIndex}`, stopIndex % 2 ? 170 : -170, 0, stopIndex)),
  }));
  const output = buildTripRouteGeoJSON({ trips });
  assert.equal(output.features.length, TRIP_ROUTE_LIMITS.features);
  const count = output.features.reduce((sum, feature) => sum + (feature.geometry.type === 'MultiLineString' ? 4 : 2), 0);
  assert.equal(count, TRIP_ROUTE_LIMITS.positions);
  trips.push({ id: 'overflow', style: 'loop', stops: [stop('s', 0)] });
  assert.throws(() => buildTripRouteGeoJSON({ trips }), /too many total stops/);
});

test('metadata expansion budget rejects bounded large snapshots before feature output allocation', () => {
  const trips = Array.from({ length: 10 }, (_, index) => ({
    id: `${index}`.padEnd(128, 't'),
    name: 'n'.repeat(256),
    style: 'loop',
    stops: Array.from({ length: 512 }, (_, stopIndex) => stop(`${stopIndex}`.padEnd(128, 's'), 10, 0, stopIndex)),
  }));
  assert.throws(() => buildTripRouteGeoJSON({ trips }), /geometry expansion exceeds output byte budget/);
});

const invalidLegs = [
  { start: null, end: [0, 0], match: /start: expected \[longitude, latitude\]/ },
  { start: [0], end: [0, 0], match: /start: expected \[longitude, latitude\]/ },
  { start: [0, 0, 0], end: [0, 0], match: /start: expected \[longitude, latitude\]/ },
  { start: [181, 0], end: [0, 0], match: /start\[0\]: expected a finite number/ },
  { start: [0, 0], end: [0, NaN], match: /end\[1\]: expected a finite number/ },
  { start: [0, 0], end: [Infinity, 0], match: /end\[0\]: expected a finite number/ },
];
for (const [index, example] of invalidLegs.entries()) {
  test(`public leg API rejects malformed coordinates ${index + 1}`, () => {
    assert.throws(() => splitAntimeridianLeg(example.start, example.end), example.match);
  });
}
