import { oauthFixture, requestFor, type RouteName } from './burn4-oauth-fixture';

const routes: RouteName[] = ['google', 'google-tasks', 'microsoft', 'microsoft-tasks'];

describe.each(routes)('%s OAuth start authorization boundary', (route) => {
  test.each([401, 503])('returns an auth response unchanged and skips provider work: %s', async (status) => {
    const f = oauthFixture(route);
    const denied = f.OfflineResponse.json({ error: 'Synthetic authorization refusal' }, { status });
    f.requireAuth.mockResolvedValue(denied);
    expect(await f.GET(requestFor(route))).toBe(denied);
    expect(f.requireRole).not.toHaveBeenCalled();
    expect(f.createOAuthState).not.toHaveBeenCalled();
    expect(f.getProviderAuthUrl).not.toHaveBeenCalled();
    expect(f.getGoogleCredentials).not.toHaveBeenCalled();
    expect(f.resolveRedirectUri).not.toHaveBeenCalled();
    expect(f.redirect).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  test('checks the correct capability and preserves a forbidden response', async () => {
    const f = oauthFixture(route);
    const forbidden = f.OfflineResponse.json({ error: 'Synthetic role refusal' }, { status: 403 });
    f.requireRole.mockReturnValue(forbidden);
    expect(await f.GET(requestFor(route))).toBe(forbidden);
    const capability = route.endsWith('-tasks') ? 'canManageIntegrations' : 'canModifySettings';
    expect(f.requireRole).toHaveBeenCalledWith(f.user, capability);
    expect(f.createOAuthState).not.toHaveBeenCalled();
    expect(f.getProviderAuthUrl).not.toHaveBeenCalled();
    expect(f.getGoogleCredentials).not.toHaveBeenCalled();
    expect(f.resolveRedirectUri).not.toHaveBeenCalled();
    expect(f.oauthSetupRedirect).not.toHaveBeenCalled();
  });

  test('does not start provider work when the auth dependency unexpectedly rejects', async () => {
    const f = oauthFixture(route);
    const error = new Error('Synthetic auth dependency failure');
    f.requireAuth.mockRejectedValue(error);
    await expect(f.GET(requestFor(route))).rejects.toBe(error);
    expect(f.requireRole).not.toHaveBeenCalled();
    expect(f.createOAuthState).not.toHaveBeenCalled();
    expect(f.getProviderAuthUrl).not.toHaveBeenCalled();
    expect(f.getGoogleCredentials).not.toHaveBeenCalled();
    expect(f.resolveRedirectUri).not.toHaveBeenCalled();
  });

  test('does not start provider work when role evaluation unexpectedly throws', async () => {
    const f = oauthFixture(route);
    const error = new Error('Synthetic role dependency failure');
    f.requireRole.mockImplementation(() => { throw error; });
    await expect(f.GET(requestFor(route))).rejects.toBe(error);
    expect(f.createOAuthState).not.toHaveBeenCalled();
    expect(f.getProviderAuthUrl).not.toHaveBeenCalled();
    expect(f.getGoogleCredentials).not.toHaveBeenCalled();
    expect(f.resolveRedirectUri).not.toHaveBeenCalled();
  });
});
