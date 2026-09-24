import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { photos } from '@/lib/db/schema';
import { isNull, and, eq } from 'drizzle-orm';
import { getPhotoPath } from '@/lib/services/photo-storage';
import { promises as fs } from 'fs';
import exifr from 'exifr';
import { logError } from '@/lib/utils/logError';

async function extractGps(buffer: Buffer): Promise<{ latitude: string; longitude: string } | null> {
  try {
    const gps = await exifr.gps(buffer);
    if (gps?.latitude != null && gps?.longitude != null) {
      return { latitude: gps.latitude.toString(), longitude: gps.longitude.toString() };
    }
  } catch {
    // No EXIF or no GPS
  }
  return null;
}

export async function POST() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const photosWithoutGps = await db
      .select({ id: photos.id, filename: photos.filename })
      .from(photos)
      .where(and(isNull(photos.latitude), isNull(photos.longitude)));

    let updated = 0;
    let skipped = 0;

    for (const photo of photosWithoutGps) {
      try {
        const filePath = getPhotoPath(photo.filename);
        const buffer = await fs.readFile(filePath).catch(() => null);
        if (!buffer) {
          skipped++;
          continue;
        }

        const gps = await extractGps(buffer);
        if (!gps) {
          skipped++;
          continue;
        }

        await db
          .update(photos)
          .set({ latitude: gps.latitude, longitude: gps.longitude })
          .where(eq(photos.id, photo.id));

        updated++;
      } catch {
        skipped++;
      }
    }

    return NextResponse.json({ updated, skipped, total: photosWithoutGps.length });
  } catch (error) {
    logError('Error backfilling GPS:', error);
    return NextResponse.json({ error: 'Failed to backfill GPS' }, { status: 500 });
  }
}
