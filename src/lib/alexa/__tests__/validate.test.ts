import { isCertChainUrlValid, AlexaSignatureError, verifyAlexaRequest } from '../validate';

describe('isCertChainUrlValid', () => {
  it.each([
    'https://s3.amazonaws.com/echo.api/echo-api-cert-12.pem',
    'https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem',
    'https://s3.amazonaws.com/echo.api/sub/cert.pem',
  ])('accepts %s', (url) => {
    expect(isCertChainUrlValid(url)).toBe(true);
  });

  it.each([
    'http://s3.amazonaws.com/echo.api/cert.pem', // not https
    'https://notamazon.com/echo.api/cert.pem', // wrong host
    'https://s3.amazonaws.com:8443/echo.api/cert.pem', // wrong port
    'https://s3.amazonaws.com/EVIL/cert.pem', // wrong path
    'not a url',
  ])('rejects %s', (url) => {
    expect(isCertChainUrlValid(url)).toBe(false);
  });

  it('rejects path with traversal that does not start with /echo.api/', () => {
    expect(isCertChainUrlValid('https://s3.amazonaws.com/echo.api.evil/cert.pem')).toBe(false);
  });
});

describe('verifyAlexaRequest input validation', () => {
  const baseArgs = {
    rawBody: '{}',
    certChainUrl: 'https://s3.amazonaws.com/echo.api/cert.pem',
    signature: 'AAAA',
    signature256: null,
    parsedTimestamp: new Date().toISOString(),
  };

  it('throws when cert chain URL is missing', async () => {
    await expect(verifyAlexaRequest({ ...baseArgs, certChainUrl: null })).rejects.toBeInstanceOf(
      AlexaSignatureError
    );
  });

  it('throws when both signatures are missing', async () => {
    await expect(
      verifyAlexaRequest({ ...baseArgs, signature: null, signature256: null })
    ).rejects.toBeInstanceOf(AlexaSignatureError);
  });

  it('throws when timestamp is missing', async () => {
    await expect(verifyAlexaRequest({ ...baseArgs, parsedTimestamp: null })).rejects.toBeInstanceOf(
      AlexaSignatureError
    );
  });

  it('throws when timestamp is too old', async () => {
    const oldTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await expect(verifyAlexaRequest({ ...baseArgs, parsedTimestamp: oldTs })).rejects.toThrow(
      /tolerance/i
    );
  });

  it('throws when cert chain URL is malformed', async () => {
    await expect(
      verifyAlexaRequest({ ...baseArgs, certChainUrl: 'http://evil.com/cert.pem' })
    ).rejects.toThrow(/cert URL/i);
  });
});
