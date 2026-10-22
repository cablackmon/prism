import { locationOf, oauthFixture, requestFor, routingPayload } from './burn4-oauth-fixture';

const routes = ['google-tasks', 'microsoft-tasks'] as const;

describe.each(routes)('%s OAuth task start', (route) => {
  test('builds a provider authorization redirect using the request-specific callback', async () => {
    const f = oauthFixture(route);
    const request = requestFor(route);
    const response = await f.GET(request);
    expect(response.status).toBe(307);
    const target = locationOf(response);
    expect(target.origin + target.pathname).toBe(route === 'google-tasks'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
    expect(target.searchParams.get('response_type')).toBe('code');
    expect(target.searchParams.get('redirect_uri')).toBe(`https://prism.example.invalid/api/auth/${route}/callback`);
    expect(target.searchParams.get('client_id')).toBe(route === 'google-tasks' ? 'synthetic-google-client' : 'synthetic-microsoft-client');
    expect(target.searchParams.get('scope')).toBe(route === 'google-tasks' ? f.googleScopes : 'Tasks.ReadWrite offline_access User.Read');
    expect(target.searchParams.get('state')).toBeTruthy();
    expect(f.resolveRedirectUri).toHaveBeenCalledWith(request, `/api/auth/${route}/callback`);
    if (route === 'google-tasks') {
      expect(target.searchParams.get('access_type')).toBe('offline');
      expect(target.searchParams.get('prompt')).toBe('consent');
      expect(f.getGoogleCredentials).toHaveBeenCalledTimes(1);
    } else {
      expect(target.searchParams.get('response_mode')).toBe('query');
    }
    expect(f.logError).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  test('keeps absent destination identifiers null and uses the tasks return section', async () => {
    const f = oauthFixture(route);
    const response = await f.GET(requestFor(route));
    expect(routingPayload(f, response)).toEqual(route === 'google-tasks'
      ? { taskListId: null, returnSection: 'tasks' }
      : { taskListId: null, shoppingListId: null, wishMemberId: null, returnSection: 'tasks' });
  });

  test('preserves encoded routing values and ignores client-supplied ownership and state', async () => {
    const f = oauthFixture(route);
    const parameters = {
      taskListId: 'task / & ü', shoppingListId: 'shopping / & ü', wishMemberId: 'member / & ü',
      returnSection: 'integrations#provider', userId: 'ignored-owner', state: 'ignored-state',
    };
    const response = await f.GET(requestFor(route, parameters));
    expect(routingPayload(f, response)).toEqual(route === 'google-tasks'
      ? { taskListId: parameters.taskListId, returnSection: parameters.returnSection }
      : { taskListId: parameters.taskListId, shoppingListId: parameters.shoppingListId, wishMemberId: parameters.wishMemberId, returnSection: parameters.returnSection });
    expect(f.user).toEqual({ userId: 'synthetic-parent', role: 'parent' });
  });

  test('normalizes empty destination and return values to the documented defaults', async () => {
    const f = oauthFixture(route);
    const response = await f.GET(requestFor(route, { taskListId: '', shoppingListId: '', wishMemberId: '', returnSection: '' }));
    expect(routingPayload(f, response)).toEqual(route === 'google-tasks'
      ? { taskListId: null, returnSection: 'tasks' }
      : { taskListId: null, shoppingListId: null, wishMemberId: null, returnSection: 'tasks' });
  });

  test('contains a response redirect failure inside the provider error boundary', async () => {
    const f = oauthFixture(route);
    const error = new Error('Synthetic redirect response failure');
    f.redirect.mockImplementation(() => { throw error; });
    const response = await f.GET(requestFor(route));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: `Failed to initiate ${route === 'google-tasks' ? 'Google' : 'Microsoft'} authentication` });
    expect(f.logError).toHaveBeenCalledWith(`Failed to initiate ${route === 'google-tasks' ? 'Google' : 'Microsoft'} Tasks OAuth:`, error);
  });

  test.failing(`KNOWN GAP: ${route} sends routing JSON without session-bound opaque state`, async () => {
    const f = oauthFixture(route);
    const parameters = { taskListId: 'synthetic-task', shoppingListId: 'synthetic-shopping', wishMemberId: 'synthetic-member', returnSection: 'integrations' };
    const response = await f.GET(requestFor(route, parameters));
    expect(response.status).toBe(307);
    expect(f.createOAuthState).toHaveBeenCalledWith(expect.any(String), f.user.userId, route === 'google-tasks'
      ? { taskListId: parameters.taskListId, returnSection: parameters.returnSection }
      : parameters);
    expect(locationOf(response).searchParams.get('state')).toBe('synthetic-opaque-state');
  });

  test.failing(`KNOWN GAP: ${route} redirect resolution errors escape its JSON error response`, async () => {
    const f = oauthFixture(route);
    const error = new Error('Synthetic callback resolution failure');
    f.resolveRedirectUri.mockImplementation(() => { throw error; });
    const pending = f.GET(requestFor(route));
    await expect(pending).resolves.toMatchObject({ status: 500 });
    expect(await (await pending).json()).toEqual({ error: `Failed to initiate ${route === 'google-tasks' ? 'Google' : 'Microsoft'} authentication` });
    expect(f.logError).toHaveBeenCalledWith(`Failed to initiate ${route === 'google-tasks' ? 'Google' : 'Microsoft'} Tasks OAuth:`, error);
  });
});

describe('Google Tasks stored configuration', () => {
  test.each([null, { clientId: '' }])('redirects missing client configuration to setup: %j', async (credentials) => {
    const f = oauthFixture('google-tasks');
    f.getGoogleCredentials.mockResolvedValue(credentials);
    expect(await f.GET(requestFor('google-tasks'))).toBe(f.setupResponse);
    expect(f.oauthSetupRedirect).toHaveBeenCalledWith('google');
    expect(f.redirect).not.toHaveBeenCalled();
    expect(f.logError).not.toHaveBeenCalled();
  });

  test('awaits credential lookup before deriving the callback or redirecting', async () => {
    const f = oauthFixture('google-tasks');
    let finish: (value: { clientId: string }) => void = () => { throw new Error('Credential fixture not started'); };
    const started = new Promise<void>((resolveStarted) => {
      f.getGoogleCredentials.mockImplementationOnce(() => new Promise((resolveCredentials) => {
        finish = resolveCredentials;
        resolveStarted();
      }));
    });
    const pending = f.GET(requestFor('google-tasks'));
    await started;
    expect(f.resolveRedirectUri).not.toHaveBeenCalled();
    expect(f.redirect).not.toHaveBeenCalled();
    finish({ clientId: 'synthetic-deferred-client' });
    expect(locationOf(await pending).searchParams.get('client_id')).toBe('synthetic-deferred-client');
  });

  test.failing('KNOWN GAP: Google Tasks credential lookup rejection escapes its JSON error response', async () => {
    const f = oauthFixture('google-tasks');
    const error = new Error('Synthetic credential lookup failure');
    f.getGoogleCredentials.mockRejectedValue(error);
    const pending = f.GET(requestFor('google-tasks'));
    await expect(pending).resolves.toMatchObject({ status: 500 });
    expect(await (await pending).json()).toEqual({ error: 'Failed to initiate Google authentication' });
    expect(f.logError).toHaveBeenCalledWith('Failed to initiate Google Tasks OAuth:', error);
  });
});

describe('Microsoft Tasks configuration', () => {
  test('redirects an unconfigured installation to setup without starting consent', async () => {
    const f = oauthFixture('microsoft-tasks', { settings: {} });
    f.getMicrosoftCredentials.mockResolvedValue(null);
    expect(await f.GET(requestFor('microsoft-tasks'))).toBe(f.setupResponse);
    expect(f.oauthSetupRedirect).toHaveBeenCalledWith('microsoft');
    expect(f.redirect).not.toHaveBeenCalled();
    expect(f.logError).not.toHaveBeenCalled();
  });

  test.failing('KNOWN GAP: Microsoft Tasks ignores credentials stored through application settings', async () => {
    const f = oauthFixture('microsoft-tasks', { settings: {} });
    f.getMicrosoftCredentials.mockResolvedValue({ clientId: 'synthetic-stored-microsoft-client' });
    const response = await f.GET(requestFor('microsoft-tasks'));
    expect(locationOf(response).origin).toBe('https://login.microsoftonline.com');
    expect(locationOf(response).searchParams.get('client_id')).toBe('synthetic-stored-microsoft-client');
    expect(f.oauthSetupRedirect).not.toHaveBeenCalled();
  });
});
