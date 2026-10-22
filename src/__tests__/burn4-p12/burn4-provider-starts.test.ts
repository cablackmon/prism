import { locationOf, oauthFixture, requestFor } from './burn4-oauth-fixture';

const providers = ['google', 'microsoft'] as const;

describe.each(providers)('%s calendar/photo OAuth start', (provider) => {
  test('stores only routing metadata under the authenticated owner and redirects through the provider adapter', async () => {
    const f = oauthFixture(provider);
    const request = requestFor(provider, { userId: 'ignored-client-user' });
    const response = await f.GET(request);
    expect(response.status).toBe(307);
    expect(locationOf(response).href).toBe('https://provider.example.invalid/authorize?fixture=1');
    const payload = provider === 'google'
      ? { returnSection: 'connections' }
      : { sourceName: 'OneDrive Photos', returnSection: '' };
    expect(f.createOAuthState).toHaveBeenCalledWith(provider, f.user.userId, payload);
    expect(f.resolveRedirectUri).toHaveBeenCalledWith(request, `/api/auth/${provider}/callback`);
    expect(f.getProviderAuthUrl).toHaveBeenCalledWith('synthetic-opaque-state', `https://prism.example.invalid/api/auth/${provider}/callback`);
    expect(f.logError).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  test('preserves caller routing text and ignores supplied ownership or state values', async () => {
    const f = oauthFixture(provider);
    const parameters: Record<string, string> = provider === 'google'
      ? { returnSection: 'integrations#google-calendar', reauth: 'source / & ü', userId: 'ignored-owner', state: 'ignored-state' }
      : { sourceName: 'Vacation & Family / ü', returnSection: 'integrations#microsoft-onedrive', userId: 'ignored-owner', state: 'ignored-state' };
    await f.GET(requestFor(provider, parameters));
    const expected = provider === 'google'
      ? { returnSection: parameters.returnSection, reauth: parameters.reauth }
      : { sourceName: parameters.sourceName, returnSection: parameters.returnSection };
    expect(f.createOAuthState).toHaveBeenCalledWith(provider, f.user.userId, expected);
    expect(f.createOAuthState).toHaveBeenCalledTimes(1);
  });

  test('uses defaults for empty routing parameters and omits an empty Google reauth value', async () => {
    const f = oauthFixture(provider);
    await f.GET(requestFor(provider, { returnSection: '', reauth: '', sourceName: '' }));
    expect(f.createOAuthState).toHaveBeenCalledWith(provider, f.user.userId, provider === 'google'
      ? { returnSection: 'connections' }
      : { sourceName: 'OneDrive Photos', returnSection: '' });
  });

  test('uses separate state values for repeated starts without mutating the authenticated owner', async () => {
    const f = oauthFixture(provider);
    f.createOAuthState.mockResolvedValueOnce('synthetic-first-state').mockResolvedValueOnce('synthetic-second-state');
    await f.GET(requestFor(provider));
    await f.GET(requestFor(provider));
    expect(f.getProviderAuthUrl.mock.calls.map(([state]) => state)).toEqual(['synthetic-first-state', 'synthetic-second-state']);
    expect(f.user).toEqual({ userId: 'synthetic-parent', role: 'parent' });
  });

  test('redirects missing provider configuration to setup without logging a generic error', async () => {
    const f = oauthFixture(provider);
    f.getProviderAuthUrl.mockRejectedValue(f.configurationError);
    expect(await f.GET(requestFor(provider))).toBe(f.setupResponse);
    expect(f.isOAuthNotConfigured).toHaveBeenCalledWith(f.configurationError);
    expect(f.oauthSetupRedirect).toHaveBeenCalledWith(provider);
    expect(f.logError).not.toHaveBeenCalled();
  });

  test.each(['state', 'redirect', 'provider'] as const)('contains an unexpected %s dependency failure', async (boundary) => {
    const f = oauthFixture(provider);
    const error = new Error(`Synthetic ${boundary} failure`);
    if (boundary === 'state') f.createOAuthState.mockRejectedValue(error);
    if (boundary === 'redirect') f.resolveRedirectUri.mockImplementation(() => { throw error; });
    if (boundary === 'provider') f.getProviderAuthUrl.mockRejectedValue(error);
    const response = await f.GET(requestFor(provider));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: `Failed to initiate ${provider === 'google' ? 'Google' : 'Microsoft'} authentication` });
    expect(f.logError).toHaveBeenCalledWith(`Failed to initiate ${provider === 'google' ? 'Google' : 'Microsoft'} OAuth:`, error);
    expect(f.oauthSetupRedirect).not.toHaveBeenCalled();
    expect(f.redirect).not.toHaveBeenCalled();
    if (boundary !== 'provider') expect(f.getProviderAuthUrl).not.toHaveBeenCalled();
  });

  test('contains an invalid provider redirect URL as a generic server error', async () => {
    const f = oauthFixture(provider);
    f.getProviderAuthUrl.mockResolvedValue('invalid provider URL');
    const response = await f.GET(requestFor(provider));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: `Failed to initiate ${provider === 'google' ? 'Google' : 'Microsoft'} authentication` });
    expect(f.logError).toHaveBeenCalledTimes(1);
    expect(f.oauthSetupRedirect).not.toHaveBeenCalled();
  });

  test('awaits state creation before requesting a provider URL', async () => {
    const f = oauthFixture(provider);
    let finish: (value: string) => void = () => { throw new Error('State fixture not started'); };
    const started = new Promise<void>((resolveStarted) => {
      f.createOAuthState.mockImplementationOnce(() => new Promise<string>((resolveState) => {
        finish = resolveState;
        resolveStarted();
      }));
    });
    const pending = f.GET(requestFor(provider));
    await started;
    expect(f.getProviderAuthUrl).not.toHaveBeenCalled();
    finish('synthetic-deferred-state');
    expect((await pending).status).toBe(307);
    expect(f.getProviderAuthUrl).toHaveBeenCalledWith('synthetic-deferred-state', expect.any(String));
  });
});
