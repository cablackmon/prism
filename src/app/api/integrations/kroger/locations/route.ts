/**
 * Kroger store picker.
 *
 *   GET  /api/integrations/kroger/locations?zip=60614[&chain=MARIANOS]
 *     → search nearby stores so the user can pick a preferred location.
 *
 *   PATCH /api/integrations/kroger/locations
 *     body: { locationId: string | null, name?: string }
 *     → save the preferred location on user_kroger_connections.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { userKrogerConnections } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getUserTokens } from '@/lib/integrations/kroger/tokens';
import { searchLocations } from '@/lib/integrations/kroger/client';
import { logError } from '@/lib/utils/logError';

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const zip = searchParams.get('zip')?.trim();
  const chain = searchParams.get('chain')?.trim() || undefined;

  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: 'Valid 5-digit zip required' }, { status: 400 });
  }

  const tokens = await getUserTokens(auth.userId);
  if (!tokens) {
    return NextResponse.json(
      { error: 'Not connected to Kroger', code: 'KROGER_NOT_CONNECTED' },
      { status: 401 }
    );
  }

  try {
    const locations = await searchLocations(zip, tokens, { chain });
    return NextResponse.json({ locations });
  } catch (error) {
    logError('Kroger locations search failed:', error);
    return NextResponse.json({ error: 'Failed to search locations' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json()) as { locationId?: string | null; name?: string | null };
    const locationId = body.locationId ?? null;
    const name = body.name?.trim() || null;

    await db
      .update(userKrogerConnections)
      .set({
        preferredLocationId: locationId,
        preferredLocationName: name,
        updatedAt: new Date(),
      })
      .where(eq(userKrogerConnections.userId, auth.userId));

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError('Failed to set preferred Kroger location:', error);
    return NextResponse.json({ error: 'Failed to save preferred location' }, { status: 500 });
  }
}
