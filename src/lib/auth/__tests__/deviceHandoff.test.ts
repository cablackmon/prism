import {
  createDeviceHandoff,
  DEVICE_HANDOFF_TTL_SECONDS,
  requestedDeviceDestination,
  WALL_PROXY_AUDIENCE,
} from '../deviceHandoff';

describe('device handoff', () => {
  it('creates an audience-bound token with a 60 second lifetime', async () => {
    const token = await createDeviceHandoff('s'.repeat(64), 1000, 'n'.repeat(32));
    const parts = token.split('.');
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual(['v1', '1000', String(1000 + DEVICE_HANDOFF_TTL_SECONDS), 'n'.repeat(32)]);
    expect(Buffer.from(parts[4]!, 'base64url').toString()).toBe(WALL_PROXY_AUDIENCE);
  });

  it('accepts only the exact wall path', () => {
    expect(requestedDeviceDestination(new Request('https://kyst-board.fly.dev/x'))).toBe('/wall.html');
    expect(requestedDeviceDestination(new Request('https://kyst-board.fly.dev/x?next=%2Fwall.html'))).toBe('/wall.html');
    expect(requestedDeviceDestination(new Request('https://kyst-board.fly.dev/x?next=https%3A%2F%2Fevil.test'))).toBe('/');
  });
});
