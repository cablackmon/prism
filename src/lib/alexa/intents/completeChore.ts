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
 * CompleteChoreIntent: "mark feed the dog complete."
 *
 * Slots:
 *   - Chore (required): fuzzy chore-name match
 *   - Assignee (optional): family-member disambiguation when multiple
 *     people share a chore name
 *
 * The voice endpoint can return ok:false with `data.candidates` when the
 * chore name is ambiguous. We pass that spoken prompt through unchanged so
 * the user can re-ask with an assignee.
 */
export async function handleCompleteChore(args: IntentArgs = {}): Promise<AlexaResponse> {
  const chore = args.slots?.Chore?.value?.trim();
  const assignee = args.slots?.Assignee?.value?.trim() || undefined;

  if (!chore) {
    return speak('Which chore?');
  }

  try {
    const result = await voiceClient.completeChore({ chore, assignee });
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] completeChore failed', err);
      return speak("Sorry, I couldn't complete that chore.");
    }
    throw err;
  }
}
