import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Bounds cover input, validation, sorting and worst-case geometry expansion. */
export const TRIP_ROUTE_LIMITS = Object.freeze({
  inputBytes: 4 * 1024 * 1024,
  trips: 256,
  stopsPerTrip: 512,
  totalStops: 8192,
  features: 8192,
  positions: 32768,
  outputBytes: 16 * 1024 * 1024,
  idLength: 128,
  nameLength: 256,
  chunks: 16384,
});

/** @typedef {[number, number]} Position Longitude, latitude. */
/** @typedef {{ id: string, latitude: number, longitude: number, sortOrder: number, isHub: boolean }} Stop */
/** @typedef {{ id: string, name?: string, style: 'route'|'loop'|'hub', stops: Stop[] }} Trip */
/** @typedef {{ type: 'LineString', coordinates: Position[] } | { type: 'MultiLineString', coordinates: Position[][] }} Geometry */
/** @typedef {{ type: 'Feature', properties: { tripId: string, tripName?: string, style: string, leg: number, fromStopId: string, toStopId: string }, geometry: Geometry }} Feature */
/** @typedef {{ type: 'FeatureCollection', features: Feature[] }} FeatureCollection */
/** @typedef {{ readChunks: (path: string) => AsyncIterable<Uint8Array>, stdout: (text: string) => void|Promise<void>, stderr: (text: string) => void|Promise<void> }} CliIO */

class TripRouteInputError extends Error {}

/** @param {string} path @param {string} reason @returns {never} */
function invalid(path, reason) {
  throw new TripRouteInputError(`${path}: ${reason}`);
}

/** @param {unknown} value @param {string} path @returns {Record<string, unknown>} */
function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'expected an object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path, 'expected a plain object');
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} path @param {number} max @returns {string} */
function text(value, path, max) {
  if (typeof value !== 'string' || value.trim().length === 0) invalid(path, 'expected nonblank text');
  if (value.length > max) invalid(path, `text exceeds ${max} UTF-16 code units`);
  return value;
}

/** @param {unknown} value @param {string} path @param {number} max @returns {number} */
function coordinate(value, path, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -max || value > max) {
    invalid(path, `expected a finite number between ${-max} and ${max}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

/** @param {unknown} value @param {string} path @returns {Position} */
function position(value, path) {
  if (!Array.isArray(value) || value.length !== 2) invalid(path, 'expected [longitude, latitude]');
  return [coordinate(value[0], `${path}[0]`, 180), coordinate(value[1], `${path}[1]`, 90)];
}

/**
 * Return the shorter longitudinal leg, cut into two parts if it crosses 180.
 * Latitude interpolation is linear in lon/lat, not a geodesic or road route.
 * Exactly 180-degree ties keep input direction. Boundary representations may
 * change sign because +180 and -180 describe the same geographic meridian.
 * @param {unknown} start
 * @param {unknown} end
 * @returns {Geometry}
 */
export function splitAntimeridianLeg(start, end) {
  const first = position(start, 'start');
  const last = position(end, 'end');
  if (Math.abs(last[0] - first[0]) <= 180) return { type: 'LineString', coordinates: [first, last] };
  // Keep a boundary endpoint on the same map edge as its neighboring point.
  if (Math.abs(first[0]) === 180 && last[0] !== 0) first[0] = last[0] < 0 ? -180 : 180;
  if (Math.abs(last[0]) === 180 && first[0] !== 0) last[0] = first[0] < 0 ? -180 : 180;
  const delta = last[0] - first[0];
  if (Math.abs(delta) <= 180) return { type: 'LineString', coordinates: [first, last] };

  const unwrappedEnd = last[0] + (delta > 180 ? -360 : 360);
  const boundary = delta > 180 ? -180 : 180;
  const fraction = (boundary - first[0]) / (unwrappedEnd - first[0]);
  // The weighted form avoids cancellation near the input latitude extremes.
  const crossingLatitude = first[1] * (1 - fraction) + last[1] * fraction;
  return {
    type: 'MultiLineString',
    coordinates: [
      [first, [boundary, crossingLatitude]],
      [[-boundary, crossingLatitude], last],
    ],
  };
}

/** @param {unknown} input @returns {Trip[]} */
function validateTrips(input) {
  const root = record(input, 'input');
  if (!Array.isArray(root.trips)) invalid('trips', 'expected an array');
  if (root.trips.length > TRIP_ROUTE_LIMITS.trips) invalid('trips', 'too many trips');
  const tripIds = new Set();
  let totalStops = 0;
  return Array.from(root.trips, (value, tripIndex) => {
    const path = `trips[${tripIndex}]`;
    const raw = record(value, path);
    const id = text(raw.id, `${path}.id`, TRIP_ROUTE_LIMITS.idLength);
    if (tripIds.has(id)) invalid(`${path}.id`, 'duplicate trip ID');
    tripIds.add(id);
    if (raw.style !== 'route' && raw.style !== 'loop' && raw.style !== 'hub') {
      invalid(`${path}.style`, 'expected route, loop or hub');
    }
    if (!Array.isArray(raw.stops)) invalid(`${path}.stops`, 'expected an array');
    if (raw.stops.length > TRIP_ROUTE_LIMITS.stopsPerTrip) invalid(`${path}.stops`, 'too many stops');
    totalStops += raw.stops.length;
    if (totalStops > TRIP_ROUTE_LIMITS.totalStops) invalid('trips', 'too many total stops');
    const stopIds = new Set();
    let hubs = 0;
    const stops = Array.from(raw.stops, (stopValue, stopIndex) => {
      const stopPath = `${path}.stops[${stopIndex}]`;
      const stop = record(stopValue, stopPath);
      const stopId = text(stop.id, `${stopPath}.id`, TRIP_ROUTE_LIMITS.idLength);
      if (stopIds.has(stopId)) invalid(`${stopPath}.id`, 'duplicate stop ID within trip');
      stopIds.add(stopId);
      if (typeof stop.sortOrder !== 'number' || !Number.isSafeInteger(stop.sortOrder)) {
        invalid(`${stopPath}.sortOrder`, 'expected a safe integer');
      }
      if (stop.isHub !== undefined && typeof stop.isHub !== 'boolean') {
        invalid(`${stopPath}.isHub`, 'expected a boolean when supplied');
      }
      if (stop.isHub === true) hubs += 1;
      return {
        id: stopId,
        latitude: coordinate(stop.latitude, `${stopPath}.latitude`, 90),
        longitude: coordinate(stop.longitude, `${stopPath}.longitude`, 180),
        sortOrder: stop.sortOrder,
        isHub: stop.isHub === true,
      };
    });
    if (hubs > 1) invalid(`${path}.stops`, 'at most one stop may be a hub');
    // Array sorting is stable; equal sort orders retain their supplied order.
    stops.sort((a, b) => a.sortOrder - b.sortOrder);
    /** @type {Trip} */
    const trip = { id, style: raw.style, stops };
    return raw.name === undefined ? trip : { ...trip, name: text(raw.name, `${path}.name`, TRIP_ROUTE_LIMITS.nameLength) };
  });
}

/** @param {Trip} trip @returns {Array<[Stop, Stop]>} */
function tripLegs(trip) {
  const first = trip.stops[0];
  if (!first || trip.stops.length < 2) return [];
  if (trip.style === 'hub') {
    const hub = trip.stops.find((stop) => stop.isHub) ?? first;
    return trip.stops.filter((stop) => stop !== hub).map((stop) => [hub, stop]);
  }
  /** @type {Array<[Stop, Stop]>} */
  const legs = [];
  for (let index = 1; index < trip.stops.length; index += 1) {
    const from = trip.stops[index - 1];
    const to = trip.stops[index];
    if (from && to) legs.push([from, to]);
  }
  const last = trip.stops.at(-1);
  if (trip.style === 'loop' && last) legs.push([last, first]);
  return legs;
}

/**
 * Build one feature per logical leg from an explicit bounded trip snapshot.
 * No application, provider or original source helpers are loaded. Unknown
 * metadata is deliberately omitted. The supplied snapshot remains untouched.
 * @param {unknown} input
 * @returns {FeatureCollection}
 */
export function buildTripRouteGeoJSON(input) {
  const trips = validateTrips(input);
  // Preflight conservative worst-case expansion before allocating features.
  let featureCount = 0;
  let outputBudget = 64;
  for (const trip of trips) {
    for (const [from, to] of tripLegs(trip)) {
      featureCount += 1;
      outputBudget += 768 + 6 * (trip.id.length + (trip.name?.length ?? 0) + from.id.length + to.id.length);
      if (featureCount > TRIP_ROUTE_LIMITS.features || featureCount * 4 > TRIP_ROUTE_LIMITS.positions) {
        invalid('trips', 'geometry expansion exceeds feature or position budget');
      }
      if (outputBudget > TRIP_ROUTE_LIMITS.outputBytes) invalid('trips', 'geometry expansion exceeds output byte budget');
    }
  }
  /** @type {Feature[]} */
  const features = [];
  for (const trip of trips) {
    tripLegs(trip).forEach(([from, to], leg) => {
      const properties = {
        tripId: trip.id,
        ...(trip.name === undefined ? {} : { tripName: trip.name }),
        style: trip.style,
        leg,
        fromStopId: from.id,
        toStopId: to.id,
      };
      features.push({
        type: 'Feature',
        properties,
        geometry: splitAntimeridianLeg([from.longitude, from.latitude], [to.longitude, to.latitude]),
      });
    });
  }
  return { type: 'FeatureCollection', features };
}

const HELP = 'Usage: node scripts/burn4-trip-route-geometry.mjs <local-trip-snapshot.json>\n'
  + 'Write antimeridian-safe route/loop/hub GeoJSON to stdout. No network or data writes.\n';

/** @param {AsyncIterable<Uint8Array>} chunks @returns {Promise<string>} */
async function readBounded(chunks) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let count = 0;
  /** @type {string[]} */
  const parts = [];
  for await (const chunk of chunks) {
    count += 1;
    if (!(chunk instanceof Uint8Array)) invalid('input', 'reader must supply byte chunks');
    bytes += chunk.byteLength;
    if (bytes > TRIP_ROUTE_LIMITS.inputBytes) invalid('input', 'file exceeds input byte budget');
    if (count > TRIP_ROUTE_LIMITS.chunks) invalid('input', 'file exceeds input chunk budget');
    parts.push(decoder.decode(chunk, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
}

/**
 * Dependency-injected CLI core. Failures return 2 and never echo input data,
 * file contents or raw I/O errors. Help and successful output return 0.
 * @param {string[]} args
 * @param {CliIO} io
 * @returns {Promise<number>}
 */
export async function runCli(args, io) {
  let stage = 'arguments';
  try {
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
      await io.stdout(HELP);
      return 0;
    }
    const path = args[0];
    if (args.length !== 1 || typeof path !== 'string' || path.length === 0 || path.length > 4096
      || path.startsWith('-') || path.includes('\0') || /^[a-z][a-z\d+.-]*:/i.test(path)) {
      await io.stderr(HELP);
      return 2;
    }
    stage = 'read';
    const json = await readBounded(io.readChunks(path));
    stage = 'JSON';
    const input = /** @type {unknown} */ (JSON.parse(json));
    stage = 'validation';
    const output = buildTripRouteGeoJSON(input);
    stage = 'output';
    await io.stdout(`${JSON.stringify(output)}\n`);
    return 0;
  } catch (error) {
    const detail = error instanceof TripRouteInputError ? `: ${error.message}` : '';
    try {
      await io.stderr(`Trip route ${stage} failed${detail}.\n`);
    } catch {
      // A broken error stream must still produce a failure return value.
    }
    return 2;
  }
}

// Importing this module has no I/O. Direct invocation reads only the named file.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Writable error events accompany callback failures such as a closed pipe.
  // The callbacks below report them through the same CLI failure path.
  const streamError = () => {};
  process.stdout.on('error', streamError);
  process.stderr.on('error', streamError);
  process.exitCode = await runCli(process.argv.slice(2), {
    readChunks: (path) => createReadStream(path),
    stdout: (value) => new Promise((accept, reject) => {
      process.stdout.write(value, (error) => error ? reject(error) : accept());
    }),
    stderr: (value) => new Promise((accept, reject) => {
      process.stderr.write(value, (error) => error ? reject(error) : accept());
    }),
  });
  process.stdout.removeListener('error', streamError);
  process.stderr.removeListener('error', streamError);
}
