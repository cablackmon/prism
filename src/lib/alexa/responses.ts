/**
 * Alexa response builders.
 *
 * Reference: https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html
 *
 * Every response we send is `version: '1.0'` with an `outputSpeech.text`
 * shaped from the Voice API's `spoken` string. We intentionally do not use
 * SSML: the voice endpoints already return punctuation-rich strings, and
 * Alexa renders plain text well enough for our use case.
 */

export interface AlexaResponse {
  version: '1.0';
  response: {
    outputSpeech: { type: 'PlainText'; text: string };
    shouldEndSession: boolean;
    card?: { type: 'Simple'; title: string; content: string };
  };
}

export function speak(text: string, opts: { card?: string } = {}): AlexaResponse {
  const safeText = text.length > 8000 ? `${text.slice(0, 7997)}...` : text;
  const response: AlexaResponse['response'] = {
    outputSpeech: { type: 'PlainText', text: safeText },
    shouldEndSession: true,
  };
  if (opts.card) {
    response.card = { type: 'Simple', title: 'KYST', content: opts.card };
  }
  return { version: '1.0', response };
}

export function speakAndKeepOpen(text: string): AlexaResponse {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      shouldEndSession: false,
    },
  };
}
