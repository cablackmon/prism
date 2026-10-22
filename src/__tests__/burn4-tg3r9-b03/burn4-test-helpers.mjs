import assert from 'node:assert/strict';
import { TRIP_ROUTE_LIMITS } from '../../../scripts/burn4-trip-route-geometry.mjs';

/** @typedef {import('../../../scripts/burn4-trip-route-geometry.mjs').CliIO} CliIO */
/** @typedef {{ id: string, longitude: number, latitude: number, sortOrder: number, isHub?: boolean }} TestStop */
/** @typedef {{ id: string, style: 'route'|'loop'|'hub', stops: TestStop[], name?: string }} TestTrip */

/** @param {string} id @param {number} longitude @param {number} latitude @param {number} sortOrder @returns {TestStop} */
export const stop = (id, longitude, latitude = 0, sortOrder = 0) => ({ id, longitude, latitude, sortOrder });

/** @param {'route'|'loop'|'hub'} style @param {TestStop[]} stops @returns {{ trips: TestTrip[] }} */
export const snapshot = (style = 'route', stops = [stop('a', 10), stop('b', 20)]) => ({ trips: [{ id: 'trip', style, stops }] });

/** @param {unknown} input @returns {AsyncGenerator<Uint8Array>} */
export async function* jsonChunks(input) {
  yield Buffer.from(JSON.stringify(input));
}

/** @param {unknown} input @param {Partial<CliIO>} overrides */
export function fakeIO(input = snapshot(), overrides = {}) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  /** @type {string[]} */
  const reads = [];
  /** @type {CliIO} */
  const io = {
    readChunks: (path) => { reads.push(path); return jsonChunks(input); },
    stdout: (value) => { out.push(value); },
    stderr: (value) => { err.push(value); },
    ...overrides,
  };
  return { io, out, err, reads };
}

/** @param {number} actual @param {number} expected */
export function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} is not close to ${expected}`);
}

/** @param {import('../../../scripts/burn4-trip-route-geometry.mjs').Geometry} geometry */
export function assertGeometry(geometry) {
  const parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  assert.ok(parts.length === 1 || parts.length === 2);
  for (const part of parts) {
    assert.equal(part.length, 2);
    const first = part[0];
    const last = part[1];
    assert.ok(first && last);
    assert.ok(Math.abs(last[0] - first[0]) <= 180);
    for (const [longitude, latitude] of part) {
      assert.ok(Number.isFinite(longitude) && longitude >= -180 && longitude <= 180);
      assert.ok(Number.isFinite(latitude) && latitude >= -90 && latitude <= 90);
    }
  }
  if (geometry.type === 'MultiLineString') {
    const left = geometry.coordinates[0];
    const right = geometry.coordinates[1];
    assert.ok(left && right && left[0] && left[1] && right[0] && right[1]);
    assert.equal(Math.abs(left[1][0]), 180);
    assert.equal(left[1][0], -right[0][0]);
    assert.equal(left[1][1], right[0][1]);
    assert.notDeepEqual(left[0], left[1]);
    assert.notDeepEqual(right[0], right[1]);
  }
}

// A shared direct assertion also detects accidental mutability of the limits.
assert.ok(Object.isFrozen(TRIP_ROUTE_LIMITS));
