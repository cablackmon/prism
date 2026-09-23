import { type NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { voiceOk, voiceError } from '@/lib/api/voiceResponse';
import { phraseBusStatus } from '@/lib/api/voicePhrases';
import { db } from '@/lib/db/client';
import { busRoutes } from '@/lib/db/schema';
import { eq, ilike } from 'drizzle-orm';
import { predictArrival } from '@/lib/services/bus-arrival-predictor';
import { logError } from '@/lib/utils/logError';

/**
 * GET /api/v1/voice/bus/status?student=Emma
 *
 * Returns active enabled bus routes for today with arrival predictions.
 * Optional `student` filter narrows to routes whose `studentName` matches
 * (case-insensitive substring).
 *
 * Today-active is determined by the route's `activeDays` array (1=Mon..5=Fri).
 */
export async function GET(request: NextRequest) {
  return withAuth(
    async () => {
      try {
        const url = new URL(request.url);
        const student = url.searchParams.get('student')?.trim();

        const all = await db.select().from(busRoutes).where(eq(busRoutes.enabled, true));

        // Map JS Date.getDay() (0=Sun..6=Sat) to schema convention (1=Mon..7=Sun).
        const today = new Date().getDay();
        const todayKey = today === 0 ? 7 : today;

        let activeToday = all.filter(
          (r) => Array.isArray(r.activeDays) && r.activeDays.includes(todayKey)
        );

        if (student) {
          const studentLower = student.toLowerCase();
          activeToday = activeToday.filter((r) =>
            r.studentName.toLowerCase().includes(studentLower)
          );
        }

        const routesWithStatus = await Promise.all(
          activeToday.map(async (r) => {
            const prediction = await predictArrival(r.id);
            return {
              id: r.id,
              label: r.label,
              studentName: r.studentName,
              direction: r.direction,
              scheduledTime: r.scheduledTime,
              prediction,
            };
          })
        );

        const spoken = phraseBusStatus(routesWithStatus, { student });

        return voiceOk(spoken, {
          count: routesWithStatus.length,
          routes: routesWithStatus,
        });
      } catch (error) {
        logError('Voice API: bus/status failed', error);
        return voiceError("Sorry, I couldn't reach the bus tracker.", 500);
      }
    },
    {
      tokenScope: 'voice',
      rateLimit: { feature: 'voice-api', limit: 60, windowSeconds: 60 },
    }
  );
}
