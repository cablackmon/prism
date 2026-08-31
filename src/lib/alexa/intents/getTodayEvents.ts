import { speak, type AlexaResponse } from '../responses';
import { voiceClient, VoiceApiError } from '../client';
import { logError } from '@/lib/utils/logError';

export async function handleGetTodayEvents(): Promise<AlexaResponse> {
  try {
    const result = await voiceClient.getCalendarToday();
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] getCalendarToday failed:', err);
      return speak("Sorry, I couldn't reach KYST right now.");
    }
    throw err;
  }
}
