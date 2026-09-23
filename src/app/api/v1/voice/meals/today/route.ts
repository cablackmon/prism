import { withAuth } from '@/lib/api/withAuth';
import { voiceOk, voiceError } from '@/lib/api/voiceResponse';
import { phraseTodayMeals } from '@/lib/api/voicePhrases';
import { db } from '@/lib/db/client';
import { meals } from '@/lib/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';
import { logError } from '@/lib/utils/logError';

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
type DayName = (typeof DAY_NAMES)[number];

function todayDayName(now = new Date()): DayName {
  return DAY_NAMES[now.getDay()]!;
}

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * GET /api/v1/voice/meals/today
 *
 * Returns today's planned meals (breakfast, lunch, dinner, snack), ordered.
 * Looks for meal entries whose `dayOfWeek` matches today's day name and
 * whose `weekOf` falls within the surrounding ±7 days. This works regardless
 * of whether the household configures the week to start on Sunday or Monday.
 */
export async function GET() {
  return withAuth(
    async () => {
      try {
        const now = new Date();
        const dayName = todayDayName(now);

        const minus7 = new Date(now);
        minus7.setDate(minus7.getDate() - 7);
        const plus1 = new Date(now);
        plus1.setDate(plus1.getDate() + 1);

        const rows = await db
          .select({
            id: meals.id,
            name: meals.name,
            mealType: meals.mealType,
            mealTime: meals.mealTime,
          })
          .from(meals)
          .where(
            and(
              eq(meals.dayOfWeek, dayName),
              gte(meals.weekOf, localDateString(minus7)),
              lte(meals.weekOf, localDateString(plus1))
            )
          );

        // Order by mealType (breakfast → lunch → dinner → snack) for spoken output.
        const order: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
        rows.sort((a, b) => (order[a.mealType] ?? 99) - (order[b.mealType] ?? 99));

        const spoken = phraseTodayMeals(rows);

        return voiceOk(spoken, {
          count: rows.length,
          meals: rows,
        });
      } catch (error) {
        logError('Voice API: meals/today failed', error);
        return voiceError('Sorry, I had trouble reading the meal plan.', 500);
      }
    },
    {
      tokenScope: 'voice',
      rateLimit: { feature: 'voice-api', limit: 60, windowSeconds: 60 },
    }
  );
}
