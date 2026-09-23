import { withAuth } from '@/lib/api/withAuth';
import { voiceOk, voiceError } from '@/lib/api/voiceResponse';
import { phraseWeatherToday } from '@/lib/api/voicePhrases';
import { fetchWeatherData, type LocationParam } from '@/lib/integrations/weather';
import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logError } from '@/lib/utils/logError';

async function resolveLocation(): Promise<LocationParam | undefined> {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, 'location'));
    if (row?.value) {
      const val = row.value as { lat?: number; lon?: number; displayName?: string };
      if (val.lat !== undefined && val.lon !== undefined) {
        return { lat: val.lat, lon: val.lon };
      }
      if (val.displayName) return val.displayName;
    }
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * GET /api/v1/voice/weather/today
 *
 * Returns current conditions plus today's high/low for natural-language
 * playback. Reuses the existing weather provider (Open-Meteo / Pirate /
 * OpenWeather) selected by WEATHER_PROVIDER.
 */
export async function GET() {
  return withAuth(
    async () => {
      try {
        const location = await resolveLocation();
        const weather = await fetchWeatherData(location);
        const today = weather.forecast[0];

        const spoken = phraseWeatherToday({
          location: weather.location,
          currentTemp: Math.round(weather.current.temperature),
          feelsLike: Math.round(weather.current.feelsLike),
          description: weather.current.description,
          high: today ? Math.round(today.high) : null,
          low: today ? Math.round(today.low) : null,
          precipProbability: today?.precipProbability ?? null,
        });

        return voiceOk(spoken, {
          location: weather.location,
          currentTemp: weather.current.temperature,
          feelsLike: weather.current.feelsLike,
          description: weather.current.description,
          condition: weather.current.condition,
          humidity: weather.current.humidity,
          high: today?.high ?? null,
          low: today?.low ?? null,
          precipProbability: today?.precipProbability ?? null,
        });
      } catch (error) {
        logError('Voice API: weather/today failed', error);
        return voiceError("Sorry, I couldn't get the weather right now.", 500);
      }
    },
    {
      tokenScope: 'voice',
      rateLimit: { feature: 'voice-api', limit: 60, windowSeconds: 60 },
    }
  );
}
