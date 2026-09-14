import { speak, type AlexaResponse } from '../responses';
import { voiceClient, VoiceApiError } from '../client';
import { logError } from '@/lib/utils/logError';

export async function handleGetFamily(): Promise<AlexaResponse> {
  try {
    const result = await voiceClient.getFamily();
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] getFamily failed', err);
      return speak("Sorry, I couldn't reach KYST right now.");
    }
    throw err;
  }
}
