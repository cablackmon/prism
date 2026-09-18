import { NextRequest, NextResponse } from 'next/server';

const VOICE_PROXY = 'https://kyst-wall-proxy.fly.dev';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const upstream = await fetch(`${VOICE_PROXY}/voice/stream-ticket`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      cookie: request.headers.get('cookie') || '',
      origin: VOICE_PROXY,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
      ...(upstream.headers.get('retry-after')
        ? { 'retry-after': upstream.headers.get('retry-after')! }
        : {}),
    },
  });
}
