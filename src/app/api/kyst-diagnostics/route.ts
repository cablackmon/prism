import { Collector, Refusal, digest } from '@/lib/diagnostics/store';
import {
  HOUSEHOLD_COOKIE_NAME,
  HOUSEHOLD_SERVICE_HEADER,
  constantTimeSecretEqual,
  validateHouseholdSession,
  getHouseholdAuthState,
} from '@/lib/auth/householdAuth';
import pins from '@/lib/diagnostics/generated-pins.json';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function collector() {
  if (process.env.KYST_DIAGNOSTIC_ENABLED !== '1') throw new Refusal('Diagnostics disabled', 404);
  // A single, existing persistent volume. Never /tmp or process memory in production.
  const directory =
    process.env.NODE_ENV === 'production'
      ? '/app/data/nox11625-diagnostics'
      : process.env.KYST_DIAGNOSTIC_TEST_DIR;
  if (!directory) throw new Refusal('Persistent collector directory required', 503);
  const origin =
    process.env.NODE_ENV === 'production'
      ? 'https://kyst-wall-proxy.fly.dev'
      : process.env.KYST_DIAGNOSTIC_TEST_ORIGIN;
  if (!origin) throw new Refusal('Exact browser origin required', 503);
  return new Collector(directory, pins.build, pins.probe, origin);
}
async function authenticate(request: Request) {
  if (getHouseholdAuthState() !== 'ready')
    throw new Refusal('Household authentication required', 401);
  const supplied = request.headers.get(HOUSEHOLD_SERVICE_HEADER),
    expected = process.env.KYST_AUTH_SERVICE_TOKEN;
  const operator = !!supplied && !!expected && (await constantTimeSecretEqual(supplied, expected));
  // The existing proxy rewrites Origin to the upstream origin. Operator control is direct, no Origin.
  if (operator && !request.headers.get('origin')) return { operator: true, cookieHash: '' };
  const origin = request.headers.get('origin');
  const expectedOrigin =
    process.env.NODE_ENV === 'production'
      ? 'https://kyst-board.fly.dev'
      : process.env.KYST_DIAGNOSTIC_TEST_ORIGIN;
  if (request.method !== 'GET' && origin !== expectedOrigin)
    throw new Refusal('Wrong browser Origin', 403);
  const cookie = (request.headers.get('cookie') || '')
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(HOUSEHOLD_COOKIE_NAME + '='))
    ?.slice(HOUSEHOLD_COOKIE_NAME.length + 1);
  if (!(await validateHouseholdSession(cookie, process.env.KYST_AUTH_SECRET!)).valid)
    throw new Refusal('Valid household cookie required', 401);
  return { operator: false, cookieHash: digest(cookie!) };
}
export async function GET(request: Request) {
  try {
    const c = collector();
    await authenticate(request);
    return reply(c.config());
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : 'Failure' },
      e instanceof Refusal ? e.status : 400
    );
  }
}
export async function POST(request: Request) {
  try {
    const c = collector(),
      identity = await authenticate(request);
    // Bound bytes while reading, not just an untrusted Content-Length header.
    const reader = request.body?.getReader();
    if (!reader) throw new Refusal('Body required', 400);
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 32768) {
        await reader.cancel();
        throw new Refusal('Body too large', 413);
      }
      chunks.push(value);
    }
    const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return reply(c.handle(raw, identity.operator, identity.cookieHash));
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : 'Failure' },
      e instanceof Refusal ? e.status : 400
    );
  }
}
