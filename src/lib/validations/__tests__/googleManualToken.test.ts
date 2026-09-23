import { googleManualTokenSchema } from '../googleManualToken';

const valid = {
  clientId: '1234567890-abcDEF123.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-abcDEF123_secret',
  refreshToken: '1//0gABCdef-_123/456',
};

describe('googleManualTokenSchema', () => {
  it('accepts realistic Playground values and defaults overwriteCredentials', () => {
    const parsed = googleManualTokenSchema.parse(valid);
    expect(parsed.clientId).toBe(valid.clientId);
    expect(parsed.overwriteCredentials).toBe(false);
  });

  it('trims surrounding whitespace before validating', () => {
    const parsed = googleManualTokenSchema.parse({
      ...valid,
      refreshToken: `  ${valid.refreshToken}  `,
    });
    expect(parsed.refreshToken).toBe(valid.refreshToken);
  });

  it('rejects a client ID without the googleusercontent suffix', () => {
    expect(
      googleManualTokenSchema.safeParse({ ...valid, clientId: 'not-a-google-client' }).success
    ).toBe(false);
  });

  it('rejects a client secret with spaces or control characters', () => {
    expect(
      googleManualTokenSchema.safeParse({ ...valid, clientSecret: 'has spaces' }).success
    ).toBe(false);
    expect(
      googleManualTokenSchema.safeParse({ ...valid, clientSecret: 'tab\tsecret' }).success
    ).toBe(false);
  });

  it('rejects a refresh token with HTML / quote characters (injection guard)', () => {
    expect(
      googleManualTokenSchema.safeParse({ ...valid, refreshToken: '"><img src=x>' }).success
    ).toBe(false);
    expect(
      googleManualTokenSchema.safeParse({ ...valid, refreshToken: "1//0g';DROP" }).success
    ).toBe(false);
  });

  it('rejects empty and overlong values', () => {
    expect(googleManualTokenSchema.safeParse({ ...valid, refreshToken: '' }).success).toBe(false);
    expect(
      googleManualTokenSchema.safeParse({ ...valid, refreshToken: '1'.repeat(2000) }).success
    ).toBe(false);
    expect(googleManualTokenSchema.safeParse({ ...valid, clientSecret: '' }).success).toBe(false);
  });
});
