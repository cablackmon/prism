/**
 * Per-user Kroger token persistence + automatic refresh.
 *
 * Tokens live in `user_kroger_connections` (encrypted at rest with
 * ENCRYPTION_KEY). Call `getUserTokens(userId)` from a route handler — it
 * returns decrypted tokens and silently refreshes them if the access token
 * is within 60s of expiring.
 */

import { db } from '@/lib/db/client';
import { userKrogerConnections } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from '@/lib/utils/crypto';
import { refreshTokens, type KrogerTokens } from './client';

const REFRESH_THRESHOLD_MS = 60_000; // refresh if expiring within 60s

export interface PersistedKrogerTokens extends KrogerTokens {
  preferredLocationId: string | null;
}

export async function getUserTokens(userId: string): Promise<PersistedKrogerTokens | null> {
  const [row] = await db
    .select()
    .from(userKrogerConnections)
    .where(eq(userKrogerConnections.userId, userId));

  if (!row) return null;

  let accessToken: string;
  let refreshToken: string | null = null;
  try {
    accessToken = decrypt(row.accessToken);
    refreshToken = row.refreshToken ? decrypt(row.refreshToken) : null;
  } catch {
    // Encryption key changed or row is corrupt — force re-connect.
    return null;
  }

  const expiresAt = row.tokenExpiresAt;
  const needsRefresh = expiresAt && expiresAt.getTime() - Date.now() < REFRESH_THRESHOLD_MS;

  if (needsRefresh && refreshToken) {
    const refreshed = await refreshTokens(refreshToken);
    if (refreshed) {
      await saveUserTokens(userId, refreshed);
      return {
        ...refreshed,
        preferredLocationId: row.preferredLocationId,
      };
    }
    // Refresh failed — return current token; caller will hit 401 and re-auth.
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    preferredLocationId: row.preferredLocationId,
  };
}

export async function saveUserTokens(userId: string, tokens: KrogerTokens): Promise<void> {
  const encryptedAccess = encrypt(tokens.accessToken);
  const encryptedRefresh = tokens.refreshToken ? encrypt(tokens.refreshToken) : null;
  const expiresAt = tokens.expiresAt ?? null;

  const [existing] = await db
    .select({ id: userKrogerConnections.id })
    .from(userKrogerConnections)
    .where(eq(userKrogerConnections.userId, userId));

  if (existing) {
    await db
      .update(userKrogerConnections)
      .set({
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(userKrogerConnections.userId, userId));
  } else {
    await db.insert(userKrogerConnections).values({
      userId,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: expiresAt,
    });
  }
}

export async function deleteUserTokens(userId: string): Promise<void> {
  await db.delete(userKrogerConnections).where(eq(userKrogerConnections.userId, userId));
}
