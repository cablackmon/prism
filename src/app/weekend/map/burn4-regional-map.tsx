'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  type ContextLayer,
  type MapPlace,
  type MapView,
} from './burn4-geography';

const coordinate = (n: number, axis: 'lat' | 'lon') =>
  `${Math.abs(n).toFixed(3)}°${n < 0 ? (axis === 'lat' ? 'S' : 'W') : axis === 'lat' ? 'N' : 'E'}`;
const buttonClass =
  'rounded border px-3 py-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2';

export function WeekendRegionalMap() {
  const id = useId().replace(/:/g, '');
  const helpId = `weekend-map-help-${id}`;
  const clipId = `weekend-map-clip-${id}`;
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [view, setView] = useState<MapView>(() => fitPlaces([]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [status, setStatus] = useState('backlog');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [context, setContext] = useState<ContextLayer | null>(null);
  const [contextName, setContextName] = useState('');
  const [contextError, setContextError] = useState('');
  const [contextLoading, setContextLoading] = useState(false);
  const active = useRef(false);
  const requestId = useRef(0);
  const fileId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/weekend/places', {
        signal: next.signal,
        credentials: 'same-origin',
      });
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'Sign in to view Weekend places.'
            : 'Could not load Weekend places. Try again.',
        );
      const data = decodePlaces(await response.json());
      if (!active.current || id !== requestId.current) return;
      setPlaces(data);
      setView(fitPlaces(data.filter((p) => p.status === 'backlog')));
    } catch (e) {
      if (active.current && id === requestId.current && !next.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : 'Could not load Weekend places. Try again.',
        );
    } finally {
      if (active.current && id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      ++requestId.current;
      ++fileId.current;
      controller.current?.abort();
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return places.filter(
      (p) =>
        (status === 'all' || p.status === status) &&
        (!favorites || p.isFavorite) &&
        (!q ||
          [p.name, ...p.tags].some((t) => t.toLocaleLowerCase().includes(q))),
    );
  }, [places, status, favorites, query]);
  const pins = filtered.filter(located);
  const unplaced = filtered.filter((p) => !located(p));
  const selected = filtered.find((p) => p.id === selectedId) ?? null;
  const fit = () => setView(fitPlaces(filtered));
  const move = (east: number, north: number, factor = 1) =>
    setView((v) => moveView(v, east, north, factor));
  const centerSelected = () => {
    if (selected && located(selected))
      setView((v) =>
        normalizeView({
          ...v,
          latitude: selected.latitude,
          longitude: selected.longitude,
        }),
      );
  };
  const fileChange = async (file: File | undefined) => {
    const id = ++fileId.current;
    setContextError('');
    setContextLoading(false);
    if (!file) return;
    if (file.size > CONTEXT_LIMITS.bytes) {
      setContextError('Context file exceeds 512 KiB.');
      return;
    }
    setContextLoading(true);
    try {
      const parsed = parseContext(await file.text());
      if (active.current && id === fileId.current) {
        setContext(parsed);
        setContextName(file.name);
      }
    } catch (e) {
      if (active.current && id === fileId.current)
        setContextError(
          e instanceof Error ? e.message : 'Could not read the context file.',
        );
    } finally {
      if (active.current && id === fileId.current) setContextLoading(false);
    }
  };
  const scaleKm = distanceKm(
    [view.longitude, view.latitude],
    [wrapLongitude(view.longitude + view.longitudeSpan / 5), view.latitude],
  );
  const visiblePins = pins
    .map((place) => ({
      place,
      ...project([place.longitude, place.latitude], view),
    }))
    .filter(
      (p) => p.x >= 0 && p.x <= MAP_WIDTH && p.y >= 0 && p.y <= MAP_HEIGHT,
    );

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <a href="/weekend" className="underline">
        Back to Weekend Ideas
      </a>
      <h1 className="text-2xl font-semibold">Weekend regional map</h1>
      <p>
        Compare places in your outing backlog. The coordinate grid works
        offline; add a local GeoJSON outline for more geographic context.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonClass}
          onClick={() => void load()}
        >
          {loading ? 'Restart loading' : 'Refresh places'}
        </button>
        <label>
          Find name or tag{' '}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="rounded border p-2"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={favorites}
            onChange={(e) => setFavorites(e.target.checked)}
          />{' '}
          Favorites only
        </label>
        <label>
          Places{' '}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border p-2"
          >
            <option value="backlog">Backlog</option>
            <option value="visited">Visited</option>
            <option value="all">All places</option>
          </select>
        </label>
      </div>
      {loading && <p role="status">Loading Weekend places...</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            className={buttonClass}
            onClick={() => void load()}
          >
            Retry
          </button>
        </p>
      )}
      <p aria-live="polite">
        {filtered.length} matching places; {pins.length} with coordinates;{' '}
        {visiblePins.length} pins in view.
      </p>
      {!loading && !error && filtered.length === 0 && (
        <p>
          {places.length
            ? 'No places match these filters.'
            : 'No Weekend places yet. Add places in Weekend Ideas, then refresh.'}
        </p>
      )}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Map controls"
      >
        <button type="button" className={buttonClass} onClick={fit}>
          Fit matching places
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => move(0, 0, 0.5)}
          disabled={view.latitudeSpan <= 0.002 || view.longitudeSpan <= 0.002}
        >
          Zoom in
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => move(0, 0, 2)}
          disabled={view.latitudeSpan >= 180 && view.longitudeSpan >= 360}
        >
          Zoom out
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => move(-0.25, 0)}
        >
          Pan west
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => move(0.25, 0)}
        >
          Pan east
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => move(0, 0.25)}
        >
          Pan north
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => move(0, -0.25)}
        >
          Pan south
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={centerSelected}
          disabled={!selected || !located(selected)}
        >
          Center selected place
        </button>
      </div>
      <p id={helpId}>
        Focus the map and use arrow keys to pan, + or - to zoom, and Home to
        fit. Select a pin with Enter or Space, or use the place list.
      </p>
      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        role="group"
        aria-label="Geographic map of Weekend places"
        aria-describedby={helpId}
        tabIndex={0}
        className="w-full rounded border bg-background focus-visible:outline focus-visible:outline-2"
        style={{ minHeight: 240 }}
        onKeyDown={(event) => {
          const actions: Record<string, () => void> = {
            ArrowLeft: () => move(-0.25, 0),
            ArrowRight: () => move(0.25, 0),
            ArrowUp: () => move(0, 0.25),
            ArrowDown: () => move(0, -0.25),
            '+': () => move(0, 0, 0.5),
            '=': () => move(0, 0, 0.5),
            '-': () => move(0, 0, 2),
            Home: fit,
          };
          if (actions[event.key]) {
            event.preventDefault();
            actions[event.key]!();
          }
        }}
      >
        <title>
          Regional coordinate map with {visiblePins.length} visible place pins
        </title>
        <defs>
          <clipPath id={clipId}>
            <rect width={MAP_WIDTH} height={MAP_HEIGHT} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {Array.from({ length: 9 }, (_, i) => (
            <g key={`lon${i}`}>
              <line
                x1={(i * MAP_WIDTH) / 8}
                x2={(i * MAP_WIDTH) / 8}
                y1={0}
                y2={MAP_HEIGHT}
                stroke="currentColor"
                opacity={0.15}
              />
              <text
                x={(i * MAP_WIDTH) / 8 + 4}
                y={18}
                fontSize={11}
                fill="currentColor"
              >
                {coordinate(
                  wrapLongitude(
                    view.longitude + (i / 8 - 0.5) * view.longitudeSpan,
                  ),
                  'lon',
                )}
              </text>
            </g>
          ))}
          {Array.from({ length: 5 }, (_, i) => (
            <g key={`lat${i}`}>
              <line
                y1={(i * MAP_HEIGHT) / 4}
                y2={(i * MAP_HEIGHT) / 4}
                x1={0}
                x2={MAP_WIDTH}
                stroke="currentColor"
                opacity={0.15}
              />
              <text
                x={4}
                y={Math.max(34, (i * MAP_HEIGHT) / 4 - 6)}
                fontSize={11}
                fill="currentColor"
              >
                {coordinate(
                  view.latitude + (0.5 - i / 4) * view.latitudeSpan,
                  'lat',
                )}
              </text>
            </g>
          ))}
          {context?.lines.map((line, i) => (
            <path
              key={i}
              d={contextPath(line, view)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              opacity={0.55}
            />
          ))}
          {visiblePins.map(({ place, x, y }) => (
            <g
              key={place.id}
              role="button"
              tabIndex={0}
              aria-label={`Select ${place.name} on map`}
              aria-pressed={selected?.id === place.id}
              transform={`translate(${x} ${y})`}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedId(place.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedId(place.id);
                }
              }}
            >
              <circle r={22} fill="transparent" />
              <circle
                r={selected?.id === place.id ? 10 : 7}
                fill={selected?.id === place.id ? '#b45309' : '#0369a1'}
                stroke="white"
                strokeWidth={2}
              />
              <title>{place.name}</title>
            </g>
          ))}
        </g>
        <line
          x1={20}
          x2={20 + MAP_WIDTH / 5}
          y1={MAP_HEIGHT - 25}
          y2={MAP_HEIGHT - 25}
          stroke="currentColor"
          strokeWidth={3}
        />
        <text x={20} y={MAP_HEIGHT - 35} fontSize={12} fill="currentColor">
          {scaleKm < 1
            ? `${Math.round(scaleKm * 1000)} m`
            : `${scaleKm.toFixed(1)} km`}{' '}
          at center latitude
        </text>
      </svg>
      <p data-testid="map-extent">
        Center {coordinate(view.latitude, 'lat')},{' '}
        {coordinate(view.longitude, 'lon')}. Extent{' '}
        {view.latitudeSpan.toFixed(3)}° latitude by{' '}
        {view.longitudeSpan.toFixed(3)}° longitude. North is up.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label="Matching Weekend places">
          <h2 className="text-lg font-semibold">Places</h2>
          <ul>
            {filtered.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  className={`${buttonClass} my-1 w-full text-left`}
                  aria-pressed={selected?.id === place.id}
                  onClick={() => setSelectedId(place.id)}
                >
                  {place.name}
                  {place.isFavorite ? ' (favorite)' : ''}
                  {!located(place) ? ' (no coordinates)' : ''}
                </button>
              </li>
            ))}
          </ul>
          {unplaced.length > 0 && (
            <p>
              {unplaced.length} places need coordinates before they can appear
              as pins.
            </p>
          )}
        </section>
        <section aria-label="Selected place">
          <h2 className="text-lg font-semibold">Selected place</h2>
          {selected ? (
            <>
              <h3 className="font-semibold">{selected.name}</h3>
              {selected.address && <p>{selected.address}</p>}
              {selected.description && <p>{selected.description}</p>}
              <p>{selected.tags.join(', ')}</p>
              {located(selected) ? (
                <>
                  <p>
                    {coordinate(selected.latitude, 'lat')},{' '}
                    {coordinate(selected.longitude, 'lon')}
                  </p>
                  <p>
                    {distanceKm(
                      [view.longitude, view.latitude],
                      [selected.longitude, selected.latitude],
                    ).toFixed(1)}{' '}
                    km from map center
                  </p>
                </>
              ) : (
                <p>
                  This place has no usable coordinates. Add a location in
                  Weekend Ideas.
                </p>
              )}
            </>
          ) : (
            <p>Select a place to see its details.</p>
          )}
        </section>
      </div>
      <section aria-label="Local geographic context" className="space-y-2">
        <h2 className="text-lg font-semibold">Local geographic context</h2>
        <label>
          GeoJSON outline{' '}
          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void fileChange(file);
            }}
          />
        </label>
        <p>
          Polygon, MultiPolygon or LineString; up to 512 KiB and 12,000 points.
          The file stays in this page and is never uploaded.
        </p>
        {contextLoading && <p role="status">Reading geographic context...</p>}
        {contextError && <p role="alert">{contextError}</p>}
        {context && (
          <p>
            {contextName}: {context.points} points.{' '}
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                ++fileId.current;
                setContext(null);
                setContextName('');
                setContextError('');
                setContextLoading(false);
              }}
            >
              Remove context
            </button>
          </p>
        )}
      </section>
    </main>
  );
}
