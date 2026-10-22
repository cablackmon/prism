import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export type RouteName = 'google' | 'google-tasks' | 'microsoft' | 'microsoft-tasks';
type Auth = { userId: string; role: string };
type Route = { GET(request: Request): Promise<Response> };
type Options = { settings?: Record<string, string> };

/** Read unchanged master source and execute it with an offline import whitelist. */
export function oauthFixture(route: RouteName, options: Options = {}) {
  class OfflineResponse extends Response {
    static json(body: unknown, init?: ResponseInit): OfflineResponse {
      const headers = new Headers(init?.headers);
      headers.set('content-type', 'application/json');
      return new OfflineResponse(JSON.stringify(body), { ...init, headers });
    }

    static redirect(url: string | URL): OfflineResponse {
      return redirect(url);
    }
  }
  const redirect = jest.fn((url: string | URL) => new OfflineResponse(null, {
    status: 307, headers: { location: new URL(url).toString() },
  }));
  const user = Object.freeze({ userId: 'synthetic-parent', role: 'parent' });
  const requireAuth = jest.fn<Promise<Auth | OfflineResponse>, []>().mockResolvedValue(user);
  const requireRole = jest.fn<OfflineResponse | null, [Auth, string]>().mockReturnValue(null);
  const createOAuthState = jest.fn<Promise<string>, [string, string, Record<string, unknown>]>()
    .mockResolvedValue('synthetic-opaque-state');
  const getProviderAuthUrl = jest.fn<Promise<string>, [string, string]>()
    .mockResolvedValue('https://provider.example.invalid/authorize?fixture=1');
  const resolveRedirectUri = jest.fn<string, [Request, string]>()
    .mockImplementation((_request, callbackPath) => `https://prism.example.invalid${callbackPath}`);
  const getGoogleCredentials = jest.fn<Promise<{ clientId: string } | null>, []>()
    .mockResolvedValue({ clientId: 'synthetic-google-client' });
  const getMicrosoftCredentials = jest.fn<Promise<{ clientId: string } | null>, []>()
    .mockResolvedValue({ clientId: 'synthetic-microsoft-client' });
  const configurationError = new Error('Synthetic missing provider configuration');
  const isOAuthNotConfigured = jest.fn<boolean, [unknown]>()
    .mockImplementation((error) => error === configurationError);
  const setupResponse = new OfflineResponse(null, {
    status: 307, headers: { location: `https://prism.example.invalid/setup?configure=${route.split('-')[0]}` },
  });
  const oauthSetupRedirect = jest.fn<OfflineResponse, [string]>().mockReturnValue(setupResponse);
  const logError = jest.fn<void, [string, unknown]>();
  const googleScopes = 'https://www.googleapis.com/auth/tasks openid email';
  const dependencies: Record<string, unknown> = {
    'next/server': { NextResponse: OfflineResponse },
    '@/lib/auth': { requireAuth, requireRole },
    '@/lib/auth/oauthState': { createOAuthState },
    '@/lib/integrations/google-calendar': { getGoogleAuthUrl: getProviderAuthUrl },
    '@/lib/integrations/onedrive': { getMicrosoftAuthUrl: getProviderAuthUrl },
    '@/lib/integrations/oauthSetupRedirect': { isOAuthNotConfigured, oauthSetupRedirect },
    '@/lib/integrations/resolveRedirectUri': { resolveRedirectUri },
    '@/lib/integrations/credentialStore': { getGoogleCredentials, getMicrosoftCredentials },
    '@/lib/integrations/googleScopes': { TASKS_BROWSER_SCOPES: googleScopes },
    '@/lib/utils/logError': { logError },
  };
  const requireDependency = jest.fn((name: string) => {
    if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
    throw new Error(`No offline fixture for ${name}`);
  });
  const fetch = jest.fn(() => { throw new Error('Network is forbidden in this fixture'); });
  const filename = resolve(__dirname, `../../app/api/auth/${route}/route.ts`);
  const source = readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const moduleValue = { exports: {} };
  const settings = options.settings ?? { MICROSOFT_CLIENT_ID: 'synthetic-microsoft-client' };
  runInNewContext(compiled.outputText, {
    module: moduleValue,
    exports: moduleValue.exports,
    require: requireDependency,
    process: Object.freeze({ env: Object.freeze({ ...settings }) }),
    URL,
    URLSearchParams,
    Error,
    fetch,
  }, { filename, timeout: 1_000 });
  return {
    GET: (moduleValue.exports as Route).GET,
    OfflineResponse,
    user,
    requireAuth,
    requireRole,
    createOAuthState,
    getProviderAuthUrl,
    resolveRedirectUri,
    getGoogleCredentials,
    getMicrosoftCredentials,
    configurationError,
    isOAuthNotConfigured,
    oauthSetupRedirect,
    setupResponse,
    logError,
    redirect,
    googleScopes,
    requireDependency,
    fetch,
  };
}

export function requestFor(route: RouteName, parameters: Record<string, string> = {}): Request {
  const url = new URL(`https://prism.example.invalid/api/auth/${route}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return new Request(url);
}

export function locationOf(response: Response): URL {
  const location = response.headers.get('location');
  if (!location) throw new Error('Expected a response with a redirect location');
  return new URL(location);
}

/** Read routing data without requiring its current insecure wire encoding. */
export function routingPayload(fixture: ReturnType<typeof oauthFixture>, response: Response): unknown {
  const storedPayload = fixture.createOAuthState.mock.calls[0]?.[2];
  if (storedPayload) return storedPayload;
  const state = locationOf(response).searchParams.get('state');
  if (!state) throw new Error('Expected an OAuth state value');
  return JSON.parse(state) as unknown;
}
