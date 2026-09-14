import { speak, type AlexaResponse } from '../responses';
import { voiceClient, VoiceApiError } from '../client';
import { logError } from '@/lib/utils/logError';

export async function handleGetTodayTasks(): Promise<AlexaResponse> {
  try {
    const result = await voiceClient.getTasksToday();
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] getTasksToday failed', err);
      return speak("Sorry, I couldn't reach KYST right now.");
    }
    throw err;
  }
}
