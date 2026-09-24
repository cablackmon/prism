import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { photoSources } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { listFolders, refreshAccessToken } from '@/lib/integrations/onedrive';
import { decrypt, encrypt } from '@/lib/utils/crypto';
import { logError } from '@/lib/utils/logError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const parentId = searchParams.get('parentId') ?? undefined;

    const source = await db.query.photoSources.findFirst({
      where: eq(photoSources.id, id),
    });

    if (!source || source.type !== 'onedrive') {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    if (!source.accessToken || !source.refreshToken) {
      return NextResponse.json({ error: 'Source missing OAuth tokens' }, { status: 400 });
    }

    let accessToken = decrypt(source.accessToken);
    if (source.tokenExpiresAt && source.tokenExpiresAt < new Date()) {
      const refreshToken = decrypt(source.refreshToken);
      const tokens = await refreshAccessToken(refreshToken);
      accessToken = tokens.access_token;

      await db
        .update(photoSources)
        .set({
          accessToken: encrypt(tokens.access_token),
          refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : source.refreshToken,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          updatedAt: new Date(),
        })
        .where(eq(photoSources.id, id));
    }

    const folders = await listFolders(accessToken, parentId);
    return NextResponse.json({ folders });
  } catch (error) {
    logError('Error listing OneDrive folders:', error);
    return NextResponse.json({ error: 'Failed to list folders' }, { status: 500 });
  }
}
