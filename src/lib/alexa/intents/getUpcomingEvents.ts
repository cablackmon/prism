import { speak, type AlexaResponse } from '../responses';
import { voiceClient, VoiceApiError } from '../client';
import { logError } from '@/lib/utils/logError';

interface AlexaSlot { value?: string }
interface IntentArgs {
  slots?: Record<string, AlexaSlot | undefined>;
}

export async function handleGetUpcomingEvents(args: IntentArgs = {}): Promise<AlexaResponse> {
  const rawCount = args.slots?.Count?.value;
  const parsed = rawCount ? parseInt(rawCount, 10) : NaN;
  const count = Number.isFinite(parsed) ? Math.min(10, Math.max(1, parsed)) : 3;

  try {
    const result = await voiceClient.getCalendarUpcoming(count);
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] getCalendarUpcoming failed', err);
      return speak("Sorry, I couldn't reach KYST right now.");
    }
    throw err;
  }
}
