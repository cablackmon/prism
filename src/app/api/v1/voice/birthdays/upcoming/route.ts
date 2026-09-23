import { type NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { voiceOk, voiceError } from '@/lib/api/voiceResponse';
import { phraseUpcomingBirthdays } from '@/lib/api/voicePhrases';
import { db } from '@/lib/db/client';
import { birthdays } from '@/lib/db/schema';
import { logError } from '@/lib/utils/logError';

/**
 * GET /api/v1/voice/birthdays/upcoming?days=N
 *
 * Returns upcoming birthdays in the next N days (default 30, clamped 1..365).
 * Birthdays are stored as ISO dates with possibly-historic years; we
 * compare on month/day rather than full date to surface upcoming
 * occurrences regardless of original birth year.
 */
export async function GET(request: NextRequest) {
  return withAuth(
    async () => {
      try {
        const url = new URL(request.url);
        const raw = parseInt(url.searchParams.get('days') ?? '30', 10);
        const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, raw)) : 30;

        const all = await db.select().from(birthdays);

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const horizon = new Date(today);
        horizon.setDate(horizon.getDate() + days);

        // Build the next occurrence for each entry. If month/day is later this
        // year it falls in the current year; otherwise it rolls to next year.
        const upcoming = all
          .map((b) => {
            // birthDate stored as YYYY-MM-DD or as a Date in some drivers; normalize.
            const raw =
              typeof b.birthDate === 'string' ? b.birthDate : new Date(b.birthDate).toISOString();
            const [, monthStr, dayStr] = raw.split('-');
            const month = parseInt(monthStr ?? '', 10) - 1;
            const day = parseInt(dayStr ?? '', 10);
            if (Number.isNaN(month) || Number.isNaN(day)) return null;

            let next = new Date(today.getFullYear(), month, day);
            if (next < today) next = new Date(today.getFullYear() + 1, month, day);

            const original = parseInt(raw.slice(0, 4), 10);
            const turning =
              Number.isFinite(original) && original > 1900 ? next.getFullYear() - original : null;

            return { id: b.id, name: b.name, eventType: b.eventType, next, turning };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .filter((x) => x.next <= horizon)
          .sort((a, b) => a.next.getTime() - b.next.getTime());

        const spoken = phraseUpcomingBirthdays(upcoming, now);

        return voiceOk(spoken, {
          count: upcoming.length,
          birthdays: upcoming.map((u) => ({
            id: u.id,
            name: u.name,
            eventType: u.eventType,
            nextOccurrence: u.next.toISOString().slice(0, 10),
            turning: u.turning,
          })),
        });
      } catch (error) {
        logError('Voice API: birthdays/upcoming failed', error);
        return voiceError('Sorry, I had trouble reading the birthday list.', 500);
      }
    },
    {
      tokenScope: 'voice',
      rateLimit: { feature: 'voice-api', limit: 60, windowSeconds: 60 },
    }
  );
}
