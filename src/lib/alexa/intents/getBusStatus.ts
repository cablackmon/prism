import { speak, type AlexaResponse } from '../responses';
import { voiceClient, VoiceApiError } from '../client';
import { logError } from '@/lib/utils/logError';

interface AlexaSlot {
  value?: string;
}
interface IntentArgs {
  slots?: Record<string, AlexaSlot | undefined>;
}

/**
 * GetBusStatusIntent: "where's the bus" / "is Emma's bus close."
 *
 * Slots:
 *   - Student (optional): family member name to filter routes by; omitted
 *     reads all active routes for today.
 */
export async function handleGetBusStatus(args: IntentArgs = {}): Promise<AlexaResponse> {
  const student = args.slots?.Student?.value?.trim() || undefined;

  try {
    const result = await voiceClient.getBusStatus(student);
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] getBusStatus failed', err);
      return speak("Sorry, I couldn't reach the bus tracker.");
    }
    throw err;
  }
}
