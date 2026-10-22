import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { WeekendRegionalMap } from '../../app/weekend/map/burn4-regional-map';
import WeekendMapPage from '../../app/weekend/map/page';

const rows = [
  {
    id: 'garden',
    name: 'Garden',
    latitude: 0,
    longitude: 0,
    tags: ['outdoor'],
    address: 'Example square',
    description: '<b>Green space</b>',
    isFavorite: true,
    status: 'backlog',
  },
  {
    id: 'museum',
    name: 'Museum',
    latitude: 1,
    longitude: 1,
    tags: ['indoor'],
    address: '',
    description: '',
    status: 'backlog',
  },
  {
    id: 'cafe',
    name: 'Cafe',
    latitude: null,
    longitude: null,
    tags: ['food'],
    status: 'backlog',
  },
  {
    id: 'old',
    name: 'Old outing',
    latitude: 2,
    longitude: 2,
    tags: [],
    status: 'visited',
  },
];
const response = (data: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }) as Response;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let fetchMock: jest.Mock<Promise<Response>, Parameters<typeof fetch>>;
const readFile = (name: string, text: () => Promise<string>, size = 20): File =>
  Object.assign(
    new File([' '.repeat(size)], name, { type: 'application/geo+json' }),
    { text },
  );
const context = (x = 0) =>
  JSON.stringify({
    type: 'LineString',
    coordinates: [
      [x, 0],
      [x + 1, 1],
    ],
  });
const selectFile = (file: File) =>
  fireEvent.change(screen.getByLabelText('GeoJSON outline'), {
    target: { files: [file] },
  });

beforeEach(() => {
  fetchMock = jest
    .fn<Promise<Response>, Parameters<typeof fetch>>()
    .mockResolvedValue(response({ places: rows }));
  Object.defineProperty(globalThis, 'fetch', {
    value: fetchMock,
    writable: true,
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function loaded() {
  await screen.findByRole('button', { name: 'Garden (favorite)' });
  await waitFor(() =>
    expect(screen.queryByText('Loading Weekend places...')).toBeNull(),
  );
}

test('page route renders the actual regional map and loads exactly the same-origin API', async () => {
  render(<WeekendMapPage />);
  await loaded();
  expect(
    screen.getByRole('heading', { name: 'Weekend regional map' }),
  ).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]![0]).toBe('/api/weekend/places');
  expect(fetchMock.mock.calls[0]![1]).toEqual(
    expect.objectContaining({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    }),
  );
  expect(
    screen.getByText('3 matching places; 2 with coordinates; 2 pins in view.'),
  ).toBeTruthy();
  expect(screen.getByText(/1 places need coordinates/)).toBeTruthy();
  expect(screen.getByTestId('map-extent').textContent).toMatch(
    /Center.*Extent.*North is up/,
  );
  expect(screen.getByText(/km at center latitude/)).toBeTruthy();
});

test('search, favorite and status filters synchronize map and list without requests', async () => {
  render(<WeekendRegionalMap />);
  await loaded();
  fireEvent.change(screen.getByLabelText('Find name or tag'), {
    target: { value: '  OUTDOOR  ' },
  });
  expect(
    screen.getByRole('button', { name: 'Select Garden on map' }),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Museum' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Find name or tag'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByLabelText('Favorites only'));
  expect(screen.queryByRole('button', { name: 'Museum' })).toBeNull();
  fireEvent.click(screen.getByLabelText('Favorites only'));
  fireEvent.change(screen.getByLabelText('Places'), {
    target: { value: 'visited' },
  });
  expect(screen.getByRole('button', { name: 'Old outing' })).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Garden (favorite)' }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText('Places'), {
    target: { value: 'all' },
  });
  expect(
    screen.getByRole('button', { name: 'Garden (favorite)' }),
  ).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('pin keyboard selection and list selection share escaped accessible details', async () => {
  render(<WeekendRegionalMap />);
  await loaded();
  const pin = screen.getByRole('button', { name: 'Select Garden on map' });
  fireEvent.keyDown(pin, { key: 'Enter' });
  expect(pin.getAttribute('aria-pressed')).toBe('true');
  const details = within(
    screen.getByRole('region', { name: 'Selected place' }),
  );
  expect(details.getByText('<b>Green space</b>')).toBeTruthy();
  expect(document.querySelector('b')).toBeNull();
  expect(details.getByText('Example square')).toBeTruthy();
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Select Museum on map' }),
    { key: ' ' },
  );
  expect(details.getByRole('heading', { name: 'Museum' })).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Cafe (no coordinates)' }),
  );
  expect(details.getByText(/no usable coordinates/)).toBeTruthy();
  expect(
    (
      screen.getByRole('button', {
        name: 'Center selected place',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Find name or tag'), {
    target: { value: 'Garden' },
  });
  expect(details.getByText('Select a place to see its details.')).toBeTruthy();
});

test('real controls pan, zoom, center and reset geographic extent', async () => {
  render(<WeekendRegionalMap />);
  await loaded();
  const extent = () => screen.getByTestId('map-extent').textContent;
  const initial = extent();
  fireEvent.click(screen.getByRole('button', { name: 'Pan east' }));
  expect(extent()).not.toBe(initial);
  fireEvent.click(screen.getByRole('button', { name: 'Pan west' }));
  expect(extent()).toBe(initial);
  fireEvent.click(screen.getByRole('button', { name: 'Pan north' }));
  expect(extent()).not.toBe(initial);
  fireEvent.click(screen.getByRole('button', { name: 'Pan south' }));
  expect(extent()).toBe(initial);
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(extent()).not.toBe(initial);
  fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
  expect(extent()).toBe(initial);
  fireEvent.click(screen.getByRole('button', { name: 'Garden (favorite)' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Center selected place' }),
  );
  expect(extent()).toContain('Center 0.000°N, 0.000°E');
  expect(screen.getByText('0.0 km from map center')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fit matching places' }));
  expect(extent()).toBe(initial);
  const map = screen.getByRole('group', {
    name: 'Geographic map of Weekend places',
  });
  for (const key of [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    '+',
    '-',
    '=',
  ])
    fireEvent.keyDown(map, { key });
  expect(extent()).not.toBe(initial);
  fireEvent.keyDown(map, { key: 'Home' });
  expect(extent()).toBe(initial);
  fireEvent.keyDown(map, { key: 'Escape' });
  expect(extent()).toBe(initial);
});

test('panning updates visible pin count and fit recovers pins for new filters', async () => {
  render(<WeekendRegionalMap />);
  await loaded();
  for (let i = 0; i < 6; i++)
    fireEvent.click(screen.getByRole('button', { name: 'Pan east' }));
  expect(
    screen.queryByRole('button', { name: 'Select Garden on map' }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Fit matching places' }));
  expect(
    screen.getByRole('button', { name: 'Select Garden on map' }),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Find name or tag'), {
    target: { value: 'absent' },
  });
  expect(screen.getByText('No places match these filters.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fit matching places' }));
  expect(
    (screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

test.each([401, 403, 500])(
  'shows HTTP failure %s and retries without running any provider',
  async (status) => {
    fetchMock.mockResolvedValueOnce(response({}, status));
    render(<WeekendRegionalMap />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(
      status < 500 ? /Sign in/ : /Could not load/,
    );
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await loaded();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  },
);

test('handles empty, malformed, JSON decode and network errors and preserves loaded places', async () => {
  fetchMock.mockResolvedValueOnce(response({ places: [] }));
  render(<WeekendRegionalMap />);
  await screen.findByText(/No Weekend places yet/);
  fetchMock.mockResolvedValueOnce(response({ places: null }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh places' }));
  await screen.findByText(/places response is not valid/);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await loaded();
  fetchMock.mockResolvedValueOnce(
    Object.assign(response({}), {
      json: async () => {
        throw new Error('Unreadable JSON');
      },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh places' }));
  await screen.findByText('Unreadable JSON');
  expect(
    screen.getByRole('button', { name: 'Garden (favorite)' }),
  ).toBeTruthy();
  fetchMock.mockRejectedValueOnce('network failure');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText(/Could not load Weekend places/);
});

test('new refresh aborts older request and ignores its later JSON response or failure', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const firstJson = deferred<unknown>();
  fetchMock
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(<WeekendRegionalMap />);
  const oldSignal = fetchMock.mock.calls[0]![1]!.signal!;
  await act(async () => {
    first.resolve({
      ok: true,
      status: 200,
      json: () => firstJson.promise,
    } as Response);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Restart loading' }));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => {
    second.resolve(response({ places: rows }));
  });
  await loaded();
  await act(async () => {
    firstJson.resolve({ places: [{ id: 'stale', name: 'Stale' }] });
  });
  expect(
    screen.queryByRole('button', { name: 'Stale (no coordinates)' }),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Garden (favorite)' }),
  ).toBeTruthy();
});

test('unmount aborts the active request and prevents stale callbacks after remount', async () => {
  const old = deferred<Response>();
  fetchMock.mockReturnValueOnce(old.promise);
  const mounted = render(<WeekendRegionalMap />);
  const signal = fetchMock.mock.calls[0]![1]!.signal!;
  mounted.unmount();
  expect(signal.aborted).toBe(true);
  render(<WeekendRegionalMap />);
  await loaded();
  await act(async () => {
    old.reject(new Error('late failure'));
  });
  expect(screen.queryByText('late failure')).toBeNull();
});

test('independent map instances keep requests, selected places and accessibility IDs separate', async () => {
  const { container } = render(
    <>
      <WeekendRegionalMap />
      <WeekendRegionalMap />
    </>,
  );
  await screen.findAllByRole('button', { name: 'Garden (favorite)' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const clips = Array.from(container.querySelectorAll('clipPath')).map(
    (p) => p.id,
  );
  expect(new Set(clips).size).toBe(2);
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Garden (favorite)' })[0]!,
  );
  const regions = screen.getAllByRole('region', { name: 'Selected place' });
  expect(
    within(regions[0]!).getByRole('heading', { name: 'Garden' }),
  ).toBeTruthy();
  expect(
    within(regions[1]!).getByText('Select a place to see its details.'),
  ).toBeTruthy();
});

test('local context imports a path, uses file names as safe text, and removes it without requests', async () => {
  const { container } = render(<WeekendRegionalMap />);
  await loaded();
  selectFile(readFile('<b>outline</b>.geojson', async () => context()));
  await screen.findByText('<b>outline</b>.geojson: 2 points.', {
    exact: false,
  });
  expect(container.querySelectorAll('svg path')).toHaveLength(1);
  expect(container.querySelector('b')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Pan east' }));
  expect(container.querySelector('svg path')!.getAttribute('d')).toContain('M');
  fireEvent.click(screen.getByRole('button', { name: 'Remove context' }));
  expect(container.querySelector('svg path')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('invalid, oversized and unreadable local files preserve the accepted context', async () => {
  const { container } = render(<WeekendRegionalMap />);
  await loaded();
  selectFile(readFile('good.geojson', async () => context()));
  await screen.findByText(/good.geojson: 2 points/);
  const accepted = container.querySelector('svg path')!.getAttribute('d');
  selectFile(readFile('bad.geojson', async () => '{}'));
  await screen.findByRole('alert');
  expect(container.querySelector('svg path')!.getAttribute('d')).toBe(accepted);
  const oversized = readFile(
    'large.geojson',
    async () => context(),
    512 * 1024 + 1,
  );
  const text = jest.spyOn(oversized, 'text');
  selectFile(oversized);
  await screen.findByText(/exceeds 512 KiB/);
  expect(text).not.toHaveBeenCalled();
  selectFile(
    readFile('unreadable.geojson', async () => {
      throw new Error('File read failed');
    }),
  );
  await screen.findByText('File read failed');
  expect(container.querySelector('svg path')!.getAttribute('d')).toBe(accepted);
});

test('stale local file completion and rejection cannot replace newer context or clear its loading state', async () => {
  render(<WeekendRegionalMap />);
  await loaded();
  const old = deferred<string>();
  const current = deferred<string>();
  selectFile(readFile('old.geojson', () => old.promise));
  selectFile(readFile('new.geojson', () => current.promise));
  await act(async () => {
    old.reject(new Error('old read failure'));
  });
  expect(screen.queryByText('old read failure')).toBeNull();
  expect(screen.getByText('Reading geographic context...')).toBeTruthy();
  await act(async () => {
    current.resolve(context(2));
  });
  await screen.findByText(/new.geojson: 2 points/);
  const stale = deferred<string>();
  selectFile(readFile('stale.geojson', () => stale.promise));
  fireEvent.click(screen.getByRole('button', { name: 'Remove context' }));
  await act(async () => {
    stale.resolve(context(3));
  });
  expect(screen.queryByRole('button', { name: 'Remove context' })).toBeNull();
});
