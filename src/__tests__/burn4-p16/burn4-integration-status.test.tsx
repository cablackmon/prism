/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useIntegrationStatus } from '@/app/settings/sections/integrations/shared/useIntegrationStatus';
import { deferred, integrationStatus, response } from './burn4-fixtures';

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  fetchMock.mockReset();
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchMock });
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else Reflect.deleteProperty(globalThis, 'fetch');
});

test('mounts in a loading state, preserves account identities and does not refetch on ordinary rerenders', async () => {
  const pending = deferred<Response>();
  const data = integrationStatus();
  const before = JSON.stringify(data);
  fetchMock.mockReturnValue(pending.promise);
  const { result, rerender } = renderHook(() => useIntegrationStatus());
  const refetch = result.current.refetch;
  expect(result.current.status).toBeNull();
  expect(result.current.loading).toBe(true);
  expect(fetchMock).toHaveBeenCalledWith('/api/integrations/status');
  await act(async () => { pending.resolve(response(data)); });
  expect(result.current.status).toBe(data);
  expect(result.current.status?.google.accountEmails).toBe(data.google.accountEmails);
  expect(result.current.status?.microsoft.shoppingSourceCount).toBe(1);
  expect(result.current.status?.onedrive.accountEmail).toBeNull();
  expect(result.current.status?.gmail.accountEmail).toBe('gmail@example.invalid');
  expect(result.current.loading).toBe(false);
  expect(JSON.stringify(data)).toBe(before);
  rerender();
  expect(result.current.refetch).toBe(refetch);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('refetch keeps the prior status visible while pending and replaces it with the newly returned identity', async () => {
  const first = integrationStatus('first');
  const second = integrationStatus('second');
  fetchMock.mockResolvedValueOnce(response(first));
  const { result } = renderHook(() => useIntegrationStatus());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  let finished!: Promise<void>;
  act(() => { finished = result.current.refetch(); });
  expect(result.current.loading).toBe(true);
  expect(result.current.status).toBe(first);
  await act(async () => { pending.resolve(response(second)); await finished; });
  expect(result.current.loading).toBe(false);
  expect(result.current.status).toBe(second);
  expect(result.current.status?.google.accountEmail).toBe('second@example.invalid');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('a non-success initial response leaves status unknown and does not parse its body', async () => {
  const unavailable = response({ error: 'offline service unavailable' }, false);
  fetchMock.mockResolvedValue(unavailable);
  const { result } = renderHook(() => useIntegrationStatus());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.status).toBeNull();
  expect(unavailable.json).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();
});

test('a non-success refetch retains last known status and settles the loading flag', async () => {
  const data = integrationStatus();
  fetchMock.mockResolvedValueOnce(response(data));
  const { result } = renderHook(() => useIntegrationStatus());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const unavailable = response({ error: 'offline refresh unavailable' }, false);
  fetchMock.mockResolvedValueOnce(unavailable);
  await act(async () => { await result.current.refetch(); });
  expect(result.current.status).toBe(data);
  expect(result.current.loading).toBe(false);
  expect(unavailable.json).not.toHaveBeenCalled();
});

test.each(['transport', 'json'] as const)('a failed initial %s request logs the original failure and exits loading', async (stage) => {
  const failure = new Error(`offline ${stage} failure`);
  if (stage === 'transport') fetchMock.mockRejectedValueOnce(failure);
  else {
    const reply = response(null);
    reply.json.mockRejectedValueOnce(failure);
    fetchMock.mockResolvedValueOnce(reply);
  }
  const { result } = renderHook(() => useIntegrationStatus());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.status).toBeNull();
  expect(errorSpy).toHaveBeenCalledWith('Failed to fetch integration status:', failure);
});

test.each(['transport', 'json'] as const)('a failed %s refresh keeps good data and permits a later successful refresh', async (stage) => {
  const first = integrationStatus('before-error');
  fetchMock.mockResolvedValueOnce(response(first));
  const { result } = renderHook(() => useIntegrationStatus());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const failure = new Error(`offline ${stage} refresh failure`);
  if (stage === 'transport') fetchMock.mockRejectedValueOnce(failure);
  else {
    const reply = response(null);
    reply.json.mockRejectedValueOnce(failure);
    fetchMock.mockResolvedValueOnce(reply);
  }
  await act(async () => { await result.current.refetch(); });
  expect(result.current.status).toBe(first);
  expect(result.current.loading).toBe(false);
  expect(errorSpy).toHaveBeenCalledWith('Failed to fetch integration status:', failure);
  const recovered = integrationStatus('after-error');
  fetchMock.mockResolvedValueOnce(response(recovered));
  await act(async () => { await result.current.refetch(); });
  expect(result.current.status).toBe(recovered);
  expect(result.current.loading).toBe(false);
});

test('keeps status loading until JSON parsing finishes', async () => {
  const parsing = deferred<unknown>();
  const reply = response(null);
  reply.json.mockReturnValueOnce(parsing.promise);
  fetchMock.mockResolvedValueOnce(reply);
  const { result } = renderHook(() => useIntegrationStatus());
  await act(async () => { await Promise.resolve(); });
  expect(reply.json).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBeNull();
  expect(result.current.loading).toBe(true);
  const data = integrationStatus();
  await act(async () => { parsing.resolve(data); });
  expect(result.current.status).toBe(data);
  expect(result.current.loading).toBe(false);
});

test('separate mounted consumers retain their own account data and refetch independently', async () => {
  const firstData = integrationStatus('consumer-a');
  const secondData = integrationStatus('consumer-b');
  fetchMock.mockResolvedValueOnce(response(firstData)).mockResolvedValueOnce(response(secondData));
  const first = renderHook(() => useIntegrationStatus());
  const second = renderHook(() => useIntegrationStatus());
  await waitFor(() => {
    expect(first.result.current.loading).toBe(false);
    expect(second.result.current.loading).toBe(false);
  });
  const refreshed = integrationStatus('consumer-a-new');
  fetchMock.mockResolvedValueOnce(response(refreshed));
  await act(async () => { await first.result.current.refetch(); });
  expect(first.result.current.status).toBe(refreshed);
  expect(second.result.current.status).toBe(secondData);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test.failing('KNOWN GAP: an older integration status request overwrites the newest completed refresh', async () => {
  fetchMock.mockResolvedValueOnce(response(integrationStatus('initial')));
  const { result } = renderHook(() => useIntegrationStatus());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const older = deferred<Response>();
  const newer = deferred<Response>();
  fetchMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => { first = result.current.refetch(); second = result.current.refetch(); });
  const newestData = integrationStatus('newest');
  await act(async () => { newer.resolve(response(newestData)); await second; });
  await act(async () => { older.resolve(response(integrationStatus('stale'))); await first; });
  expect(result.current.status).toBe(newestData);
});

test.failing('KNOWN GAP: an earlier refresh clears loading while the latest integration status request is pending', async () => {
  fetchMock.mockResolvedValueOnce(response(integrationStatus('initial')));
  const { result } = renderHook(() => useIntegrationStatus());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const older = deferred<Response>();
  const newer = deferred<Response>();
  fetchMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => { first = result.current.refetch(); second = result.current.refetch(); });
  await act(async () => { older.resolve(response(integrationStatus('older'))); await first; });
  const loadingWhileLatestPending = result.current.loading;
  await act(async () => { newer.resolve(response(integrationStatus('newest'))); await second; });
  expect(loadingWhileLatestPending).toBe(true);
});
