import {
  createDeviceHandoff,
  deviceAuthRedirect,
  DEVICE_HANDOFF_TTL_SECONDS,
  requestedDeviceDestination,
  WALL_PROXY_AUDIENCE,
} from '../deviceHandoff';

describe('device handoff', () => {
  it('creates an audience-bound token with a 60 second lifetime', async () => {
    const token = await createDeviceHandoff('s'.repeat(64), 1000, 'n'.repeat(32));
    const parts = token.split('.');
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual([
      'v1',
      '1000',
      String(1000 + DEVICE_HANDOFF_TTL_SECONDS),
      'n'.repeat(32),
    ]);
    expect(Buffer.from(parts[4]!, 'base64url').toString()).toBe(WALL_PROXY_AUDIENCE);
  });

  it('accepts only the exact wall path', () => {
    expect(requestedDeviceDestination(new Request('https://kyst-board.fly.dev/x'))).toBe(
      '/wall.html'
    );
    expect(
      requestedDeviceDestination(new Request('https://kyst-board.fly.dev/x?next=%2Fwall.html'))
    ).toBe('/wall.html');
    expect(
      requestedDeviceDestination(
        new Request('https://kyst-board.fly.dev/x?next=https%3A%2F%2Fevil.test')
      )
    ).toBe('/');
  });

  it('keeps accepted device destinations on the authenticated board origin', async () => {
    const [wallRedirect, fallbackRedirect] = await Promise.all([
      deviceAuthRedirect(
        new Request('https://kyst-board.fly.dev/api/household-auth/device?next=%2Fwall.html'),
        's'.repeat(64)
      ),
      deviceAuthRedirect(
        new Request(
          'https://kyst-board.fly.dev/api/household-auth/device?next=https%3A%2F%2Fevil.test'
        ),
        's'.repeat(64)
      ),
    ]);
    const wall = new URL(wallRedirect);
    expect(wall.origin + wall.pathname).toBe('https://kyst-board.fly.dev/wall.html');
    expect(wall.searchParams.get('handoff')).toMatch(/^v1\./);
    expect(fallbackRedirect).toBe('https://kyst-board.fly.dev/');
  });

  it.each(['80', '3000'])(
    'pins the wall redirect to public HTTPS when the inbound authority uses port %s',
    async (port) => {
      const redirect = new URL(
        await deviceAuthRedirect(
          new Request(
            `https://kyst-board.fly.dev:${port}/api/household-auth/device?next=%2Fwall.html`
          ),
          's'.repeat(64)
        )
      );

      expect(redirect.origin + redirect.pathname).toBe('https://kyst-board.fly.dev/wall.html');
      expect(redirect.protocol).toBe('https:');
      expect(redirect.port || '443').toBe('443');
      expect(redirect.searchParams.get('handoff')).toMatch(/^v1\./);
    }
  );

  it.each(['80', '3000'])(
    'keeps invalid destinations on the public board root when the inbound authority uses port %s',
    async (port) => {
      const redirect = await deviceAuthRedirect(
        new Request(
          `https://kyst-board.fly.dev:${port}/api/household-auth/device?next=https%3A%2F%2Fevil.test`
        ),
        's'.repeat(64)
      );

      expect(redirect).toBe('https://kyst-board.fly.dev/');
    }
  );
});
