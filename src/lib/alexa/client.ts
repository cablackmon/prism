/**
 * Thin client over the Voice API used by Alexa intent handlers.
 *
 * The Alexa webhook is a server inside the same Next.js process as the Voice
 * API, but we still go through the public HTTP surface (rather than calling
 * Drizzle directly) so the contract Alexa exercises is the same one external
 * callers — HACS users, scripts — exercise. If voicePhrases or rate-limit
 * behavior changes, Alexa benefits automatically.
 *
 * Auth uses a server-side bearer token in the `ALEXA_VOICE_TOKEN` env var.
 * Generate it once in Settings → API Tokens with the `voice` scope and add
 * it to your `.env`. See `alexa/README.md`.
 */

const DEFAULT_BASE_URL = process.env.APP_URL || 'http://localhost:3000';

export class VoiceApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`Voice API ${status}`);
    this.status = status;
    this.body = body;
  }
}

interface VoiceResponse<T = unknown> {
  ok: boolean;
  spoken: string;
  data?: T;
}

function token(): string {
  const t = process.env.ALEXA_VOICE_TOKEN;
  if (!t) throw new Error('ALEXA_VOICE_TOKEN is not set; cannot call Voice API');
  return t;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<VoiceResponse<T>> {
  const url = `${DEFAULT_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) throw new VoiceApiError(res.status, parsed);
  return parsed as VoiceResponse<T>;
}

export const voiceClient = {
  getCalendarToday: () =>
    request<{ count: number; events: unknown[] }>('GET', '/api/v1/voice/calendar/today'),
  getCalendarUpcoming: (count = 3) =>
    request<{ count: number; events: unknown[] }>(
      'GET',
      `/api/v1/voice/calendar/upcoming?count=${count}`
    ),
  getTasksToday: () =>
    request<{ count: number; tasks: unknown[] }>('GET', '/api/v1/voice/tasks/today'),
  getRecentMessages: (count = 3) =>
    request<{ count: number; messages: unknown[] }>(
      'GET',
      `/api/v1/voice/message/recent?count=${count}`
    ),
  postShoppingItem: (body: { item: string; list?: string; quantity?: number; unit?: string }) =>
    request('POST', '/api/v1/voice/shopping/add', body),
  completeChore: (body: { chore: string; assignee?: string }) =>
    request<{ candidates?: { title: string; assignee: string | null }[] }>(
      'POST',
      '/api/v1/voice/chore/complete',
      body
    ),
  postFamilyMessage: (body: { message: string }) =>
    request('POST', '/api/v1/voice/message/post', body),
  getFamily: () => request<{ count: number; members: unknown[] }>('GET', '/api/v1/voice/family'),
  getMealsToday: () =>
    request<{ count: number; meals: unknown[] }>('GET', '/api/v1/voice/meals/today'),
  getChoresToday: (assignee?: string) =>
    request<{ count: number; chores: unknown[] }>(
      'GET',
      assignee
        ? `/api/v1/voice/chores/today?assignee=${encodeURIComponent(assignee)}`
        : '/api/v1/voice/chores/today'
    ),
  getWeatherToday: () => request<unknown>('GET', '/api/v1/voice/weather/today'),
  getBusStatus: (student?: string) =>
    request<{ count: number; routes: unknown[] }>(
      'GET',
      student
        ? `/api/v1/voice/bus/status?student=${encodeURIComponent(student)}`
        : '/api/v1/voice/bus/status'
    ),
  getUpcomingBirthdays: (days = 30) =>
    request<{ count: number; birthdays: unknown[] }>(
      'GET',
      `/api/v1/voice/birthdays/upcoming?days=${days}`
    ),
};
