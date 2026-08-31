import { speak, type AlexaResponse } from '../responses';
import { voiceClient, VoiceApiError } from '../client';
import { logError } from '@/lib/utils/logError';

export async function handleGetTodayMeal(): Promise<AlexaResponse> {
  try {
    const result = await voiceClient.getMealsToday();
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] getMealsToday failed', err);
      return speak("Sorry, I couldn't reach KYST right now.");
    }
    throw err;
  }
}
