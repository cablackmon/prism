export interface MapPlace {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
  description: string;
  tags: string[];
  isFavorite: boolean;
  status: 'backlog' | 'visited';
}
export interface MapView {
  latitude: number;
  longitude: number;
  latitudeSpan: number;
  longitudeSpan: number;
}
export type Position = readonly [number, number];
export interface ContextLayer {
  lines: Position[][];
  points: number;
}
export const MAP_WIDTH = 800;
export const MAP_HEIGHT = 420;
export const CONTEXT_LIMITS = Object.freeze({
  bytes: 512 * 1024,
  geometries: 128,
  rings: 512,
  points: 12000,
  work: 16000,
});
const MIN_SPAN = 0.002;
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
export const wrapLongitude = (n: number): number =>
  ((((n + 180) % 360) + 360) % 360) - 180;

export function decodePlaces(value: unknown): MapPlace[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('places' in value) ||
    !Array.isArray(value.places) ||
    value.places.length > 5000
  )
    throw new Error('The places response is not valid.');
  const ids = new Set<string>();
  const text = (v: unknown, limit: number) =>
    typeof v === 'string' ? v.slice(0, limit) : '';
  return value.places.map((row: unknown) => {
    if (!row || typeof row !== 'object')
      throw new Error('The places response is not valid.');
    const p = row as Record<string, unknown>;
    if (
      typeof p.id !== 'string' ||
      !p.id ||
      p.id.length > 255 ||
      ids.has(p.id) ||
      typeof p.name !== 'string' ||
      !p.name.trim() ||
      p.name.length > 255
    )
      throw new Error('The places response is not valid.');
    ids.add(p.id);
    const positioned =
      finite(p.latitude) &&
      Math.abs(p.latitude) <= 90 &&
      finite(p.longitude) &&
      Math.abs(p.longitude) <= 180;
    return {
      id: p.id,
      name: p.name,
      latitude: positioned ? (p.latitude as number) : null,
      longitude: positioned ? (p.longitude as number) : null,
      address: text(p.address, 500),
      description: text(p.description, 5000),
      tags: Array.isArray(p.tags)
        ? p.tags
            .slice(0, 100)
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.slice(0, 100))
        : [],
      isFavorite: p.isFavorite === true,
      status: p.status === 'visited' ? 'visited' : 'backlog',
    };
  });
}

export function located(
  place: MapPlace,
): place is MapPlace & { latitude: number; longitude: number } {
  return (
    finite(place.latitude) &&
    Math.abs(place.latitude) <= 90 &&
    finite(place.longitude) &&
    Math.abs(place.longitude) <= 180
  );
}

export function normalizeView(view: MapView): MapView {
  if (
    ![
      view.latitude,
      view.longitude,
      view.latitudeSpan,
      view.longitudeSpan,
    ].every(Number.isFinite)
  )
    throw new Error('Map extent must be finite.');
  const latitudeSpan = clamp(view.latitudeSpan, MIN_SPAN, 180);
  return {
    latitude: clamp(
      view.latitude,
      -90 + latitudeSpan / 2,
      90 - latitudeSpan / 2,
    ),
    longitude: wrapLongitude(view.longitude),
    latitudeSpan,
    longitudeSpan: clamp(view.longitudeSpan, MIN_SPAN, 360),
  };
}

export function fitPlaces(places: readonly MapPlace[]): MapView {
  const points = places.filter(located);
  if (!points.length)
    return { latitude: 0, longitude: 0, latitudeSpan: 180, longitudeSpan: 360 };
  const lons = points
    .map((p) => (p.longitude + 360) % 360)
    .sort((a, b) => a - b);
  let gap = -1;
  let start = lons[0]!;
  for (let i = 0; i < lons.length; i++) {
    const next = i + 1 === lons.length ? lons[0]! + 360 : lons[i + 1]!;
    if (next - lons[i]! > gap) {
      gap = next - lons[i]!;
      start = next % 360;
    }
  }
  const latitudeMin = Math.min(...points.map((p) => p.latitude));
  const latitudeMax = Math.max(...points.map((p) => p.latitude));
  const latitude = (latitudeMin + latitudeMax) / 2;
  const cos = Math.max(0.05, Math.cos((latitude * Math.PI) / 180));
  let latitudeSpan = Math.max(0.04, (latitudeMax - latitudeMin) * 1.3);
  const longitudeSpan = Math.min(
    360,
    Math.max(
      0.08,
      (360 - gap) * 1.3,
      (latitudeSpan * MAP_WIDTH) / MAP_HEIGHT / cos,
    ),
  );
  latitudeSpan = Math.max(
    latitudeSpan,
    (longitudeSpan * cos * MAP_HEIGHT) / MAP_WIDTH,
  );
  return normalizeView({
    latitude,
    longitude: start + (360 - gap) / 2,
    latitudeSpan,
    longitudeSpan,
  });
}

export function moveView(
  view: MapView,
  east: number,
  north: number,
  factor = 1,
): MapView {
  if (![east, north, factor].every(Number.isFinite) || factor <= 0)
    throw new Error('Invalid map movement.');
  return normalizeView({
    latitude: view.latitude + north * view.latitudeSpan,
    longitude: view.longitude + east * view.longitudeSpan,
    latitudeSpan: view.latitudeSpan * factor,
    longitudeSpan: view.longitudeSpan * factor,
  });
}

export function project(
  position: Position,
  view: MapView,
): { x: number; y: number } {
  return {
    x:
      MAP_WIDTH *
      (0.5 + wrapLongitude(position[0] - view.longitude) / view.longitudeSpan),
    y: MAP_HEIGHT * (0.5 - (position[1] - view.latitude) / view.latitudeSpan),
  };
}

export function distanceKm(a: Position, b: Position): number {
  const radians = (n: number) => (n * Math.PI) / 180;
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(wrapLongitude(b[0] - a[0]));
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

export function contextPath(line: readonly Position[], view: MapView): string {
  let previous: number | null = null;
  return line
    .map((point) => {
      const p = project(point, view);
      const command =
        previous === null ||
        Math.abs(p.x - previous) > (MAP_WIDTH * 180) / view.longitudeSpan
          ? 'M'
          : 'L';
      previous = p.x;
      return `${command}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(' ');
}

export function parseContext(text: string): ContextLayer {
  // File.size bounds bytes before reading; this bound also protects direct callers.
  if (
    text.length > CONTEXT_LIMITS.bytes ||
    new Blob([text]).size > CONTEXT_LIMITS.bytes
  )
    throw new Error('Context file exceeds 512 KiB.');
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error('Context must be valid GeoJSON.');
  }
  const lines: Position[][] = [];
  let geometries = 0;
  let points = 0;
  let work = 0;
  const consume = () => {
    if (++work > CONTEXT_LIMITS.work)
      throw new Error('Context is too complex.');
  };
  const object = (value: unknown): Record<string, unknown> => {
    consume();
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid GeoJSON object.');
    return value as Record<string, unknown>;
  };
  const line = (value: unknown, ring: boolean) => {
    consume();
    if (
      !Array.isArray(value) ||
      value.length < (ring ? 4 : 2) ||
      lines.length >= CONTEXT_LIMITS.rings
    )
      throw new Error('Invalid or excessive GeoJSON lines.');
    const coordinates: Position[] = [];
    for (const p of value) {
      consume();
      if (
        ++points > CONTEXT_LIMITS.points ||
        !Array.isArray(p) ||
        p.length !== 2 ||
        !finite(p[0]) ||
        !finite(p[1]) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 90
      )
        throw new Error('Invalid or excessive GeoJSON coordinates.');
      coordinates.push([p[0], p[1]]);
    }
    if (
      ring &&
      (coordinates[0]![0] !== coordinates.at(-1)![0] ||
        coordinates[0]![1] !== coordinates.at(-1)![1])
    )
      throw new Error('GeoJSON polygon rings must close.');
    lines.push(coordinates);
  };
  const polygon = (value: unknown) => {
    consume();
    if (!Array.isArray(value) || !value.length)
      throw new Error('Invalid GeoJSON polygon.');
    for (const ring of value) line(ring, true);
  };
  const geometry = (value: unknown) => {
    const g = object(value);
    if (++geometries > CONTEXT_LIMITS.geometries)
      throw new Error('Too many GeoJSON geometries.');
    if (g.type === 'LineString') line(g.coordinates, false);
    else if (g.type === 'Polygon') polygon(g.coordinates);
    else if (g.type === 'MultiPolygon') {
      if (!Array.isArray(g.coordinates) || !g.coordinates.length)
        throw new Error('Invalid GeoJSON multipolygon.');
      for (const poly of g.coordinates) polygon(poly);
    } else throw new Error('Use Polygon, MultiPolygon or LineString context.');
  };
  const r = object(root);
  if (r.type === 'FeatureCollection') {
    if (
      !Array.isArray(r.features) ||
      r.features.length > CONTEXT_LIMITS.geometries
    )
      throw new Error('Invalid or excessive GeoJSON features.');
    for (const feature of r.features) {
      const f = object(feature);
      if (f.type !== 'Feature') throw new Error('Invalid GeoJSON feature.');
      geometry(f.geometry);
    }
  } else if (r.type === 'Feature') geometry(r.geometry);
  else geometry(r);
  if (!lines.length) throw new Error('Context contains no geographic lines.');
  return { lines, points };
}
