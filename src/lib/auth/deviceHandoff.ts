const encoder = new TextEncoder();

export const WALL_DESTINATION = '/wall.html';
export const WALL_WRAPPER_URL = 'https://kyst-one.vercel.app/wall.html';
export const WALL_PROXY_AUDIENCE = 'https://kyst-wall-proxy.fly.dev';
export const DEVICE_HANDOFF_TTL_SECONDS = 60;

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}

function nonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function requestedDeviceDestination(request: Request): '/' | typeof WALL_DESTINATION {
  const value = new URL(request.url).searchParams.get('next');
  return value === WALL_DESTINATION ? WALL_DESTINATION : '/';
}

export async function createDeviceHandoff(
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  tokenNonce = nonce()
): Promise<string> {
  const expiresAt = nowSeconds + DEVICE_HANDOFF_TTL_SECONDS;
  const payload = `v1.${nowSeconds}.${expiresAt}.${tokenNonce}.${base64Url(WALL_PROXY_AUDIENCE)}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function deviceAuthRedirect(request: Request, secret: string): Promise<string> {
  if (requestedDeviceDestination(request) !== WALL_DESTINATION) return '/';
  const destination = new URL(WALL_WRAPPER_URL);
  destination.searchParams.set('handoff', await createDeviceHandoff(secret));
  return destination.href;
}
