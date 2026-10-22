import { browserOAuthUsable } from '@/lib/utils/googleRedirectSupport';

// Existing tests cover common public, LAN, single-label and absent origins.
// These cases exercise the missing protocol, IPv6 and hostname boundaries.
describe('Google browser OAuth origin edge cases', () => {
  test.each(['http://[::1]:8091', 'https://[::1]:8443'])('permits the IPv6 loopback exception at %s', (origin) => {
    expect(browserOAuthUsable(origin)).toBe(true);
  });

  test.each(['https://[2001:db8::5]', 'https://[fd00::5]', 'https://[::ffff:192.0.2.1]'])('rejects a nonloopback IPv6 literal at %s', (origin) => {
    expect(browserOAuthUsable(origin)).toBe(false);
  });

  test.each(['https://PRISM.LAN', 'https://Prism.HOME:8443', 'https://prism.localdomain'])('rejects the remaining private hostname suffix at %s', (origin) => {
    expect(browserOAuthUsable(origin)).toBe(false);
  });

  test('accepts a public internationalized hostname after standard URL parsing', () => {
    expect(browserOAuthUsable('https://bücher.de')).toBe(true);
  });

  test.each(['ftp://prism.example.com', 'wss://prism.example.com'])('rejects a nonweb protocol on a public domain at %s', (origin) => {
    expect(browserOAuthUsable(origin)).toBe(false);
  });

  test.failing.each(['ftp://localhost:2121', 'ws://127.0.0.1:8091'])('KNOWN GAP: loopback bypass accepts a nonweb OAuth redirect scheme at %s', (origin) => {
    expect(browserOAuthUsable(origin)).toBe(false);
  });

  test.failing.each(['https://prism.local.', 'https://prism.internal.'])('KNOWN GAP: a trailing DNS dot bypasses private hostname rejection at %s', (origin) => {
    expect(browserOAuthUsable(origin)).toBe(false);
  });
});
