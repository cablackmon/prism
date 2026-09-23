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
 * PostFamilyMessageIntent: "post a message that soccer is at four PM."
 *
 * Slots:
 *   - Message (required): the message body
 */
export async function handlePostFamilyMessage(args: IntentArgs = {}): Promise<AlexaResponse> {
  const message = args.slots?.Message?.value?.trim();

  if (!message) {
    return speak('What message should I post?');
  }

  try {
    const result = await voiceClient.postFamilyMessage({ message });
    return speak(result.spoken);
  } catch (err) {
    if (err instanceof VoiceApiError) {
      logError('[alexa] postFamilyMessage failed', err);
      return speak("Sorry, I couldn't post that message.");
    }
    throw err;
  }
}
