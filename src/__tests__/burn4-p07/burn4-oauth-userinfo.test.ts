import {
  fetchGoogleAccountEmail,
  fetchGmailAccountEmail,
  fetchMicrosoftAccountEmail,
} from '@/lib/integrations/oauth-userinfo';
import { logError } from '@/lib/utils/logError';

jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));

const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
const mockLogError = jest.mocked(logError);
const FIXTURE_AUTH = 'fixture-only';

const providers = [
  {
    name: 'Google', call: fetchGoogleAccountEmail, field: 'email',
    url: 'https://www.googleapis.com/oauth2/v2/userinfo',
    failureLabel: 'fetchGoogleAccountEmail failed (non-fatal):',
  },
  {
    name: 'Gmail', call: fetchGmailAccountEmail, field: 'emailAddress',
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    failureLabel: 'fetchGmailAccountEmail failed (non-fatal):',
  },
  {
    name: 'Microsoft', call: fetchMicrosoftAccountEmail, field: 'mail',
    url: 'https://graph.microsoft.com/v1.0/me',
    failureLabel: 'fetchMicrosoftAccountEmail failed (non-fatal):',
  },
];

function response(payload: unknown, ok = true): Response {
  return { ok, json: jest.fn().mockResolvedValue(payload) } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset().mockRejectedValue(new Error('Unexpected mocked profile request'));
  mockLogError.mockReset();
  jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(providers)('$name account profile', ({ call, field, url, failureLabel }) => {
  test('uses its own provider endpoint and lowercases the returned address without changing the payload', async () => {
    const payload = Object.freeze({ [field]: 'FAMILY.Member@Example.INVALID', unrelated: 'kept' });
    const res = response(payload);
    mockFetch.mockResolvedValue(res);

    await expect(call(FIXTURE_AUTH)).resolves.toBe('family.member@example.invalid');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(url, { headers: { Authorization: `Bearer ${FIXTURE_AUTH}` } });
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(payload[field]).toBe('FAMILY.Member@Example.INVALID');
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test('returns null without loading the body when provider authentication or availability fails', async () => {
    for (const status of [401, 403, 429, 503]) {
      const res = response({ [field]: 'ignore@example.invalid' }, false);
      Object.assign(res, { status });
      mockFetch.mockResolvedValueOnce(res);
      await expect(call(FIXTURE_AUTH)).resolves.toBeNull();
      expect(res.json).not.toHaveBeenCalled();
    }
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test.each([{}, { unrelated: 'value' }])('returns null without logging for a successful response with no address', async (payload) => {
    mockFetch.mockResolvedValue(response(payload));
    await expect(call(FIXTURE_AUTH)).resolves.toBeNull();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test('returns null when the address field is explicitly null', async () => {
    mockFetch.mockResolvedValue(response({ [field]: null }));
    await expect(call(FIXTURE_AUTH)).resolves.toBeNull();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test('keeps a transport failure nonfatal and reports the original error to the logger', async () => {
    const failure = new Error('synthetic profile transport failure');
    mockFetch.mockRejectedValue(failure);
    await expect(call(FIXTURE_AUTH)).resolves.toBeNull();
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(failureLabel, failure);
  });

  test('keeps invalid JSON nonfatal and reports the original parsing error', async () => {
    const failure = new SyntaxError('synthetic invalid JSON');
    const res = response(null);
    jest.mocked(res.json).mockRejectedValue(failure);
    mockFetch.mockResolvedValue(res);
    await expect(call(FIXTURE_AUTH)).resolves.toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(failureLabel, failure);
  });

  test.each([null, { malformed: true }, 42])('handles malformed address payload %j without breaking OAuth', async (malformed) => {
    mockFetch.mockResolvedValue(response(malformed === null ? null : { [field]: malformed }));
    await expect(call(FIXTURE_AUTH)).resolves.toBeNull();
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(failureLabel, expect.any(TypeError));
  });

  test.failing('KNOWN GAP: whitespace-only provider email is exposed as a connected account address', async () => {
    mockFetch.mockResolvedValue(response({ [field]: '   ' }));
    await expect(call(FIXTURE_AUTH)).resolves.toBeNull();
  });
});

describe('Microsoft account fallbacks', () => {
  test('prefers mail over userPrincipalName when both are available', async () => {
    mockFetch.mockResolvedValue(response({ mail: 'MAIL@Example.INVALID', userPrincipalName: 'LOGIN@Example.INVALID' }));
    await expect(fetchMicrosoftAccountEmail(FIXTURE_AUTH)).resolves.toBe('mail@example.invalid');
  });

  test.each([undefined, null, ''])('falls back to userPrincipalName when mail is %s', async (mail) => {
    mockFetch.mockResolvedValue(response({ mail, userPrincipalName: 'LOGIN@Example.INVALID' }));
    await expect(fetchMicrosoftAccountEmail(FIXTURE_AUTH)).resolves.toBe('login@example.invalid');
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test('returns null when neither Microsoft address field is populated', async () => {
    mockFetch.mockResolvedValue(response({ mail: null, userPrincipalName: null }));
    await expect(fetchMicrosoftAccountEmail(FIXTURE_AUTH)).resolves.toBeNull();
  });
});
