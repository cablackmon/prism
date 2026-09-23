/**
 *
 * Handles user logout by clearing session cookies.
 *
 * ENDPOINT: POST /api/auth/logout
 *
 * WHY POST INSTEAD OF GET?
 * Logout is a state-changing operation that modifies cookies.
 * Using POST:
 * - Prevents CSRF attacks via link injection
 * - Follows REST conventions (GET should be idempotent)
 * - Allows for additional logout logic (e.g., logging, cleanup)
 *
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { invalidateSession } from '@/lib/auth/session';
import { logActivity } from '@/lib/services/auditLog';
import { logError } from '@/lib/utils/logError';

// Determine whether this specific request arrived over HTTPS.
// Reading from x-forwarded-proto so the cleared cookies still carry the
// Secure flag when the user is behind a TLS-terminating reverse proxy —
// the same fix pattern login and verify-pin use.
function requestIsSecure(req: NextRequest): boolean {
  const proto = req.headers.get('x-forwarded-proto');
  if (proto) return proto === 'https';
  return req.url.startsWith('https://');
}

/**
 * POST /api/auth/logout
 * Logs out the current user by clearing session cookies.
 *
 * RESPONSE:
 * - 200: Logged out successfully
 *
 * COOKIES CLEARED:
 * - prism_session: The session token
 * - prism_user: The user ID
 *
 * NOTE:
 * This endpoint invalidates the session in Redis and clears cookies.
 * The session cannot be used again after logout.
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();

    // Get session info before clearing
    const sessionToken = cookieStore.get('prism_session')?.value;
    const userId = cookieStore.get('prism_user')?.value;

    // Invalidate session in Redis
    if (sessionToken) {
      await invalidateSession(sessionToken, userId);
    }

    logActivity({
      userId: userId || null,
      action: 'logout',
      entityType: 'session',
      summary: 'Logged out',
    });

    const secure = requestIsSecure(request);

    // Clear the session cookie
    // Setting maxAge: 0 immediately expires the cookie
    cookieStore.set('prism_session', '', {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: 0, // Expire immediately
      path: '/',
    });

    // Clear the user ID cookie
    cookieStore.set('prism_user', '', {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    return NextResponse.json({
      message: 'Logged out successfully',
    });
  } catch (error) {
    logError('Logout error:', error);

    // Even if there's an error, try to clear cookies
    // The user should be logged out regardless
    return NextResponse.json({ message: 'Logged out' }, { status: 200 });
  }
}
