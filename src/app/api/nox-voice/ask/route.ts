import { NextRequest, NextResponse } from 'next/server';

const VOICE_PROXY = 'https://kyst-wall-proxy.fly.dev';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim() || '';
  if (!contentType.startsWith('audio/')) {
    return NextResponse.json({ error: 'audio content type required' }, { status: 415 });
  }

  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'request too large' }, { status: 413 });
  }

  const audio = await request.arrayBuffer();
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'request too large' }, { status: 413 });
  }

  const upstream = await fetch(`${VOICE_PROXY}/ask`, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      cookie: request.headers.get('cookie') || '',
      // The proxy accepts requests from its own trusted browser origin and then
      // independently verifies the forwarded live Prism session cookie.
      origin: VOICE_PROXY,
    },
    body: audio,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
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
