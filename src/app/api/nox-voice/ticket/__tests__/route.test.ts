import { NextRequest } from 'next/server';

import { POST } from '../route';

describe('POST /api/nox-voice/ticket', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('relays the live board session to the reviewed proxy ticket endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: 'wss://example.test/voice', token: 'ticket' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    global.fetch = fetchMock;
    const request = new NextRequest('https://kyst-board.fly.dev/api/nox-voice/ticket', {
      method: 'POST',
      headers: { cookie: 'prism_session=live; prism_user=member' },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kyst-wall-proxy.fly.dev/voice/stream-ticket',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: expect.objectContaining({
          cookie: 'prism_session=live; prism_user=member',
          origin: 'https://kyst-wall-proxy.fly.dev',
        }),
      })
    );
  });

  it('preserves fail-closed auth and retry responses', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'authenticated board session required' }), {
        status: 401,
        headers: { 'content-type': 'application/json', 'retry-after': '60' },
      })
    );

    const response = await POST(
      new NextRequest('https://kyst-board.fly.dev/api/nox-voice/ticket', { method: 'POST' })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('60');
  });
});
