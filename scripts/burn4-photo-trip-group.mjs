import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

/** Explicit offline resource limits, not production capacity claims. */
export const PHOTO_TRIP_LIMITS = Object.freeze({
  inputBytes: 8 * 1024 * 1024,
  inputChunks: 16384,
  photos: 100000,
  trips: 1000,
  pins: 10000,
  comparisons: 10000000,
  manifestBytes: 32 * 1024 * 1024,
});

/** @typedef {{latitude: number, longitude: number}} Coordinates */
/** @typedef {Coordinates & {id: string}} Pin */
/** @typedef {{kind: 'ready', latitude: number, longitude: number} | {kind: 'missing-gps' | 'invalid-gps'}} PhotoGps */
/** @typedef {{id: string, gps: PhotoGps}} Photo */
/** @typedef {{id: string, name: string, pins: Pin[]}} Trip */
/** @typedef {{pinId: string, distanceKm: number}} PinMatch */
/** @typedef {{photoId: string, matchedPins: PinMatch[]}} GroupedPhoto */
/** @typedef {{tripId: string, name: string, photos: GroupedPhoto[]}} TripGroup */
/** @typedef {{photoId: string, tripIds: string[]}} Overlap */
/** @typedef {{photoId: string, reason: 'missing-gps' | 'invalid-gps' | 'no-nearby-trip'}} UngroupedPhoto */
/** @typedef {{schemaVersion: 1, radiusKm: number, groups: TripGroup[], overlaps: Overlap[], ungrouped: UngroupedPhoto[]}} TripManifest */
/** @typedef {{input: AsyncIterable<Uint8Array>, writeOutput: (text: string) => void, writeError: (text: string) => void}} CliIo */

class InputError extends TypeError {}

/** @param {unknown} value @param {string} path @returns {Record<string, unknown>} */
function record(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InputError(`${path} must be an object.`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} path @returns {unknown[]} */
function array(value, path) {
  if (!Array.isArray(value)) throw new InputError(`${path} must be an array.`);
  return value;
}

/** @param {unknown} value @param {string} path @returns {string} */
function identifier(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InputError(`${path} must be a nonempty string.`);
  }
  return value;
}

/** @param {unknown} value @param {number} minimum @param {number} maximum @returns {value is number} */
function coordinate(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

/** @param {Record<string, unknown>} row @returns {PhotoGps} */
function photoGps(row) {
  if (row.latitude == null || row.longitude == null) return { kind: 'missing-gps' };
  if (!coordinate(row.latitude, -90, 90) || !coordinate(row.longitude, -180, 180)) {
    return { kind: 'invalid-gps' };
  }
  return { kind: 'ready', latitude: row.latitude, longitude: row.longitude };
}

/** @param {string} id @param {Set<string>} seen @param {string} path */
function unique(id, seen, path) {
  if (seen.has(id)) throw new InputError(`${path} must be unique.`);
  seen.add(id);
}

/** @param {unknown} input @returns {{radiusKm: number, photos: Photo[], trips: Trip[]}} */
function validate(input) {
  const root = record(input, 'input');
  if (root.schemaVersion !== 1) throw new InputError('schemaVersion must be 1.');
  const rawPhotos = array(root.photos, 'photos');
  const rawTrips = array(root.trips, 'trips');
  if (rawPhotos.length > PHOTO_TRIP_LIMITS.photos) throw new InputError('photos exceeds the count limit.');
  if (rawTrips.length > PHOTO_TRIP_LIMITS.trips) throw new InputError('trips exceeds the count limit.');
  const radiusKm = root.radiusKm === undefined ? 50 : root.radiusKm;
  if (typeof radiusKm !== 'number' || !Number.isFinite(radiusKm) || radiusKm < 0) {
    throw new InputError('radiusKm must be a finite nonnegative number.');
  }

  const tripIds = new Set();
  /** @type {Trip[]} */
  const trips = [];
  let totalPins = 0;
  for (const [index, item] of rawTrips.entries()) {
    const path = `trips[${index}]`;
    const row = record(item, path);
    const id = identifier(row.id, `${path}.id`);
    unique(id, tripIds, `${path}.id`);
    if (typeof row.name !== 'string') throw new InputError(`${path}.name must be a string.`);
    const rawPins = array(row.pins, `${path}.pins`);
    totalPins += rawPins.length;
    if (totalPins > PHOTO_TRIP_LIMITS.pins) throw new InputError('pins exceeds the total count limit.');
    const pinIds = new Set();
    /** @type {Pin[]} */
    const pins = [];
    for (const [pinIndex, item] of rawPins.entries()) {
      const pinPath = `${path}.pins[${pinIndex}]`;
      const pin = record(item, pinPath);
      const pinId = identifier(pin.id, `${pinPath}.id`);
      unique(pinId, pinIds, `${pinPath}.id`);
      if (!coordinate(pin.latitude, -90, 90) || !coordinate(pin.longitude, -180, 180)) {
        throw new InputError(`${pinPath} must have valid GPS coordinates.`);
      }
      pins.push({ id: pinId, latitude: pin.latitude, longitude: pin.longitude });
    }
    trips.push({ id, name: row.name, pins: pins.sort((a, b) => compareId(a.id, b.id)) });
  }
  if (rawPhotos.length * totalPins > PHOTO_TRIP_LIMITS.comparisons) {
    throw new InputError('photos times total pins exceeds the comparison limit.');
  }

  const photoIds = new Set();
  /** @type {Photo[]} */
  const photos = [];
  for (const [index, item] of rawPhotos.entries()) {
    const path = `photos[${index}]`;
    const row = record(item, path);
    const id = identifier(row.id, `${path}.id`);
    unique(id, photoIds, `${path}.id`);
    photos.push({ id, gps: photoGps(row) });
  }
  return {
    radiusKm: Object.is(radiusKm, -0) ? 0 : radiusKm,
    photos: photos.sort((a, b) => compareId(a.id, b.id)),
    trips: trips.sort((a, b) => compareId(a.id, b.id)),
  };
}

/** @param {string} a @param {string} b @returns {number} */
function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Spherical Haversine in km; eligibility uses the unrounded result.
 * @param {Coordinates} a @param {Coordinates} b @returns {number}
 */
function distanceKm(a, b) {
  const longitudeDelta = ((b.longitude - a.longitude + 540) % 360) - 180;
  if (a.latitude === b.latitude && (longitudeDelta === 0 || Math.abs(a.latitude) === 90)) return 0;
  const toRadians = Math.PI / 180;
  const latitudeDelta = (b.latitude - a.latitude) * toRadians;
  const longitudeRadians = longitudeDelta * toRadians;
  const intermediate = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(a.latitude * toRadians) * Math.cos(b.latitude * toRadians) * Math.sin(longitudeRadians / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, intermediate))));
}

/** Reserve a conservative upper bound for pretty-printed JSON before creating records.
 * A UTF-16 code unit needs at most six JSON UTF-8 bytes (including lone surrogates).
 * Record overhead covers fixed keys, punctuation, numeric values and indentation.
 * Charging at least 256 bytes per record also bounds result object/array growth.
 * @param {{remaining: number}} budget @param {number} overhead @param {...string} values
 */
function reserveManifest(budget, overhead, ...values) {
  let bytes = overhead;
  for (const value of values) bytes += 6 * value.length;
  if (bytes > budget.remaining) throw new InputError('manifest exceeds the conservative output byte budget.');
  budget.remaining -= bytes;
}

/** Build whole-trip photo albums from explicit JSON-like data only.
 * Timestamps, visit dates and other metadata never affect membership or order.
 * A photo can occur in every nearby trip, once per trip with all matching pins.
 * @param {unknown} input @returns {TripManifest}
 */
export function groupPhotosByTrip(input) {
  const { radiusKm, photos, trips } = validate(input);
  const budget = { remaining: PHOTO_TRIP_LIMITS.manifestBytes };
  reserveManifest(budget, 512);
  const tripGroups = trips.map((trip) => {
    reserveManifest(budget, 256, trip.id, trip.name);
    return { trip, group: { tripId: trip.id, name: trip.name, photos: /** @type {GroupedPhoto[]} */ ([]) } };
  });
  /** @type {Overlap[]} */
  const overlaps = [];
  /** @type {UngroupedPhoto[]} */
  const ungrouped = [];

  for (const photo of photos) {
    if (photo.gps.kind !== 'ready') {
      reserveManifest(budget, 256, photo.id);
      ungrouped.push({ photoId: photo.id, reason: photo.gps.kind });
      continue;
    }
    const tripIds = [];
    for (const { trip, group } of tripGroups) {
      /** @type {PinMatch[]} */
      const matchedPins = [];
      for (const pin of trip.pins) {
        const distance = distanceKm(photo.gps, pin);
        if (distance <= radiusKm) {
          if (matchedPins.length === 0) reserveManifest(budget, 256, photo.id);
          reserveManifest(budget, 256, pin.id);
          matchedPins.push({ pinId: pin.id, distanceKm: Number(distance.toFixed(6)) });
        }
      }
      if (matchedPins.length > 0) {
        group.photos.push({ photoId: photo.id, matchedPins });
        tripIds.push(trip.id);
      }
    }
    if (tripIds.length === 0) {
      reserveManifest(budget, 256, photo.id);
      ungrouped.push({ photoId: photo.id, reason: 'no-nearby-trip' });
    }
    if (tripIds.length > 1) {
      reserveManifest(budget, 256, photo.id);
      for (const tripId of tripIds) reserveManifest(budget, 32, tripId);
      overlaps.push({ photoId: photo.id, tripIds });
    }
  }
  return { schemaVersion: 1, radiusKm, groups: tripGroups.map(({ group }) => group), overlaps, ungrouped };
}

/** @param {AsyncIterable<Uint8Array>} input @returns {Promise<unknown>} */
async function readJson(input) {
  let bytes = 0;
  let chunks = 0;
  // One bounded allocation avoids per-fragment retained buffers and metadata.
  const buffer = Buffer.alloc(PHOTO_TRIP_LIMITS.inputBytes);
  for await (const chunk of input) {
    chunks += 1;
    if (chunks > PHOTO_TRIP_LIMITS.inputChunks) throw new InputError('input exceeds the chunk limit.');
    if (chunk.byteLength === 0) continue;
    if (chunk.byteLength > PHOTO_TRIP_LIMITS.inputBytes - bytes) throw new InputError('input exceeds the byte limit.');
    buffer.set(chunk, bytes);
    bytes += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
    return /** @type {unknown} */ (JSON.parse(text));
  } catch {
    throw new InputError('input must be one valid UTF-8 JSON value.');
  }
}

/** Run with caller-supplied streams and writers; no environment or file discovery.
 * @param {CliIo} io @param {readonly string[]} [args] @returns {Promise<number>}
 */
export async function runPhotoTripCli(io, args = []) {
  try {
    if (args.length === 1 && args[0] === '--help') {
      io.writeOutput('Usage: node scripts/burn4-photo-trip-group.mjs < input.json\n' +
        'Input: {schemaVersion:1, radiusKm?:50, photos:[{id,latitude?,longitude?}], trips:[{id,name,pins:[{id,latitude,longitude}]}]}\n' +
        'Outputs GPS-based trip albums; timestamps are unused. Input is limited to 8 MiB and 16384 chunks.\n');
      return 0;
    }
    if (args.length > 0) throw new InputError('unsupported arguments; use --help or provide JSON on stdin.');
    const result = groupPhotosByTrip(await readJson(io.input));
    io.writeOutput(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof InputError ? error.message : 'unable to read or write planner input/output.';
    io.writeError(`photo-trip-group: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runPhotoTripCli({
    input: process.stdin,
    writeOutput: (text) => { process.stdout.write(text); },
    writeError: (text) => { process.stderr.write(text); },
  }, process.argv.slice(2));
}
