import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTripRouteGeoJSON, splitAntimeridianLeg } from '../../../scripts/burn4-trip-route-geometry.mjs';
import { assertGeometry, near, snapshot, stop } from './burn4-test-helpers.mjs';

test('eastbound Pacific leg has paired boundary endpoints and independent crossing latitude', () => {
  const geometry = splitAntimeridianLeg([170, 20], [-160, 50]);
  assert.deepEqual(geometry, { type: 'MultiLineString', coordinates: [[[170, 20], [180, 30]], [[-180, 30], [-160, 50]]] });
  assertGeometry(geometry);
});

test('westbound Pacific leg cuts at the negative map edge', () => {
  const geometry = splitAntimeridianLeg([-170, 50], [160, 20]);
  assert.deepEqual(geometry, { type: 'MultiLineString', coordinates: [[[-170, 50], [-180, 40]], [[180, 40], [160, 20]]] });
  assertGeometry(geometry);
});

test('non-midpoint crossing uses longitude fraction rather than latitude midpoint', () => {
  const geometry = splitAntimeridianLeg([175, -45], [-150, 25]);
  assert.equal(geometry.type, 'MultiLineString');
  if (geometry.type === 'MultiLineString') near(geometry.coordinates[0]?.[1]?.[1] ?? NaN, -35);
  assertGeometry(geometry);
});

const ordinaryVectors = [
  { name: 'ordinary east', from: [10, 20], to: [30, 40] },
  { name: 'ordinary west', from: [-10, 40], to: [-30, 20] },
  { name: 'east antipodal tie', from: [-90, 12], to: [90, -12] },
  { name: 'west antipodal tie', from: [90, 12], to: [-90, -12] },
  { name: 'zero origin', from: [0, 0], to: [10, 10] },
  { name: 'north pole', from: [10, 90], to: [20, 90] },
  { name: 'coincident original stops', from: [20, -10], to: [20, -10] },
  { name: 'positive boundary tie', from: [180, 0], to: [0, 20] },
  { name: 'negative boundary tie', from: [-180, 0], to: [0, 20] },
  { name: 'zero to positive boundary tie', from: [0, 20], to: [180, 0] },
  { name: 'zero to negative boundary tie', from: [0, 20], to: [-180, 0] },
];
for (const vector of ordinaryVectors) {
  test(`unsplit ${vector.name} retains input direction and endpoints`, () => {
    const geometry = splitAntimeridianLeg(vector.from, vector.to);
    assert.deepEqual(geometry, { type: 'LineString', coordinates: [vector.from, vector.to] });
    assertGeometry(geometry);
  });
}

const boundaryVectors = [
  { from: [180, 0], to: [-170, 10], expected: [[-180, 0], [-170, 10]] },
  { from: [-180, 0], to: [170, 10], expected: [[180, 0], [170, 10]] },
  { from: [170, 0], to: [-180, 10], expected: [[170, 0], [180, 10]] },
  { from: [-170, 0], to: [180, 10], expected: [[-170, 0], [-180, 10]] },
  { from: [180, -20], to: [-180, 30], expected: [[-180, -20], [-180, 30]] },
  { from: [-180, -20], to: [180, 30], expected: [[180, -20], [180, 30]] },
];
for (const [index, vector] of boundaryVectors.entries()) {
  test(`boundary leg ${index + 1} changes representation without inventing fragments`, () => {
    const geometry = splitAntimeridianLeg(vector.from, vector.to);
    assert.deepEqual(geometry, { type: 'LineString', coordinates: vector.expected });
    assertGeometry(geometry);
  });
}

test('tiny rounding-scale crossing has finite interior fragments', () => {
  const geometry = splitAntimeridianLeg([179.99999999999997, -90], [-179.99999999999997, 90]);
  assertGeometry(geometry);
  assert.equal(geometry.type, 'MultiLineString');
});

test('seeded geometry vectors satisfy map-consumer invariants and reverse symmetrically', () => {
  let state = 37;
  const next = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  for (let index = 0; index < 2000; index += 1) {
    const from = [next() * 360 - 180, next() * 180 - 90];
    const to = [next() * 360 - 180, next() * 180 - 90];
    const forward = splitAntimeridianLeg(from, to);
    const backward = splitAntimeridianLeg(to, from);
    assertGeometry(forward);
    assertGeometry(backward);
    assert.equal(forward.type, backward.type);
    if (forward.type === 'MultiLineString' && backward.type === 'MultiLineString') {
      near(forward.coordinates[0]?.[1]?.[1] ?? NaN, backward.coordinates[0]?.[1]?.[1] ?? NaN);
    }
  }
});

test('route orders legs by sortOrder and keeps tied stop order stable', () => {
  const input = snapshot('route', [stop('c', 30, 3, 2), stop('a', 10, 1, -2), stop('b', 20, 2, 2)]);
  const output = buildTripRouteGeoJSON(input);
  assert.equal(output.type, 'FeatureCollection');
  assert.deepEqual(output.features.map((feature) => [feature.properties.fromStopId, feature.properties.toStopId, feature.properties.leg]), [['a', 'c', 0], ['c', 'b', 1]]);
  assert.deepEqual(output.features[0]?.geometry, { type: 'LineString', coordinates: [[10, 1], [30, 3]] });
});

test('loop closes from the last ordered stop to the first exactly once', () => {
  const output = buildTripRouteGeoJSON(snapshot('loop', [stop('a', 170), stop('b', -170, 0, 1), stop('c', 150, 0, 2)]));
  assert.deepEqual(output.features.map((feature) => [feature.properties.fromStopId, feature.properties.toStopId]), [['a', 'b'], ['b', 'c'], ['c', 'a']]);
  output.features.forEach((feature) => assertGeometry(feature.geometry));
});

test('neighboring boundary legs join geographically despite opposite edge representations', () => {
  const output = buildTripRouteGeoJSON(snapshot('route', [stop('a', 170, 0, 0), stop('b', 180, 10, 1), stop('c', -170, 20, 2), stop('d', -180, 30, 3), stop('e', 170, 40, 4)]));
  assert.equal(output.features.length, 4);
  for (let index = 1; index < output.features.length; index += 1) {
    const previous = output.features[index - 1]?.geometry;
    const current = output.features[index]?.geometry;
    assert.ok(previous?.type === 'LineString' && current?.type === 'LineString');
    const end = previous.coordinates[1];
    const start = current.coordinates[0];
    assert.ok(start && end);
    assert.equal(end[1], start[1]);
    assert.ok(end[0] === start[0] || Math.abs(end[0] - start[0]) === 360);
  }
  output.features.forEach((feature) => assertGeometry(feature.geometry));
});

test('two-stop loop is an explicit out-and-back route', () => {
  const output = buildTripRouteGeoJSON(snapshot('loop'));
  assert.deepEqual(output.features.map((feature) => [feature.properties.fromStopId, feature.properties.toStopId]), [['a', 'b'], ['b', 'a']]);
});

test('hub defaults to first ordered stop and emits n-1 spokes', () => {
  const output = buildTripRouteGeoJSON(snapshot('hub', [stop('b', -170, 0, 4), stop('a', 170, 0, 0), stop('c', 10, 0, 5)]));
  assert.deepEqual(output.features.map((feature) => [feature.properties.fromStopId, feature.properties.toStopId]), [['a', 'b'], ['a', 'c']]);
  output.features.forEach((feature) => assertGeometry(feature.geometry));
});

test('explicit hub overrides order while spokes retain their sorted order', () => {
  const hub = { ...stop('hub', 0, 0, 8), isHub: true };
  const output = buildTripRouteGeoJSON(snapshot('hub', [stop('b', 20, 20, 2), hub, stop('a', 10, 10, 1)]));
  assert.deepEqual(output.features.map((feature) => [feature.properties.fromStopId, feature.properties.toStopId]), [['hub', 'a'], ['hub', 'b']]);
  assert.deepEqual(output.features[0]?.geometry, { type: 'LineString', coordinates: [[0, 0], [10, 10]] });
});

test('empty root, empty trips and singletons produce no line', () => {
  assert.deepEqual(buildTripRouteGeoJSON({ trips: [] }), { type: 'FeatureCollection', features: [] });
  for (const style of /** @type {const} */ (['route', 'loop', 'hub'])) {
    assert.deepEqual(buildTripRouteGeoJSON(snapshot(style, [])).features, []);
    assert.deepEqual(buildTripRouteGeoJSON(snapshot(style, [stop('a', 0)])).features, []);
  }
});

test('multiple trips preserve supplied trip order and never cross-link equal stop IDs', () => {
  const first = snapshot('route').trips[0];
  const second = snapshot('loop').trips[0];
  assert.ok(first && second);
  second.id = 'second';
  const output = buildTripRouteGeoJSON({ trips: [second, first] });
  assert.deepEqual(output.features.map((feature) => feature.properties.tripId), ['second', 'second', 'trip']);
});

test('metadata allowlist and Unicode names round-trip without leaking extra fields', () => {
  const input = snapshot();
  const trip = input.trips[0];
  assert.ok(trip);
  trip.name = '日本 "Pacific" 🗺️';
  const output = buildTripRouteGeoJSON({ ...input, private: 'not included', trips: [{ ...trip, notes: 'not included' }] });
  assert.deepEqual(output.features[0]?.properties, { tripId: 'trip', tripName: trip.name, style: 'route', leg: 0, fromStopId: 'a', toStopId: 'b' });
  assert.ok(!JSON.stringify(output).includes('not included'));
  assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
});

test('input is deeply immutable and output coordinate mutation cannot affect it', () => {
  const input = snapshot('loop', [stop('b', -170, 30, 1), stop('a', 170, 10, 0)]);
  const before = JSON.stringify(input);
  input.trips.forEach((trip) => { trip.stops.forEach(Object.freeze); Object.freeze(trip.stops); Object.freeze(trip); });
  Object.freeze(input.trips);
  Object.freeze(input);
  const output = buildTripRouteGeoJSON(input);
  const first = output.features[0]?.geometry;
  assert.ok(first && first.type === 'MultiLineString' && first.coordinates[0]?.[0]);
  first.coordinates[0][0][0] = 7;
  assert.equal(JSON.stringify(input), before);
  assert.notDeepEqual(buildTripRouteGeoJSON(input), output);
});

test('negative zero coordinates normalize to positive zero', () => {
  const geometry = splitAntimeridianLeg([-0, -0], [1, 1]);
  assert.equal(geometry.type, 'LineString');
  if (geometry.type === 'LineString') {
    assert.equal(Object.is(geometry.coordinates[0]?.[0], -0), false);
    assert.equal(Object.is(geometry.coordinates[0]?.[1], -0), false);
  }
});
