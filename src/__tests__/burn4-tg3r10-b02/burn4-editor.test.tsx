import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Burn4LocationEditor } from '../../app/weekend/locations/burn4-location-editor';
import Page from '../../app/weekend/locations/page';
import { deferred, first, response, second, suggestion } from './burn4-fixtures';

let http: jest.MockedFunction<typeof fetch>;
beforeEach(() => {
  http = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => { throw new Error('Unexpected mocked HTTP request.'); });
  global.fetch = http;
});
afterEach(cleanup);

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const change = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const patchCalls = () => http.mock.calls.filter((call) => call[1]?.method === 'PATCH');

async function mount() {
  http.mockResolvedValueOnce(response({ places: [first, second] }));
  const view = render(<Burn4LocationEditor />);
  await screen.findByRole('option', { name: first.name });
  return view;
}

function choose(id = first.id) {
  change('Saved place', id);
}

async function search(term = 'River & Trail') {
  await act(async () => {
    change('Search by place name', term);
    click('Search locations');
  });
}

test('page export renders the integrated editor and starts only the same-origin place request', async () => {
  http.mockResolvedValueOnce(response({ places: [] }));
  render(<Page />);
  expect(await screen.findByText('No saved places yet. Add a place in Weekend Ideas first.')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Weekend place locations' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to Weekend Ideas' }).getAttribute('href')).toBe('/weekend');
  expect(http.mock.calls[0]?.[0]).toBe('/api/weekend/places');
  expect(http.mock.calls[0]?.[1]?.credentials).toBe('same-origin');
});

test('loading is announced and unmount aborts a request even if its promise ignores abort', async () => {
  const pending = deferred<Response>();
  http.mockReturnValueOnce(pending.promise);
  const view = render(<Burn4LocationEditor />);
  expect(screen.getByRole('status').textContent).toBe('Loading places...');
  const signal = http.mock.calls[0]?.[1]?.signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(response({ places: [first] })));
  expect(view.container.textContent).toBe('');
});

test('Strict Mode replacement load cannot be overwritten by an abort-insensitive older response', async () => {
  const old = deferred<Response>();
  const current = deferred<Response>();
  http.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<StrictMode><Burn4LocationEditor /></StrictMode>);
  expect(http).toHaveBeenCalledTimes(2);
  expect(http.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => current.resolve(response({ places: [second] })));
  expect(await screen.findByRole('option', { name: second.name })).toBeTruthy();
  await act(async () => old.resolve(response({ places: [first] })));
  expect(screen.queryByRole('option', { name: first.name })).toBeNull();
});

test.each([401, 403, 429, 500])('load HTTP %s is visible and retry loads usable records', async (status) => {
  http.mockResolvedValueOnce(response({}, status)).mockResolvedValueOnce(response({ places: [first] }));
  render(<Burn4LocationEditor />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  click('Retry loading places');
  expect(await screen.findByRole('option', { name: first.name })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

test.each([
  response({ places: null }),
  { ...response(null), json: async () => { throw new Error('Unreadable place response.'); } },
])('malformed place responses remain a retryable failure %#', async (result) => {
  http.mockResolvedValueOnce(result);
  render(<Burn4LocationEditor />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry loading places' })).toBeTruthy();
  expect(screen.queryByLabelText('Saved place')).toBeNull();
});

test('non-Error load failure provides a useful fallback', async () => {
  http.mockRejectedValueOnce(null);
  render(<Burn4LocationEditor />);
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load places. Try again.');
});

test('selection fills only that place, switching and reset discard edits without any write', async () => {
  await mount();
  expect(screen.queryByLabelText('Latitude')).toBeNull();
  choose();
  expect(input('Latitude').value).toBe('40');
  change('Latitude', '12');
  click('Reset unsaved changes');
  expect(input('Latitude').value).toBe('40');
  choose(second.id);
  expect(input('Latitude').value).toBe('');
  expect(input('Address').value).toBe('');
  choose('');
  expect(screen.queryByLabelText('Latitude')).toBeNull();
  expect(patchCalls()).toHaveLength(0);
});

test('manual legitimate zero coordinates save only the four location fields for the selected record', async () => {
  await mount();
  choose();
  change('Latitude', ' 0 ');
  change('Longitude', '-0');
  change('Place name', ' Equator ');
  change('Address', ' New address ');
  expect(patchCalls()).toHaveLength(0);
  http.mockResolvedValueOnce(response({ ...first, latitude: 0, longitude: 0, placeName: 'Equator', address: 'New address' }));
  click('Save location');
  await screen.findByText('Location saved for River Trail.');
  const call = patchCalls()[0];
  expect(call?.[0]).toBe('/api/weekend/places/place-a');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ latitude: 0, longitude: 0, placeName: 'Equator', address: 'New address' });
  expect(call?.[1]?.credentials).toBe('same-origin');
  expect(input('Latitude').value).toBe('0');
  expect(input('Place name').value).toBe('Equator');
});

test('clearing both coordinates explicitly saves nulls without clearing optional text automatically', async () => {
  await mount(); choose();
  change('Latitude', ''); change('Longitude', '');
  http.mockResolvedValueOnce(response({ ...first, latitude: null, longitude: null }));
  click('Save location');
  await screen.findByText('Location saved for River Trail.');
  expect(JSON.parse(String(patchCalls()[0]?.[1]?.body))).toEqual({ latitude: null, longitude: null, placeName: first.placeName, address: first.address });
});

test.each([['', '1'], ['91', '0'], ['NaN', '0'], ['1e2', '0']])('invalid pair %s/%s stays editable and never writes', async (lat, lng) => {
  await mount(); choose();
  change('Latitude', lat); change('Longitude', lng); click('Save location');
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(patchCalls()).toHaveLength(0);
  expect(input('Latitude').value).toBe(lat);
  change('Latitude', '0');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('pending save captures the selected record, blocks duplicate submissions and freezes all draft controls', async () => {
  await mount(); choose();
  const pending = deferred<Response>();
  http.mockReturnValueOnce(pending.promise);
  click('Save location'); click('Save location');
  expect(patchCalls()).toHaveLength(1);
  expect(screen.getByText('Saving location for River Trail...')).toBeTruthy();
  expect((input('Latitude').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  expect(input('Saved place').disabled).toBe(true);
  expect(input('Search by place name').disabled).toBe(true);
  change('Saved place', second.id);
  change('Latitude', '88');
  change('Search by place name', 'Museum');
  expect(input('Saved place').value).toBe(first.id);
  expect(input('Latitude').value).toBe('40');
  expect(input('Search by place name').value).toBe('');
  await act(async () => pending.resolve(response(first)));
  await screen.findByText('Location saved for River Trail.');
  expect(input('Saved place').disabled).toBe(false);
});

test.each([401, 403, 404, 429, 500])('save HTTP %s preserves exact draft and permits an explicit retry', async (status) => {
  await mount(); choose(); change('Address', 'Draft address');
  http.mockResolvedValueOnce(response({}, status)).mockResolvedValueOnce(response({ ...first, address: 'Draft address' }));
  click('Save location');
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(input('Address').value).toBe('Draft address');
  click('Save location');
  await screen.findByText('Location saved for River Trail.');
  expect(patchCalls()).toHaveLength(2);
  expect(patchCalls()[0]?.[1]?.body).toBe(patchCalls()[1]?.[1]?.body);
});

test.each([response(null), response(second), { ...response(null), json: async () => { throw new Error('Bad save response.'); } }])('invalid success response cannot replace the draft %#', async (result) => {
  await mount(); choose(); change('Address', 'Keep this');
  http.mockResolvedValueOnce(result);
  click('Save location');
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(input('Address').value).toBe('Keep this');
  expect(screen.queryByText('Location saved for River Trail.')).toBeNull();
});

test.each(['latitude', 'longitude', 'placeName', 'address'] as const)('same-ID save response with different %s cannot silently discard requested edits', async (field) => {
  await mount(); choose(); change('Address', 'Keep this');
  const saved = { ...first, address: 'Keep this', [field]: field === 'latitude' || field === 'longitude' ? 1 : 'Conflicting text' };
  http.mockResolvedValueOnce(response(saved));
  click('Save location');
  expect((await screen.findByRole('alert')).textContent).toContain('server returned a different location');
  expect(input('Address').value).toBe('Keep this');
  expect(input('Latitude').value).toBe('40');
  expect(screen.queryByText('Location saved for River Trail.')).toBeNull();
});

test('network save failure preserves draft and non-Error rejection has fallback wording', async () => {
  await mount(); choose(); change('Address', 'Keep this');
  http.mockRejectedValueOnce(null);
  click('Save location');
  expect((await screen.findByRole('alert')).textContent).toContain('Your edits are still here.');
  expect(input('Address').value).toBe('Keep this');
});

test('unmount aborts a pending save and late success cannot affect a replacement editor', async () => {
  const view = await mount(); choose();
  const pending = deferred<Response>(); http.mockReturnValueOnce(pending.promise);
  click('Save location');
  const signal = patchCalls()[0]?.[1]?.signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await mount(); choose(second.id);
  await act(async () => pending.resolve(response(first)));
  expect(input('Saved place').value).toBe(second.id);
  expect(input('Latitude').value).toBe('');
  expect(screen.queryByText('Location saved for River Trail.')).toBeNull();
});

test.each(['a', 'a'.repeat(201)])('invalid search length never makes another request %#', async (query) => {
  await mount(); choose(); await search(query);
  expect(screen.getByRole('alert').textContent).toContain('2 to 200');
  expect(http).toHaveBeenCalledTimes(1);
});

test('explicit search safely encodes its query, selecting a result fills draft and waits for explicit Save', async () => {
  await mount(); choose();
  http.mockResolvedValueOnce(response({ results: [suggestion] }));
  await search();
  fireEvent.click(await screen.findByRole('button', { name: /^River Trail East \(0, -12\.5\)/ }));
  expect(http.mock.calls[1]?.[0]).toBe('/api/travel/geocode?q=River%20%26%20Trail');
  expect(input('Latitude').value).toBe('0');
  expect(input('Longitude').value).toBe('-12.5');
  expect(input('Place name').value).toBe(suggestion.displayName);
  expect(input('Address').value).toBe(suggestion.fullName);
  expect(patchCalls()).toHaveLength(0);
});

test('long search addresses are bounded to the persisted field limit when explicitly chosen', async () => {
  await mount(); choose();
  http.mockResolvedValueOnce(response({ results: [{ ...suggestion, fullName: 'a'.repeat(600) }] }));
  await search();
  fireEvent.click(await screen.findByRole('button', { name: /^River Trail East \(0, -12\.5\)/ }));
  expect(input('Address').value).toHaveLength(500);
  expect(screen.getByText('Location filled. The address was shortened to 500 characters. Review the fields and save to apply it.')).toBeTruthy();
});

test('empty search results explain manual coordinate fallback without modifying the draft', async () => {
  await mount(); choose(); change('Address', 'Draft');
  http.mockResolvedValueOnce(response({ results: [] })); await search();
  expect(await screen.findByText('No locations found. Try a more specific name or enter coordinates.')).toBeTruthy();
  expect(input('Address').value).toBe('Draft');
});

test.each([401, 403, 429, 500])('geocode HTTP %s preserves manual edits and supports search retry', async (status) => {
  await mount(); choose(); change('Address', 'Draft');
  http.mockResolvedValueOnce(response({}, status)).mockResolvedValueOnce(response({ results: [suggestion] }));
  await search(); expect(await screen.findByRole('alert')).toBeTruthy();
  expect(input('Address').value).toBe('Draft');
  click('Search locations');
  expect(await screen.findByRole('button', { name: /^River Trail East \(0, -12\.5\)/ })).toBeTruthy();
});

test.each([response({ results: [null] }), response({ wrong: [] })])('malformed search results expose no selectable data %#', async (result) => {
  await mount(); choose(); http.mockResolvedValueOnce(result); await search();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Location search results' })).toBeNull();
});

test('non-Error search rejection provides fallback wording', async () => {
  await mount(); choose(); http.mockRejectedValueOnce(null); await search();
  expect((await screen.findByRole('alert')).textContent).toContain('Could not search locations. Try again.');
});

test('query changes abort the old lookup and stale success cannot replace newer results', async () => {
  await mount(); choose();
  const old = deferred<Response>(); const current = deferred<Response>();
  http.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  await search('Old');
  expect(screen.getByText('Searching locations...')).toBeTruthy();
  await search('New');
  expect(http.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => current.resolve(response({ results: [suggestion] })));
  expect(await screen.findByRole('button', { name: /^River Trail East \(0, -12\.5\)/ })).toBeTruthy();
  await act(async () => old.resolve(response({ results: [{ ...suggestion, displayName: 'Old result' }] })));
  expect(screen.queryByRole('button', { name: /Old result/ })).toBeNull();
});

test('selection changes abort search and stale failure cannot set errors or fields on the new place', async () => {
  await mount(); choose();
  const old = deferred<Response>(); http.mockReturnValueOnce(old.promise); await search();
  choose(second.id);
  expect(http.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => old.reject(new Error('Old lookup failed.')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(input('Latitude').value).toBe('');
  expect(input('Search by place name').value).toBe('');
});

test('save aborts search and a late lookup cannot reintroduce results after saving', async () => {
  await mount(); choose();
  const old = deferred<Response>(); http.mockReturnValueOnce(old.promise); await search();
  http.mockResolvedValueOnce(response(first)); click('Save location');
  await screen.findByText('Location saved for River Trail.');
  expect(http.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => old.resolve(response({ results: [suggestion] })));
  expect(screen.queryByRole('list', { name: 'Location search results' })).toBeNull();
});

test('unmount aborts search even if the pending response ignores cancellation', async () => {
  const view = await mount(); choose();
  const pending = deferred<Response>(); http.mockReturnValueOnce(pending.promise); await search();
  view.unmount();
  expect(http.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(response({ results: [suggestion] })));
  expect(view.container.textContent).toBe('');
});

test('untrusted place names render as text without interpreting HTML', async () => {
  const name = '<img src=x onerror=alert(1)>';
  http.mockResolvedValueOnce(response({ places: [{ ...first, name }] }));
  const view = render(<Burn4LocationEditor />);
  expect(await screen.findByRole('option', { name })).toBeTruthy();
  choose();
  expect(view.container.querySelector('img')).toBeNull();
});
