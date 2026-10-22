import {
  CONTEXT_LIMITS,
  MAP_HEIGHT,
  MAP_WIDTH,
  contextPath,
  decodePlaces,
  distanceKm,
  fitPlaces,
  located,
  moveView,
  normalizeView,
  parseContext,
  project,
  wrapLongitude,
  type MapPlace,
} from '../../app/weekend/map/burn4-geography';

const place = (
  longitude: number | null,
  latitude: number | null,
): MapPlace => ({
  id: 'a',
  name: 'Garden',
  longitude,
  latitude,
  address: '',
  description: '',
  tags: [],
  isFavorite: false,
  status: 'backlog',
});
const line = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [1, 1],
  ],
};
const ring = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 0],
];

describe('place snapshot and geographic operations', () => {
  test('copies allowlisted fields, keeps zero coordinates and bounds optional text/tags', () => {
    const row = {
      ...place(0, 0),
      address: 'a'.repeat(800),
      description: 'd'.repeat(6000),
      tags: ['garden', 1, ...Array(110).fill('long'.repeat(50))],
      extra: 'ignored',
      status: 'visited',
    };
    const result = decodePlaces({ places: [row] })[0]!;
    expect(result.longitude).toBe(0);
    expect(result.latitude).toBe(0);
    expect(result.status).toBe('visited');
    expect(result.address).toHaveLength(500);
    expect(result.description).toHaveLength(5000);
    expect(result.tags).toHaveLength(99);
    expect(result.tags[1]).toHaveLength(100);
    expect(result).not.toHaveProperty('extra');
    result.tags.push('new');
    expect(row.tags).not.toContain('new');
  });
  test.each([
    null,
    {},
    { places: {} },
    { places: Array(5001).fill({}) },
    { places: [null] },
    { places: [{ id: '', name: 'x' }] },
    { places: [{ id: 'x', name: ' ' }] },
    { places: [place(1, 1), place(2, 2)] },
  ])('rejects malformed snapshot %#', (value) => {
    expect(() => decodePlaces(value)).toThrow('not valid');
  });
  test('leaves absent and out-of-range coordinates unplaced without losing the place', () => {
    const decoded = decodePlaces({
      places: [
        { id: 'a', name: 'A', latitude: 91, longitude: 0 },
        { id: 'b', name: 'B', latitude: 0, longitude: '0' },
        { id: 'c', name: 'C' },
      ],
    });
    expect(decoded.every((p) => !located(p))).toBe(true);
    expect(decoded[0]!.name).toBe('A');
    expect(located(place(0, 0))).toBe(true);
    expect(located(place(180, 90))).toBe(true);
    expect(located(place(Infinity, 0))).toBe(false);
    expect(located(place(181, 0))).toBe(false);
  });
  test('uses a world extent for empty input and fits a zero-coordinate singleton', () => {
    expect(fitPlaces([])).toEqual({
      latitude: 0,
      longitude: 0,
      latitudeSpan: 180,
      longitudeSpan: 360,
    });
    const v = fitPlaces([place(0, 0)]);
    expect(v.longitudeSpan).toBeGreaterThan(0);
    expect(project([0, 0], v)).toEqual({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 });
  });
  test('fits a narrow antimeridian region and includes all extremes', () => {
    const places = [place(179, 10), place(-179, 11), place(178, 9)];
    const view = fitPlaces(places);
    expect(view.longitudeSpan).toBeLessThan(10);
    expect(Math.abs(view.longitude)).toBeGreaterThan(175);
    for (const p of places) {
      const pt = project([p.longitude!, p.latitude!], view);
      expect(pt.x).toBeGreaterThanOrEqual(0);
      expect(pt.x).toBeLessThanOrEqual(MAP_WIDTH);
      expect(pt.y).toBeGreaterThanOrEqual(0);
      expect(pt.y).toBeLessThanOrEqual(MAP_HEIGHT);
    }
  });
  test('handles duplicate coordinates, poles and both endpoint longitude aliases', () => {
    for (const places of [
      [place(180, 90)],
      [place(-180, -90)],
      [place(10, 20), place(10, 20)],
    ]) {
      const v = fitPlaces(places);
      expect(v.latitudeSpan).toBeGreaterThan(0);
      expect(v.longitudeSpan).toBeLessThanOrEqual(360);
      for (const p of places) {
        const xy = project([p.longitude!, p.latitude!], v);
        expect(xy.y).toBeGreaterThanOrEqual(-0.00001);
        expect(xy.y).toBeLessThanOrEqual(MAP_HEIGHT + 0.00001);
      }
    }
    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(540)).toBe(-180);
    expect(wrapLongitude(-541)).toBe(179);
  });
  test('pan wraps longitude, clamps latitude and zooms within hard limits', () => {
    const start = {
      longitude: 179,
      latitude: 0,
      longitudeSpan: 20,
      latitudeSpan: 10,
    };
    expect(moveView(start, 1, 1)).toEqual({
      longitude: -161,
      latitude: 10,
      longitudeSpan: 20,
      latitudeSpan: 10,
    });
    const far = moveView(start, 0, 1000, 0.00001);
    expect(far.latitude).toBeLessThan(90);
    expect(far.latitudeSpan).toBe(0.002);
    expect(moveView(start, 0, 0, 1000)).toEqual({
      longitude: 179,
      latitude: 0,
      longitudeSpan: 360,
      latitudeSpan: 180,
    });
    expect(() => normalizeView({ ...start, latitude: NaN })).toThrow('finite');
    expect(() => moveView(start, 0, 0, 0)).toThrow('movement');
  });
  test('distance uses shortest dateline separation and antipodal numerical clamp', () => {
    expect(distanceKm([0, 0], [0, 0])).toBe(0);
    expect(distanceKm([0, 0], [1, 0])).toBeCloseTo(111.195, 2);
    expect(distanceKm([179, 0], [-179, 0])).toBeCloseTo(222.39, 1);
    expect(distanceKm([0, 0], [180, 0])).toBeCloseTo(20015.087, 2);
  });
  test('context paths break at projection seams instead of drawing a whole-world segment', () => {
    expect(
      contextPath(
        [
          [179, 0],
          [-179, 0],
        ],
        fitPlaces([]),
      ).match(/M/g),
    ).toHaveLength(2);
    expect(
      contextPath(
        [
          [179, 0],
          [-179, 0],
        ],
        fitPlaces([place(179, 0), place(-179, 0)]),
      ),
    ).toContain(' L');
  });
});

describe('bounded local geographic context', () => {
  test('accepts direct lines, polygons with holes, multipolygons and feature wrappers', () => {
    expect(parseContext(JSON.stringify(line))).toEqual({
      lines: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
      points: 2,
    });
    expect(
      parseContext(
        JSON.stringify({ type: 'Polygon', coordinates: [ring, ring] }),
      ).lines,
    ).toHaveLength(2);
    expect(
      parseContext(
        JSON.stringify({
          type: 'Feature',
          properties: { title: '<b>ignored</b>' },
          geometry: { type: 'MultiPolygon', coordinates: [[ring], [ring]] },
        }),
      ).points,
    ).toBe(8);
    expect(
      parseContext(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: line }],
        }),
      ).points,
    ).toBe(2);
  });
  test.each([
    'bad json',
    'null',
    '[]',
    JSON.stringify({ type: 'Point', coordinates: [1, 1] }),
    JSON.stringify({ type: 'FeatureCollection', features: [] }),
    JSON.stringify({ type: 'FeatureCollection', features: [line] }),
    JSON.stringify({ type: 'LineString', coordinates: [[0, 0]] }),
    JSON.stringify({
      type: 'LineString',
      coordinates: [
        [181, 0],
        [0, 0],
      ],
    }),
    JSON.stringify({
      type: 'LineString',
      coordinates: [
        [0, 0, 1],
        [0, 0],
      ],
    }),
    JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [2, 2],
          [1, 0],
        ],
      ],
    }),
    JSON.stringify({ type: 'MultiPolygon', coordinates: [] }),
  ])('rejects malformed context %#', (input) =>
    expect(() => parseContext(input)).toThrow(),
  );
  test('caps input bytes, including multibyte input', () => {
    expect(() => parseContext(' '.repeat(CONTEXT_LIMITS.bytes + 1))).toThrow(
      '512 KiB',
    );
    expect(() =>
      parseContext('é'.repeat(CONTEXT_LIMITS.bytes / 2 + 1)),
    ).toThrow('512 KiB');
  });
  test('caps geometries, rings and points, and rejects empty multipolygons', () => {
    expect(() =>
      parseContext(
        JSON.stringify({
          type: 'FeatureCollection',
          features: Array(129).fill({ type: 'Feature', geometry: line }),
        }),
      ),
    ).toThrow();
    expect(() =>
      parseContext(
        JSON.stringify({ type: 'Polygon', coordinates: Array(513).fill(ring) }),
      ),
    ).toThrow();
    expect(() =>
      parseContext(
        JSON.stringify({
          type: 'LineString',
          coordinates: Array(12001).fill([0, 0]),
        }),
      ),
    ).toThrow();
    expect(() =>
      parseContext(
        JSON.stringify({
          type: 'MultiPolygon',
          coordinates: Array(16001).fill([]),
        }),
      ),
    ).toThrow();
  });
});
