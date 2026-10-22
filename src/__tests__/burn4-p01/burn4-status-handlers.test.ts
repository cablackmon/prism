import { GET as readiness } from '../../app/api/health/ready/route';
import { GET as setupStatus } from '../../app/api/setup/status/route';

const mockExecute = jest.fn<Promise<unknown>, [unknown]>();
const mockPing = jest.fn<Promise<string>, []>();
const mockGetRedisClient = jest.fn<Promise<{ ping: typeof mockPing } | null>, []>();
const mockIsSetupComplete = jest.fn<Promise<boolean>, []>();
const mockSql = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
  text: strings.join('?'), parameters: values,
}));

jest.mock('@/lib/db/client', () => ({ db: { execute: (query: unknown) => mockExecute(query) } }));
jest.mock('@/lib/cache/getRedisClient', () => ({ getRedisClient: () => mockGetRedisClient() }));
jest.mock('@/lib/setup', () => ({ isSetupComplete: () => mockIsSetupComplete() }));
jest.mock('drizzle-orm', () => ({ sql: (strings: TemplateStringsArray, ...values: unknown[]) => mockSql(strings, ...values) }));
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockResolvedValue([]);
  mockPing.mockResolvedValue('PONG');
  mockGetRedisClient.mockResolvedValue({ ping: mockPing });
  mockIsSetupComplete.mockResolvedValue(false);
});

describe('GET health ready with offline database and Redis', () => {
  test('reports ready only after both the read-only database probe and Redis ping succeed', async () => {
    const response = await readiness();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ db: 'ok', redis: 'ok' });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith({ text: 'SELECT 1', parameters: [] });
    expect(mockGetRedisClient).toHaveBeenCalledTimes(1);
    expect(mockPing).toHaveBeenCalledTimes(1);
  });

  test('continues checking Redis after the database probe rejects', async () => {
    mockExecute.mockRejectedValue(new Error('Synthetic private database detail'));
    const response = await readiness();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ db: 'error', redis: 'ok' });
    expect(mockPing).toHaveBeenCalledTimes(1);
  });

  test('reports an unavailable Redis client without attempting a ping', async () => {
    mockGetRedisClient.mockResolvedValue(null);
    const response = await readiness();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ db: 'ok', redis: 'error' });
    expect(mockPing).not.toHaveBeenCalled();
  });

  test('contains Redis connection factory failure without exposing exception details', async () => {
    mockGetRedisClient.mockRejectedValue(new Error('Synthetic private connection detail'));
    const response = await readiness();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ db: 'ok', redis: 'error' });
    expect(mockPing).not.toHaveBeenCalled();
  });

  test('reports a failed Redis ping after a healthy database check', async () => {
    mockPing.mockRejectedValue(new Error('Synthetic ping failure'));
    const response = await readiness();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ db: 'ok', redis: 'error' });
  });

  test('reports both failures and does not leak non-Error rejection values', async () => {
    mockExecute.mockRejectedValue('Synthetic database refusal');
    mockPing.mockRejectedValue({ reason: 'Synthetic Redis refusal' });
    const response = await readiness();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ db: 'error', redis: 'error' });
    expect(mockPing).toHaveBeenCalledTimes(1);
  });

  test('recovers on a later request without retaining previous failure state', async () => {
    mockExecute.mockRejectedValueOnce(new Error('Synthetic temporary database outage'));
    mockGetRedisClient.mockResolvedValueOnce(null);
    const failed = await readiness();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ db: 'error', redis: 'error' });
    const recovered = await readiness();
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ db: 'ok', redis: 'ok' });
  });

  test('awaits each dependency before returning a readiness result', async () => {
    let finishDatabase: (value: unknown) => void = () => { throw new Error('Database probe not started'); };
    let finishPing: (value: string) => void = () => { throw new Error('Ping not started'); };
    const databaseStarted = new Promise<void>((resolveStarted) => {
      mockExecute.mockImplementationOnce(() => new Promise((resolveDatabase) => {
        finishDatabase = resolveDatabase;
        resolveStarted();
      }));
    });
    const pingStarted = new Promise<void>((resolveStarted) => {
      mockPing.mockImplementationOnce(() => new Promise<string>((resolvePing) => {
        finishPing = resolvePing;
        resolveStarted();
      }));
    });
    const settled = jest.fn();
    const pending = readiness().then((response) => { settled(); return response; });
    await databaseStarted;
    expect(mockGetRedisClient).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    finishDatabase([]);
    await pingStarted;
    expect(settled).not.toHaveBeenCalled();
    finishPing('PONG');
    expect((await pending).status).toBe(200);
    expect(settled).toHaveBeenCalledTimes(1);
  });
});

describe('GET setup status delegates to the shared completion policy', () => {
  test.each([true, false])('returns the current completion value %s without duplicating setup queries', async (complete) => {
    mockIsSetupComplete.mockResolvedValue(complete);
    const response = await setupStatus();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ complete });
    expect(mockIsSetupComplete).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockGetRedisClient).not.toHaveBeenCalled();
  });

  test('rechecks completion so a transition out of setup is observable', async () => {
    mockIsSetupComplete.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await (await setupStatus()).json()).toEqual({ complete: false });
    expect(await (await setupStatus()).json()).toEqual({ complete: true });
    expect(mockIsSetupComplete).toHaveBeenCalledTimes(2);
  });

  test('does not return completion data if the shared policy unexpectedly rejects', async () => {
    const error = new Error('Synthetic unexpected policy failure');
    mockIsSetupComplete.mockRejectedValue(error);
    await expect(setupStatus()).rejects.toBe(error);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockGetRedisClient).not.toHaveBeenCalled();
  });

  test('awaits the shared completion policy before creating a response', async () => {
    let finish: (complete: boolean) => void = () => { throw new Error('Policy check not started'); };
    mockIsSetupComplete.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const settled = jest.fn();
    const pending = setupStatus().then((response) => { settled(); return response; });
    expect(settled).not.toHaveBeenCalled();
    finish(false);
    expect(await (await pending).json()).toEqual({ complete: false });
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
