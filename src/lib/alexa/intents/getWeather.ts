import { speak, type AlexaResponse } from '../responses';
import { voiceClient, VoiceApiError } from '../client';
import { logError } from '@/lib/utils/logError';

export async function handleGetWeather(): Promise<AlexaResponse> {
  try {
    const result = (await voiceClient.getWeatherToday()) as { spoken: string };
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] getWeatherToday failed', err);
      return speak("Sorry, I couldn't get the weather right now.");
    }
    throw err;
  }
}
