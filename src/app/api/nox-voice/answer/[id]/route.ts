import { NextRequest, NextResponse } from 'next/server';

const VOICE_PROXY = 'https://kyst-wall-proxy.fly.dev';
const JOB_ID = /^[0-9a-f-]{36}$/i;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!JOB_ID.test(id)) {
    return NextResponse.json({ error: 'invalid request id' }, { status: 400 });
  }

  const upstream = await fetch(`${VOICE_PROXY}/answer/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
      ...(upstream.headers.get('x-nox-meta')
        ? { 'x-nox-meta': upstream.headers.get('x-nox-meta')! }
        : {}),
    },
  });
}
