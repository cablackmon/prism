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
 * AddShoppingItemIntent: "add milk to my grocery list."
 *
 * Slots:
 *   - Item (required): the thing to add
 *   - ListName (optional): which list; defaults to first list when omitted
 */
export async function handleAddShoppingItem(args: IntentArgs = {}): Promise<AlexaResponse> {
  const item = args.slots?.Item?.value?.trim();
  const list = args.slots?.ListName?.value?.trim() || undefined;

  if (!item) {
    return speak('What item would you like to add?');
  }

  try {
    const result = await voiceClient.postShoppingItem({ item, list });
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] postShoppingItem failed', err);
      return speak("Sorry, I couldn't add that to your list.");
    }
    throw err;
  }
}
