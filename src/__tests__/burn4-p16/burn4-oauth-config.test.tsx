/** @jest-environment jsdom */
import * as React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useOAuthConfigStatus } from '@/app/settings/sections/integrations/shared/useOAuthConfigStatus';
import { deferred, response } from './burn4-fixtures';

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

test('starts unknown, preserves configured versus unconfigured providers and fetches only once across rerenders', async () => {
  const pending = deferred<Response>();
  const data = { google: true, microsoft: false };
  fetchMock.mockReturnValueOnce(pending.promise);
  const { result, rerender } = renderHook(() => useOAuthConfigStatus());
  expect(result.current).toBeNull();
  expect(fetchMock).toHaveBeenCalledWith('/api/integrations/oauth-status');
  await act(async () => { pending.resolve(response(data)); });
  expect(result.current).toBe(data);
  expect(data).toEqual({ google: true, microsoft: false });
  rerender();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('keeps configuration unknown until its JSON body is ready', async () => {
  const parsing = deferred<unknown>();
  const reply = response(null);
  reply.json.mockReturnValueOnce(parsing.promise);
  fetchMock.mockResolvedValueOnce(reply);
  const { result } = renderHook(() => useOAuthConfigStatus());
  await act(async () => { await Promise.resolve(); });
  expect(reply.json).toHaveBeenCalledTimes(1);
  expect(result.current).toBeNull();
  const data = { google: false, microsoft: true };
  await act(async () => { parsing.resolve(data); });
  expect(result.current).toBe(data);
});

test('an unsuccessful response stays unknown without treating missing configuration as false', async () => {
  const reply = response({ error: 'offline configuration service unavailable' }, false);
  fetchMock.mockResolvedValueOnce(reply);
  const { result } = renderHook(() => useOAuthConfigStatus());
  await act(async () => { await Promise.resolve(); });
  expect(result.current).toBeNull();
  expect(reply.json).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();
});

test.each(['transport', 'json'] as const)('a %s failure logs the original error and leaves configuration unknown', async (stage) => {
  const failure = new Error(`offline OAuth ${stage} failure`);
  if (stage === 'transport') fetchMock.mockRejectedValueOnce(failure);
  else {
    const reply = response(null);
    reply.json.mockRejectedValueOnce(failure);
    fetchMock.mockResolvedValueOnce(reply);
  }
  const { result } = renderHook(() => useOAuthConfigStatus());
  await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to fetch OAuth config status:', failure));
  expect(result.current).toBeNull();
});

test('unmount cancels a late response before parsing its body', async () => {
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  const { unmount } = renderHook(() => useOAuthConfigStatus());
  unmount();
  const late = response({ google: false, microsoft: false });
  await act(async () => { pending.resolve(late); });
  expect(late.json).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(errorSpy).not.toHaveBeenCalled();
});

test('StrictMode effect cleanup prevents the first late response from replacing the active effect configuration', async () => {
  const stale = deferred<Response>();
  const active = deferred<Response>();
  fetchMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(active.promise);
  const { result } = renderHook(() => useOAuthConfigStatus(), {
    wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const current = { google: true, microsoft: true };
  await act(async () => { active.resolve(response(current)); });
  expect(result.current).toBe(current);
  const obsolete = response({ google: false, microsoft: false });
  await act(async () => { stale.resolve(obsolete); });
  expect(result.current).toBe(current);
  expect(obsolete.json).not.toHaveBeenCalled();
});

test('a later mount retries a failed configuration request and does not inherit the prior unknown state', async () => {
  const failure = new Error('offline initial lookup unavailable');
  fetchMock.mockRejectedValueOnce(failure);
  const initial = renderHook(() => useOAuthConfigStatus());
  await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
  expect(initial.result.current).toBeNull();
  initial.unmount();
  const recovered = { google: false, microsoft: false };
  fetchMock.mockResolvedValueOnce(response(recovered));
  const next = renderHook(() => useOAuthConfigStatus());
  await waitFor(() => expect(next.result.current).toBe(recovered));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
