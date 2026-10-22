import type * as CheckIn from '@/lib/telemetry/checkIn';
import type * as Constants from '@/lib/telemetry/constants';
import * as versionHelpers from '@/lib/telemetry/version';
import { loadTelemetry } from './burn4-telemetry-vm';

const now = new Date('2026-10-21T13:30:00.000Z');
const endpoint = 'https://collector.invalid/check-in';
const id = '00000000-0000-4000-8000-000000000001';
type FakeResponse = { ok: boolean; status: number; json: jest.Mock };

function collectorResponse(data: unknown = { latestVersion: 'v9.2.0' }, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: jest.fn().mockResolvedValue(data) };
}

function checkIn(options: { env?: Record<string, string | undefined>; enabled?: unknown } = {}) {
  const env = { PRISM_TELEMETRY_URL: endpoint, ...options.env };
  const constants = loadTelemetry<typeof Constants>('constants.ts', {}, { env });
  const readSetting = jest.fn().mockResolvedValue(options.enabled);
  const writeSetting = jest.fn().mockResolvedValue(undefined);
  const getOrCreateInstanceId = jest.fn().mockResolvedValue(id);
  const getDeploymentChannel = jest.fn(() => 'offline-deployment');
  const getTelemetryEndpoint = jest.fn(constants.getTelemetryEndpoint);
  const response = collectorResponse();
  const fetch = jest.fn().mockResolvedValue(response);
  const signal = { syntheticTimeoutSignal: true };
  const timeout = jest.fn(() => signal);
  const api = loadTelemetry<typeof CheckIn>('checkIn.ts', {
    '@/lib/constants': { APP_VERSION: '9.1.0' },
    '@/lib/config/runtime': { getDeploymentChannel },
    './constants': { ...constants, getTelemetryEndpoint },
    './instanceId': { getOrCreateInstanceId },
    './store': { readSetting, writeSetting },
    './version': versionHelpers,
  }, { env, arch: 'offline-cpu', globals: { fetch, AbortSignal: { timeout } } });
  return {
    api, constants, readSetting, writeSetting, getOrCreateInstanceId,
    getDeploymentChannel, getTelemetryEndpoint, fetch, response, timeout, signal,
  };
}

beforeEach(() => jest.useFakeTimers().setSystemTime(now));
afterEach(() => jest.useRealTimers());

describe('telemetry endpoint resolution with synthetic configuration', () => {
  test('unconfigured current master builds are inert', () => {
    const constants = loadTelemetry<typeof Constants>('constants.ts', {});
    expect(constants.getTelemetryEndpoint()).toBe('');
  });

  test('configured endpoints are trimmed without modifying the caller configuration', () => {
    const env = { PRISM_TELEMETRY_URL: `  ${endpoint}\n` };
    const before = { ...env };
    const constants = loadTelemetry<typeof Constants>('constants.ts', {}, { env });
    expect(constants.getTelemetryEndpoint()).toBe(endpoint);
    expect(env).toEqual(before);
  });

  test('whitespace-only endpoint configuration remains inert', async () => {
    const state = checkIn({ env: { PRISM_TELEMETRY_URL: ' \t\n ' } });
    expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: 'no-endpoint' });
    expect(state.getOrCreateInstanceId).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.writeSetting).not.toHaveBeenCalled();
  });
});

describe('telemetry enablement and anonymous payload', () => {
  test.each([undefined, true, null, 'false', 0])('opt-out default remains enabled for stored value %j', async enabled => {
    const state = checkIn({ enabled });
    expect(await state.api.isTelemetryEnabled()).toBe(true);
    expect(state.readSetting).toHaveBeenCalledWith(state.constants.TELEMETRY_SETTING_KEYS.enabled);
  });

  test('an explicit false setting disables checks before endpoint or identity access', async () => {
    const state = checkIn({ enabled: false });
    expect(await state.api.isTelemetryEnabled()).toBe(false);
    expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: 'disabled' });
    expect(state.getTelemetryEndpoint).not.toHaveBeenCalled();
    expect(state.getOrCreateInstanceId).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  test('synthetic hard-disable takes priority and does not read the database', async () => {
    const state = checkIn({ env: { PRISM_DISABLE_TELEMETRY: 'true' } });
    expect(await state.api.isTelemetryEnabled()).toBe(false);
    expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: 'disabled' });
    expect(state.readSetting).not.toHaveBeenCalled();
    expect(state.getTelemetryEndpoint).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  test('synthetic hard-disable false leaves user opt-out effective', async () => {
    const state = checkIn({ env: { PRISM_DISABLE_TELEMETRY: 'false' }, enabled: false });
    expect(await state.api.isTelemetryEnabled()).toBe(false);
    expect(state.readSetting).toHaveBeenCalledTimes(1);
  });

  test('payload has exactly the documented anonymous fields and ignores unrelated configuration', async () => {
    const state = checkIn({ env: { PRIVATE_FIXTURE: 'must-not-be-collected' } });
    const payload = await state.api.buildPayload();
    expect(payload).toEqual({ schema: 1, id, version: '9.1.0', deployment: 'offline-deployment', arch: 'offline-cpu' });
    expect(Object.keys(payload).sort()).toEqual(['arch', 'deployment', 'id', 'schema', 'version']);
    expect(state.getOrCreateInstanceId).toHaveBeenCalledTimes(1);
    expect(state.getDeploymentChannel).toHaveBeenCalledTimes(1);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.writeSetting).not.toHaveBeenCalled();
  });

  test('buildPayload exposes persistence failures to direct callers', async () => {
    const state = checkIn();
    state.getOrCreateInstanceId.mockRejectedValue(new Error('synthetic identity unavailable'));
    await expect(state.api.buildPayload()).rejects.toThrow('synthetic identity unavailable');
    expect(state.getDeploymentChannel).not.toHaveBeenCalled();
  });

  test('enablement read failures remain visible to direct callers', async () => {
    const state = checkIn();
    state.readSetting.mockRejectedValue(new Error('synthetic enabled read failure'));
    await expect(state.api.isTelemetryEnabled()).rejects.toThrow('synthetic enabled read failure');
  });

  test('check-in exports retain the tested version helpers without duplicating their unit matrix', () => {
    const state = checkIn();
    expect(state.api.compareVersions).toBe(versionHelpers.compareVersions);
    expect(state.api.isNotifiableUpdate).toBe(versionHelpers.isNotifiableUpdate);
    expect(state.api.isNotifiableUpdate('9.1.0', '9.2.0')).toBe(true);
    expect(state.api.compareVersions('9.2.0', '9.1.0')).toBe(1);
  });
});

describe('check-in HTTP contract and best-effort reporting', () => {
  test('unconfigured endpoint prevents identity creation, HTTP, and timestamp writes', async () => {
    const state = checkIn({ env: { PRISM_TELEMETRY_URL: undefined } });
    expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: 'no-endpoint' });
    expect(state.getOrCreateInstanceId).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.writeSetting).not.toHaveBeenCalled();
  });

  test('posts only the anonymous JSON payload with a ten-second timeout and records the response', async () => {
    const state = checkIn();
    expect(await state.api.runCheckIn()).toEqual({ sent: true, latestVersion: '9.2.0' });
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch).toHaveBeenCalledWith(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema: 1, id, version: '9.1.0', deployment: 'offline-deployment', arch: 'offline-cpu' }),
      signal: state.signal,
    });
    expect(state.timeout).toHaveBeenCalledWith(10_000);
    expect(state.writeSetting.mock.calls).toEqual([
      [state.constants.TELEMETRY_SETTING_KEYS.latestVersion, '9.2.0'],
      [state.constants.TELEMETRY_SETTING_KEYS.lastCheckAt, now.toISOString()],
    ]);
    expect(state.response.json).toHaveBeenCalledTimes(1);
  });

  test.each([400, 503])('HTTP %s reports failure without reading or persisting collector metadata', async status => {
    const state = checkIn();
    const response = collectorResponse({ latestVersion: 'v99.0.0' }, status);
    state.fetch.mockResolvedValue(response);
    expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: `http-${status}` });
    expect(response.json).not.toHaveBeenCalled();
    expect(state.writeSetting).not.toHaveBeenCalled();
  });

  test.each([{}, { latestVersion: '' }, { latestVersion: null }, { latestVersion: 12 }, null])(
    'successful collector replies without usable version still record the check-in: %j', async data => {
      const state = checkIn();
      state.fetch.mockResolvedValue(collectorResponse(data));
      expect(await state.api.runCheckIn()).toEqual({ sent: true, latestVersion: undefined });
      expect(state.writeSetting.mock.calls).toEqual([
        [state.constants.TELEMETRY_SETTING_KEYS.lastCheckAt, now.toISOString()],
      ]);
    },
  );

  test('invalid collector JSON does not undo a successful check-in', async () => {
    const state = checkIn();
    state.response.json.mockRejectedValue(new SyntaxError('synthetic invalid JSON'));
    expect(await state.api.runCheckIn()).toEqual({ sent: true, latestVersion: undefined });
    expect(state.writeSetting).toHaveBeenCalledWith(state.constants.TELEMETRY_SETTING_KEYS.lastCheckAt, now.toISOString());
  });

  test('failure saving latest version is best effort and does not prevent timestamp persistence', async () => {
    const state = checkIn();
    state.writeSetting.mockRejectedValueOnce(new Error('synthetic latest version write failed'));
    expect(await state.api.runCheckIn()).toEqual({ sent: true, latestVersion: '9.2.0' });
    expect(state.writeSetting.mock.calls.at(-1)).toEqual([
      state.constants.TELEMETRY_SETTING_KEYS.lastCheckAt, now.toISOString(),
    ]);
  });

  test('failure saving final check-in time becomes a result error instead of throwing', async () => {
    const state = checkIn();
    state.writeSetting.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('synthetic timestamp write failed'));
    expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: 'synthetic timestamp write failed' });
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([new Error('synthetic transport failure'), 'synthetic non-Error failure'])(
    'transport failures never escape runCheckIn: %s', async failure => {
      const state = checkIn();
      state.fetch.mockRejectedValue(failure);
      expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: failure instanceof Error ? failure.message : 'error' });
      expect(state.writeSetting).not.toHaveBeenCalled();
    },
  );

  test('synthetic collector timeout is reported without any persistence', async () => {
    const state = checkIn();
    state.fetch.mockImplementation(async (_url, init) => {
      expect(init.signal).toBe(state.signal);
      throw new Error('synthetic timeout');
    });
    expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: 'synthetic timeout' });
    expect(state.timeout).toHaveBeenCalledWith(10_000);
    expect(state.writeSetting).not.toHaveBeenCalled();
  });

  test.each(['enabled', 'identity', 'deployment', 'endpoint', 'timeout'])('%s dependency failures are contained before HTTP', async failing => {
    const state = checkIn();
    const failure = new Error(`synthetic ${failing} failed`);
    if (failing === 'enabled') state.readSetting.mockRejectedValue(failure);
    if (failing === 'identity') state.getOrCreateInstanceId.mockRejectedValue(failure);
    if (failing === 'deployment') state.getDeploymentChannel.mockImplementation(() => { throw failure; });
    if (failing === 'endpoint') state.getTelemetryEndpoint.mockImplementation(() => { throw failure; });
    if (failing === 'timeout') state.timeout.mockImplementation(() => { throw failure; });
    expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: failure.message });
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.writeSetting).not.toHaveBeenCalled();
  });

  test('an opt-out while an earlier check is pending prevents a second HTTP request', async () => {
    const state = checkIn();
    let finish: (value: FakeResponse) => void = () => { throw new Error('synthetic fetch not started'); };
    const started = new Promise<void>(notifyStarted => {
      state.fetch.mockImplementationOnce(() => {
        notifyStarted();
        return new Promise<FakeResponse>(resolve => { finish = resolve; });
      });
    });
    const first = state.api.runCheckIn();
    await started;
    expect(state.fetch).toHaveBeenCalledTimes(1);
    state.readSetting.mockResolvedValue(false);
    expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: 'disabled' });
    expect(state.fetch).toHaveBeenCalledTimes(1);
    finish(collectorResponse());
    expect(await first).toEqual({ sent: true, latestVersion: '9.2.0' });
  });

  test('a failed check does not poison the next explicit attempt', async () => {
    const state = checkIn();
    state.fetch.mockRejectedValueOnce(new Error('synthetic first attempt failed'));
    expect(await state.api.runCheckIn()).toEqual({ sent: false, reason: 'synthetic first attempt failed' });
    expect(await state.api.runCheckIn()).toEqual({ sent: true, latestVersion: '9.2.0' });
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});
