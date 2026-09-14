import { NextRequest } from 'next/server';

const constantTimeSecretEqual = jest.fn();
const createHouseholdSession = jest.fn();
const getHouseholdAuthState = jest.fn();

jest.mock('@/lib/auth/householdAuth', () => ({
  constantTimeSecretEqual: (...args: unknown[]) => constantTimeSecretEqual(...args),
  createHouseholdSession: (...args: unknown[]) => createHouseholdSession(...args),
  getHouseholdAuthState: () => getHouseholdAuthState(),
  householdCookieOptions: () => ({ httpOnly: true, path: '/', secure: true }),
  HOUSEHOLD_COOKIE_NAME: 'kyst_household_session',
}));

import { GET } from '../route';
import { requestedDeviceDestination } from '@/lib/auth/deviceHandoff';

function request(query = '') {
  return new NextRequest(`https://kyst-board.fly.dev/api/household-auth/device${query}`);
}

describe('GET /api/household-auth/device', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KYST_AUTH_DEVICE_TOKEN = `v1.${'a'.repeat(64)}`;
    process.env.KYST_AUTH_SECRET = 's'.repeat(64);
    getHouseholdAuthState.mockReturnValue('ready');
    constantTimeSecretEqual.mockResolvedValue(true);
    createHouseholdSession.mockResolvedValue('signed-session');
  });

  afterEach(() => {
    delete process.env.KYST_AUTH_DEVICE_TOKEN;
    delete process.env.KYST_AUTH_SECRET;
  });

  it('sets the session and redirects an explicit wall destination', async () => {
    const response = await GET(request(`?token=${process.env.KYST_AUTH_DEVICE_TOKEN}&next=%2Fwall.html`));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://kyst-one.vercel.app/wall.html');
    expect(location.searchParams.get('handoff')).toMatch(/^v1\./);
    expect(response.headers.get('set-cookie')).toContain('kyst_household_session=signed-session');
  });

  it.each([
    ['', '/wall.html'],
    ['?next=%2F%2Fevil.example%2Fwall.html', '/'],
    ['?next=https%3A%2F%2Fevil.example%2Fwall.html', '/'],
    ['?next=%2Fwall.html%3Fmode%3Dunsafe', '/'],
    ['?next=%2Fother', '/'],
    ['?next=%2Fwall.html', '/wall.html'],
  ])('validates destination %s', (query, expected) => {
    expect(requestedDeviceDestination(request(query))).toBe(expected);
  });

  it('does not redirect when the device credential is rejected', async () => {
    constantTimeSecretEqual.mockResolvedValue(false);

    const response = await GET(request('?token=invalid&next=%2Fwall.html'));

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
