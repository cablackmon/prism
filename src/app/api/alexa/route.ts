/**
 * Endpoint: /api/alexa
 *
 * Webhook for the Prism Alexa custom skill. Receives Alexa SkillKit
 * requests, validates the signature against the Alexa cert chain, dispatches
 * to an intent handler, and returns an Alexa-shaped response.
 *
 * Auth model: Alexa proves it sent the request via signature validation
 * (per Amazon's HTTPS service skill rules); we do not authenticate per-user.
 * The webhook then calls the Voice API using a server-side bearer token in
 * `ALEXA_VOICE_TOKEN`. So this skill is a single-user appliance: every Alexa
 * utterance hits the same Prism account.
 *
 * Handlers live in src/lib/alexa/intents/. Add a new intent by:
 *   1. registering its name + samples in alexa/interactionModels/custom/en-US.json,
 *   2. writing a handler under src/lib/alexa/intents/,
 *   3. wiring it in the dispatcher below.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAlexaRequest, AlexaSignatureError } from '@/lib/alexa/validate';
import { speak } from '@/lib/alexa/responses';
import { handleGetTodayEvents } from '@/lib/alexa/intents/getTodayEvents';
import { handleGetUpcomingEvents } from '@/lib/alexa/intents/getUpcomingEvents';
import { handleGetTodayTasks } from '@/lib/alexa/intents/getTodayTasks';
import { handleGetFamilyMessages } from '@/lib/alexa/intents/getFamilyMessages';
import { handleAddShoppingItem } from '@/lib/alexa/intents/addShoppingItem';
import { handleCompleteChore } from '@/lib/alexa/intents/completeChore';
import { handlePostFamilyMessage } from '@/lib/alexa/intents/postFamilyMessage';
import { handleGetFamily } from '@/lib/alexa/intents/getFamily';
import { handleGetTodayMeal } from '@/lib/alexa/intents/getTodayMeal';
import { handleGetTodayChores } from '@/lib/alexa/intents/getTodayChores';
import { handleGetWeather } from '@/lib/alexa/intents/getWeather';
import { handleGetBusStatus } from '@/lib/alexa/intents/getBusStatus';
import { handleGetUpcomingBirthdays } from '@/lib/alexa/intents/getUpcomingBirthdays';
import { logError } from '@/lib/utils/logError';

interface AlexaSlot {
  name?: string;
  value?: string;
}

interface AlexaRequest {
  version?: string;
  session?: {
    application?: { applicationId?: string };
  };
  context?: {
    System?: {
      application?: { applicationId?: string };
    };
  };
  request?: {
    type?: string;
    timestamp?: string;
    intent?: {
      name?: string;
      slots?: Record<string, AlexaSlot>;
    };
  };
}

/**
 * Pull the calling skill's application ID. It appears in either
 * `session.application` (most request types) or `context.System.application`
 * (some types like LaunchRequest may rely on the context copy). Either is
 * authoritative when present.
 */
function extractApplicationId(req: AlexaRequest): string | undefined {
  return (
    req.session?.application?.applicationId ??
    req.context?.System?.application?.applicationId
  );
}

export async function POST(request: NextRequest) {
  // Read body as raw text once — signature verification needs the exact
  // bytes Alexa signed, and re-stringifying after JSON.parse can change
  // whitespace and break the verifier.
  const rawBody = await request.text();

  // Allow bypass only outside production for local curl-driven testing.
  // Production-mode requests must be properly signed.
  const skipSig =
    process.env.NODE_ENV !== 'production' &&
    new URL(request.url).searchParams.get('skipAlexaSignatureCheck') === '1';

  let parsed: AlexaRequest;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!skipSig) {
    try {
      await verifyAlexaRequest({
        rawBody,
        certChainUrl: request.headers.get('SignatureCertChainUrl'),
        signature: request.headers.get('Signature'),
        signature256: request.headers.get('Signature-256'),
        parsedTimestamp: parsed.request?.timestamp ?? null,
      });
    } catch (err) {
      if (err instanceof AlexaSignatureError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      logError('[alexa] signature verification crashed:', err);
      return NextResponse.json({ error: 'signature_verification_failed' }, { status: 400 });
    }
  }

  // Skill ID gating. The signature only proves Amazon signed the request —
  // it does NOT prove the request came from OUR skill. Without this check,
  // anyone could create their own Alexa skill, point it at this URL, and
  // ride the ALEXA_VOICE_TOKEN we use upstream. Refusing requests whose
  // applicationId doesn't match the configured skill closes that gap.
  //
  // ALEXA_SKILL_ID is the value shown as "Your Skill ID" in the Alexa
  // Developer Console (format: amzn1.ask.skill.<uuid>). Required in
  // production; warn-and-allow in dev to keep `?skipAlexaSignatureCheck=1`
  // testing convenient.
  const expectedSkillId = process.env.ALEXA_SKILL_ID;
  const presentedSkillId = extractApplicationId(parsed);
  if (expectedSkillId) {
    if (presentedSkillId !== expectedSkillId) {
      logError('[alexa] skill ID mismatch', { got: presentedSkillId ?? null });
      return NextResponse.json({ error: 'skill_id_mismatch' }, { status: 403 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    logError('[alexa] ALEXA_SKILL_ID is not set; refusing to dispatch in production', null);
    return NextResponse.json({ error: 'skill_id_not_configured' }, { status: 500 });
  }

  const reqType = parsed.request?.type;

  if (reqType === 'LaunchRequest') {
    return NextResponse.json(
      speak('Welcome to KYST. Ask me about today\'s events, today\'s tasks, or your family.'),
    );
  }

  if (reqType === 'SessionEndedRequest') {
    return NextResponse.json({ version: '1.0', response: {} });
  }

  if (reqType !== 'IntentRequest') {
    return NextResponse.json(speak("Sorry, I didn't catch that."));
  }

  const intent = parsed.request?.intent?.name;
  const slots = parsed.request?.intent?.slots ?? {};

  switch (intent) {
    case 'GetTodayEventsIntent':
      return NextResponse.json(await handleGetTodayEvents());

    case 'GetUpcomingEventsIntent':
      return NextResponse.json(await handleGetUpcomingEvents({ slots }));

    case 'GetTodayTasksIntent':
      return NextResponse.json(await handleGetTodayTasks());

    case 'GetFamilyMessagesIntent':
      return NextResponse.json(await handleGetFamilyMessages());

    case 'AddShoppingItemIntent':
      return NextResponse.json(await handleAddShoppingItem({ slots }));

    case 'CompleteChoreIntent':
      return NextResponse.json(await handleCompleteChore({ slots }));

    case 'PostFamilyMessageIntent':
      return NextResponse.json(await handlePostFamilyMessage({ slots }));

    case 'GetFamilyIntent':
      return NextResponse.json(await handleGetFamily());

    case 'GetTodayMealIntent':
      return NextResponse.json(await handleGetTodayMeal());

    case 'GetTodayChoresIntent':
      return NextResponse.json(await handleGetTodayChores({ slots }));

    case 'GetWeatherIntent':
      return NextResponse.json(await handleGetWeather());

    case 'GetBusStatusIntent':
      return NextResponse.json(await handleGetBusStatus({ slots }));

    case 'GetUpcomingBirthdaysIntent':
      return NextResponse.json(await handleGetUpcomingBirthdays());

    case 'AMAZON.HelpIntent':
      return NextResponse.json(
        speak("You can ask me about today's events, what's coming up, today's tasks, recent family messages, add an item to a list, complete a chore, or post a family message."),
      );

    case 'AMAZON.CancelIntent':
    case 'AMAZON.StopIntent':
      return NextResponse.json(speak('Goodbye.'));

    default:
      return NextResponse.json(speak("I don't know how to do that yet."));
  }
}
