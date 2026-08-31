import { speak, type AlexaResponse } from '../responses';
import { voiceClient, VoiceApiError } from '../client';
import { logError } from '@/lib/utils/logError';

interface AlexaSlot { value?: string }
interface IntentArgs {
  slots?: Record<string, AlexaSlot | undefined>;
}

/**
 * GetTodayChoresIntent: "what chores does Emma have today" / "what chores
 * are left for me to do."
 *
 * Slots:
 *   - Assignee (optional): family member whose chores to read; omitted
 *     reads all chores due today.
 */
export async function handleGetTodayChores(args: IntentArgs = {}): Promise<AlexaResponse> {
  const assignee = args.slots?.Assignee?.value?.trim() || undefined;

  try {
    const result = await voiceClient.getChoresToday(assignee);
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] getChoresToday failed', err);
      return speak("Sorry, I couldn't reach KYST right now.");
    }
    throw err;
  }
}
