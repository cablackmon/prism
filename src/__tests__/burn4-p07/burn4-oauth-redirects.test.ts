import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { resolveKrogerRedirectUri } from '@/lib/integrations/kroger/redirect';

type SetupModule = typeof import('@/lib/integrations/oauthSetupRedirect');
type SetupConfig = { APP_URL?: string; BASE_URL?: string };

function loadSetupRedirect(config: SetupConfig = {}) {
  const sourcePath = resolve(__dirname, '../../lib/integrations/oauthSetupRedirect.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText;
  const response = Object.freeze({ kind: 'synthetic redirect response' });
  const redirect = jest.fn((_url: string) => response);
  const moduleRecord: { exports: Partial<SetupModule> } = { exports: {} };
  const sandbox = {
    exports: moduleRecord.exports,
    module: moduleRecord,
    // This process object contains only invented configuration. The host is never consulted.
    process: Object.freeze({ env: Object.freeze({ ...config }) }),
    Error,
    require: (name: string) => {
      if (name === 'next/server') return { NextResponse: { redirect } };
      throw new Error(`Unexpected setup dependency: ${name}`);
    },
  };
  new Script(compiled, { filename: sourcePath }).runInNewContext(sandbox);
  return { api: moduleRecord.exports as SetupModule, redirect, response };
}

describe('OAuth setup redirect configuration', () => {
  test.each([
    ['google', 'google'], ['gmail', 'gmail-bus'], ['microsoft', 'microsoft'],
  ] as const)('sends %s setup to its integrations banner and anchor', (provider, anchor) => {
    const { api, redirect, response } = loadSetupRedirect({ APP_URL: 'https://prism.example.invalid' });
    expect(api.oauthSetupRedirect(provider)).toBe(response);
    expect(redirect).toHaveBeenCalledTimes(1);
    const target = new URL(redirect.mock.calls[0]![0]);
    expect(target.origin).toBe('https://prism.example.invalid');
    expect(target.pathname).toBe('/settings');
    expect(Object.fromEntries(target.searchParams)).toEqual({ section: 'integrations', setup: provider });
    expect(target.hash).toBe(`#${anchor}`);
  });

  test.each([
    [{ APP_URL: 'https://primary.example.invalid', BASE_URL: 'https://fallback.example.invalid' }, 'https://primary.example.invalid'],
    [{ BASE_URL: 'http://prism.lan:8091' }, 'http://prism.lan:8091'],
    [{ APP_URL: '', BASE_URL: 'https://fallback.example.invalid' }, 'https://fallback.example.invalid'],
    [{ APP_URL: '', BASE_URL: '' }, 'http://localhost:3000'],
    [{}, 'http://localhost:3000'],
  ])('resolves the configured base from isolated fixture %j', (config, expectedBase) => {
    const { api, redirect } = loadSetupRedirect(config);
    api.oauthSetupRedirect('google');
    expect(redirect).toHaveBeenCalledWith(`${expectedBase}/settings?section=integrations&setup=google#google`);
  });

  test('keeps independently loaded configuration instances isolated', () => {
    const first = loadSetupRedirect({ APP_URL: 'https://first.example.invalid' });
    const second = loadSetupRedirect({ APP_URL: 'https://second.example.invalid' });
    first.api.oauthSetupRedirect('gmail');
    second.api.oauthSetupRedirect('gmail');
    expect(first.redirect).toHaveBeenCalledWith('https://first.example.invalid/settings?section=integrations&setup=gmail#gmail-bus');
    expect(second.redirect).toHaveBeenCalledWith('https://second.example.invalid/settings?section=integrations&setup=gmail#gmail-bus');
  });

  test('returns the framework response and preserves redirect construction failures', () => {
    const { api, redirect } = loadSetupRedirect();
    const failure = new TypeError('synthetic redirect failure');
    redirect.mockImplementationOnce(() => { throw failure; });
    expect(() => api.oauthSetupRedirect('microsoft')).toThrow(failure);
  });

  test.failing('KNOWN GAP: trailing slash in the configured setup base produces a double-slash settings path', () => {
    const { api, redirect } = loadSetupRedirect({ APP_URL: 'https://prism.example.invalid/' });
    api.oauthSetupRedirect('google');
    expect(new URL(redirect.mock.calls[0]![0]).pathname).toBe('/settings');
  });
});

describe('missing OAuth configuration recognition', () => {
  const { api } = loadSetupRedirect();

  test.each([
    'Missing Google OAuth configuration. Configure in Settings.',
    'MICROSOFT OAUTH CONFIGURATION is incomplete',
    'OAuth configuration for Gmail is missing',
  ])('recognizes a provider configuration Error: %s', (message) => {
    expect(api.isOAuthNotConfigured(new Error(message))).toBe(true);
  });

  test.each([
    null, undefined, 'Missing OAuth configuration', { message: 'Missing OAuth configuration' },
    new Error('Provider temporarily unavailable'), new Error('OAuth token exchange failed'),
  ])('does not turn a nonconfiguration failure into setup: %j', (error) => {
    expect(api.isOAuthNotConfigured(error)).toBe(false);
  });
});

describe('Kroger request redirect resolution', () => {
  test.each([
    ['https://internal.example.invalid/start?ignored=1', {}, 'https://internal.example.invalid'],
    ['http://192.0.2.10:3000/start', {}, 'http://192.0.2.10:3000'],
    ['http://internal.example.invalid/start', { host: 'dashboard.example.invalid:8443' }, 'http://dashboard.example.invalid:8443'],
    ['http://internal.example.invalid/start', { host: 'internal.example.invalid', 'x-forwarded-host': 'public.example.invalid', 'x-forwarded-proto': 'https' }, 'https://public.example.invalid'],
    ['https://internal.example.invalid/start', { 'x-forwarded-host': 'public.example.invalid' }, 'https://public.example.invalid'],
    ['http://internal.example.invalid/start', { 'x-forwarded-proto': 'https' }, 'https://internal.example.invalid'],
    ['https://[2001:db8::10]:8443/start', {}, 'https://[2001:db8::10]:8443'],
  ])('resolves callback from %s with proxy headers %j', (url, headers, origin) => {
    const request = new Request(url, { headers });
    const before = Array.from(request.headers.entries());
    expect(resolveKrogerRedirectUri(request)).toBe(`${origin}/api/auth/kroger/callback`);
    expect(Array.from(request.headers.entries())).toEqual(before);
    expect(request.url).toBe(url);
  });

  test('treats forwarded header names case insensitively through the request headers interface', () => {
    const request = new Request('http://upstream.example.invalid/path', {
      headers: { 'X-Forwarded-Host': 'prism.example.invalid:443', 'X-Forwarded-Proto': 'https' },
    });
    expect(resolveKrogerRedirectUri(request)).toBe('https://prism.example.invalid:443/api/auth/kroger/callback');
  });

  test.failing('KNOWN GAP: comma-separated proxy host and protocol chains become an invalid Kroger callback URL', () => {
    const request = new Request('http://upstream.example.invalid/start', {
      headers: { 'x-forwarded-host': 'public.example.invalid, edge.example.invalid', 'x-forwarded-proto': 'https, http' },
    });
    expect(resolveKrogerRedirectUri(request)).toBe('https://public.example.invalid/api/auth/kroger/callback');
  });
});
