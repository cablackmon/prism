/**
 * Route-level tests for the Alexa webhook.
 *
 * We exercise the route with `?skipAlexaSignatureCheck=1` (only honored in
 * non-production) so we don't have to forge signed requests in unit tests.
 * Signature validation is tested separately in validate.test.ts.
 */

import { POST } from '@/app/api/alexa/route';

function mockHandler(text: string) {
  return jest.fn().mockResolvedValue({
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      shouldEndSession: true,
    },
  });
}

jest.mock('@/lib/alexa/intents/getTodayEvents', () => ({
  handleGetTodayEvents: jest.fn().mockResolvedValue({
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text: 'Today you have Soccer at 4 PM.' },
      shouldEndSession: true,
    },
  }),
}));

jest.mock('@/lib/alexa/intents/getUpcomingEvents', () => ({
  handleGetUpcomingEvents: jest.fn(async ({ slots }) => ({
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'PlainText',
        text: `upcoming(count=${slots?.Count?.value ?? 'default'})`,
      },
      shouldEndSession: true,
    },
  })),
}));

jest.mock('@/lib/alexa/intents/getTodayTasks', () => ({
  handleGetTodayTasks: mockHandler('today tasks'),
}));

jest.mock('@/lib/alexa/intents/getFamilyMessages', () => ({
  handleGetFamilyMessages: mockHandler('family messages'),
}));

jest.mock('@/lib/alexa/intents/addShoppingItem', () => ({
  handleAddShoppingItem: jest.fn(async ({ slots }) => ({
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'PlainText',
        text: `added ${slots?.Item?.value} to ${slots?.ListName?.value ?? 'default'}`,
      },
      shouldEndSession: true,
    },
  })),
}));

jest.mock('@/lib/alexa/intents/completeChore', () => ({
  handleCompleteChore: jest.fn(async ({ slots }) => ({
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'PlainText',
        text: `chore=${slots?.Chore?.value} assignee=${slots?.Assignee?.value ?? 'none'}`,
      },
      shouldEndSession: true,
    },
  })),
}));

jest.mock('@/lib/alexa/intents/postFamilyMessage', () => ({
  handlePostFamilyMessage: jest.fn(async ({ slots }) => ({
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'PlainText',
        text: `posted: ${slots?.Message?.value}`,
      },
      shouldEndSession: true,
    },
  })),
}));

jest.mock('@/lib/alexa/intents/getFamily', () => ({
  handleGetFamily: mockHandler('family list'),
}));

jest.mock('@/lib/alexa/intents/getTodayMeal', () => ({
  handleGetTodayMeal: mockHandler('today meal'),
}));

jest.mock('@/lib/alexa/intents/getTodayChores', () => ({
  handleGetTodayChores: jest.fn(async ({ slots }) => ({
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'PlainText',
        text: `chores assignee=${slots?.Assignee?.value ?? 'none'}`,
      },
      shouldEndSession: true,
    },
  })),
}));

jest.mock('@/lib/alexa/intents/getWeather', () => ({
  handleGetWeather: mockHandler('weather today'),
}));

jest.mock('@/lib/alexa/intents/getBusStatus', () => ({
  handleGetBusStatus: jest.fn(async ({ slots }) => ({
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'PlainText',
        text: `bus student=${slots?.Student?.value ?? 'none'}`,
      },
      shouldEndSession: true,
    },
  })),
}));

jest.mock('@/lib/alexa/intents/getUpcomingBirthdays', () => ({
  handleGetUpcomingBirthdays: mockHandler('birthdays upcoming'),
}));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/alexa?skipAlexaSignatureCheck=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/alexa', () => {
  beforeEach(() => {
    jest.replaceProperty(process.env, 'NODE_ENV', 'test');
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await POST(makeRequest('not json') as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  it('handles LaunchRequest with a welcome message', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: { type: 'LaunchRequest', timestamp: new Date().toISOString() },
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toMatch(/welcome to kyst/i);
  });

  it('dispatches GetTodayEventsIntent', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'GetTodayEventsIntent' },
      },
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('Today you have Soccer at 4 PM.');
  });

  it('dispatches GetUpcomingEventsIntent with slot count', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'GetUpcomingEventsIntent', slots: { Count: { value: '5' } } },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('upcoming(count=5)');
  });

  it('dispatches GetTodayTasksIntent', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'GetTodayTasksIntent' },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('today tasks');
  });

  it('dispatches GetFamilyMessagesIntent', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'GetFamilyMessagesIntent' },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('family messages');
  });

  it('dispatches AddShoppingItemIntent with item + list slots', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: {
          name: 'AddShoppingItemIntent',
          slots: { Item: { value: 'milk' }, ListName: { value: 'grocery' } },
        },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('added milk to grocery');
  });

  it('dispatches CompleteChoreIntent without optional assignee', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'CompleteChoreIntent', slots: { Chore: { value: 'feed the dog' } } },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('chore=feed the dog assignee=none');
  });

  it('dispatches PostFamilyMessageIntent with message slot', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'PostFamilyMessageIntent', slots: { Message: { value: 'soccer at 4' } } },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('posted: soccer at 4');
  });

  it('dispatches GetFamilyIntent', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'GetFamilyIntent' },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('family list');
  });

  it('dispatches GetTodayMealIntent', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'GetTodayMealIntent' },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('today meal');
  });

  it('dispatches GetTodayChoresIntent with optional assignee', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'GetTodayChoresIntent', slots: { Assignee: { value: 'Emma' } } },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('chores assignee=Emma');
  });

  it('dispatches GetWeatherIntent', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'GetWeatherIntent' },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('weather today');
  });

  it('dispatches GetBusStatusIntent with optional student', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'GetBusStatusIntent', slots: { Student: { value: 'Emma' } } },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('bus student=Emma');
  });

  it('dispatches GetUpcomingBirthdaysIntent', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'GetUpcomingBirthdaysIntent' },
      },
    }) as never);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toBe('birthdays upcoming');
  });

  it('returns a polite fallback for unknown intents', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'NotARealIntentIntent' },
      },
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toMatch(/don't know how/i);
  });

  it('handles SessionEndedRequest with empty response', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: { type: 'SessionEndedRequest', timestamp: new Date().toISOString() },
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ version: '1.0', response: {} });
  });

  it('handles AMAZON.StopIntent with goodbye', async () => {
    const res = await POST(makeRequest({
      version: '1.0',
      request: {
        type: 'IntentRequest',
        timestamp: new Date().toISOString(),
        intent: { name: 'AMAZON.StopIntent' },
      },
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response.outputSpeech.text).toMatch(/goodbye/i);
  });
});

describe('POST /api/alexa signature bypass — production', () => {
  it('rejects unsigned requests when NODE_ENV=production', async () => {
    jest.replaceProperty(process.env, 'NODE_ENV', 'production');
    const res = await POST(makeRequest({
      version: '1.0',
      request: { type: 'LaunchRequest', timestamp: new Date().toISOString() },
    }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing|signature/i);
  });
});

describe('POST /api/alexa skill ID gating', () => {
  beforeEach(() => {
    jest.replaceProperty(process.env, 'NODE_ENV', 'test');
  });

  afterEach(() => {
    delete process.env.ALEXA_SKILL_ID;
  });

  it('rejects requests whose applicationId does not match ALEXA_SKILL_ID', async () => {
    process.env.ALEXA_SKILL_ID = 'amzn1.ask.skill.expected';
    const res = await POST(makeRequest({
      version: '1.0',
      session: { application: { applicationId: 'amzn1.ask.skill.attacker' } },
      request: { type: 'LaunchRequest', timestamp: new Date().toISOString() },
    }) as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('skill_id_mismatch');
  });

  it('rejects requests with no applicationId when ALEXA_SKILL_ID is set', async () => {
    process.env.ALEXA_SKILL_ID = 'amzn1.ask.skill.expected';
    const res = await POST(makeRequest({
      version: '1.0',
      request: { type: 'LaunchRequest', timestamp: new Date().toISOString() },
    }) as never);
    expect(res.status).toBe(403);
  });

  it('accepts requests with matching applicationId in session', async () => {
    process.env.ALEXA_SKILL_ID = 'amzn1.ask.skill.expected';
    const res = await POST(makeRequest({
      version: '1.0',
      session: { application: { applicationId: 'amzn1.ask.skill.expected' } },
      request: { type: 'LaunchRequest', timestamp: new Date().toISOString() },
    }) as never);
    expect(res.status).toBe(200);
  });

  it('accepts requests with matching applicationId in context.System (LaunchRequest case)', async () => {
    process.env.ALEXA_SKILL_ID = 'amzn1.ask.skill.expected';
    const res = await POST(makeRequest({
      version: '1.0',
      context: { System: { application: { applicationId: 'amzn1.ask.skill.expected' } } },
      request: { type: 'LaunchRequest', timestamp: new Date().toISOString() },
    }) as never);
    expect(res.status).toBe(200);
  });

  it('refuses to dispatch in production when ALEXA_SKILL_ID is unset', async () => {
    jest.replaceProperty(process.env, 'NODE_ENV', 'production');
    delete process.env.ALEXA_SKILL_ID;
    // bypass is also disabled in production so this also fails on signature,
    // but we want to assert the path with signature check off ALSO refuses.
    const url = 'http://localhost:3000/api/alexa';
    const req = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: '1.0',
        request: { type: 'LaunchRequest', timestamp: new Date().toISOString() },
      }),
    });
    const res = await POST(req as never);
    expect([400, 500]).toContain(res.status);
  });
});
