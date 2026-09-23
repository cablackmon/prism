/**
 * GET /api/auth/kroger/callback
 *
 * Kroger redirects here after the user consents. We verify the OAuth state
 * (binds the redirect to the user that started the flow), exchange the code
 * for tokens, and persist them in user_kroger_connections (encrypted).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { exchangeCodeForTokens } from '@/lib/integrations/kroger/client';
import { resolveKrogerRedirectUri } from '@/lib/integrations/kroger/redirect';
import { saveUserTokens } from '@/lib/integrations/kroger/tokens';
import { getRedisClient } from '@/lib/cache/getRedisClient';
import { logError } from '@/lib/utils/logError';

/**
 * Resolve a settings URL that lands on the same origin the user is on.
 * The post-OAuth redirect must stay on the host they started from, or
 * their Prism session cookie won't be sent.
 */
function settingsUrl(request: Request, query: string): string {
  const xfHost = request.headers.get('x-forwarded-host');
  const xfProto = request.headers.get('x-forwarded-proto');
  const url = new URL(request.url);
  const host = xfHost ?? request.headers.get('host') ?? url.host;
  const proto = xfProto ?? url.protocol.replace(':', '');
  return `${proto}://${host}/settings?${query}`;
}

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(settingsUrl(request, 'section=shopping&error=kroger_auth_denied'));
  }
  if (!code || !state) {
    return NextResponse.redirect(
      settingsUrl(request, 'section=shopping&error=kroger_missing_code')
    );
  }

  // Verify state matches the user that started the flow + recover the
  // redirect URI we sent to /authorize (Kroger requires the same string
  // on /token or the exchange fails).
  let redirectUri = resolveKrogerRedirectUri(request);
  const redis = await getRedisClient();
  if (redis) {
    const stored = await redis.get(`kroger-oauth-state:${state}`);
    if (!stored) {
      return NextResponse.redirect(
        settingsUrl(request, 'section=shopping&error=kroger_state_mismatch')
      );
    }
    try {
      const parsed = JSON.parse(stored) as { userId: string; redirectUri: string };
      if (parsed.userId !== auth.userId) {
        return NextResponse.redirect(
          settingsUrl(request, 'section=shopping&error=kroger_state_mismatch')
        );
      }
      redirectUri = parsed.redirectUri;
    } catch {
      // Legacy state values were a plain userId string — fall back to that
      // and use the request-derived redirectUri.
      if (stored !== auth.userId) {
        return NextResponse.redirect(
          settingsUrl(request, 'section=shopping&error=kroger_state_mismatch')
        );
      }
    }
    await redis.del(`kroger-oauth-state:${state}`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    await saveUserTokens(auth.userId, tokens);

    return NextResponse.redirect(settingsUrl(request, 'section=shopping&kroger=connected'));
  } catch (err) {
    logError('Kroger OAuth callback error:', err);
    return NextResponse.redirect(
      settingsUrl(request, 'section=shopping&error=kroger_token_exchange_failed')
    );
  }
}
