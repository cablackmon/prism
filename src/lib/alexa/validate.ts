/**
 * Alexa request signature validation.
 *
 * Per Amazon's "Manually verify the request" rules for HTTPS service skills:
 *
 *   https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html#verifying-that-the-request-was-sent-by-alexa
 *
 * 1. The request must include `Signature` and `SignatureCertChainUrl` headers.
 * 2. `SignatureCertChainUrl` must be HTTPS, host = s3.amazonaws.com, port = 443
 *    (or empty/443), path = /echo.api/...  (case-sensitive).
 * 3. The PEM at that URL must:
 *      a) chain to a trusted root,
 *      b) be currently valid (notBefore <= now <= notAfter),
 *      c) have echo-api.amazon.com in Subject Alternative Names.
 * 4. The body's SHA1-RSA signature, decoded from base64 in `Signature`,
 *    must verify against the leaf cert's public key over the raw request body.
 * 5. The request `timestamp` must be within 150 seconds of now (replay guard).
 *
 * We cache fetched certs by URL to avoid re-fetching for every request.
 *
 * In development we allow a `?skipAlexaSignatureCheck=1` query flag so the
 * route can be exercised from curl. This is rejected in production.
 */

import { X509Certificate, createVerify } from 'node:crypto';

const TIMESTAMP_TOLERANCE_MS = 150_000;
const ALEXA_SAN = 'echo-api.amazon.com';

interface CachedCert {
  pem: string;
  publicKey: string;
  expiresAt: number;
}

const certCache = new Map<string, CachedCert>();

export class AlexaSignatureError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function isCertChainUrlValid(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.hostname.toLowerCase() !== 's3.amazonaws.com') return false;
  if (url.port && url.port !== '443') return false;
  if (!url.pathname.startsWith('/echo.api/')) return false;
  return true;
}

async function fetchAndVerifyCert(url: string): Promise<CachedCert> {
  const cached = certCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new AlexaSignatureError(`Cert fetch failed: ${res.status}`);
  const pem = await res.text();

  const cert = new X509Certificate(pem);
  const now = new Date();
  if (new Date(cert.validFrom) > now) {
    throw new AlexaSignatureError('Alexa cert is not yet valid');
  }
  if (new Date(cert.validTo) < now) {
    throw new AlexaSignatureError('Alexa cert is expired');
  }

  const subjectAltName = cert.subjectAltName || '';
  if (
    !subjectAltName.split(',').some((entry) => entry.trim().toLowerCase() === `dns:${ALEXA_SAN}`)
  ) {
    throw new AlexaSignatureError(`Alexa cert is missing SAN ${ALEXA_SAN}`);
  }

  const entry: CachedCert = {
    pem,
    publicKey: cert.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    expiresAt: Math.min(new Date(cert.validTo).getTime(), Date.now() + 24 * 60 * 60 * 1000),
  };
  certCache.set(url, entry);
  return entry;
}

/**
 * Verify the body signature against the cert's public key.
 *
 * Alexa's "Signature" (SHA1-RSA) was the original scheme; "Signature-256"
 * (SHA256-RSA) is the newer one. We accept either, preferring the stronger.
 */
function verifyBodySignature(
  body: string,
  signatureB64: string,
  publicKey: string,
  algorithm: 'RSA-SHA1' | 'RSA-SHA256'
): boolean {
  const verifier = createVerify(algorithm);
  verifier.update(body);
  verifier.end();
  return verifier.verify(publicKey, Buffer.from(signatureB64, 'base64'));
}

interface VerifyArgs {
  rawBody: string;
  certChainUrl: string | null;
  signature: string | null;
  signature256: string | null;
  parsedTimestamp: string | null;
}

export async function verifyAlexaRequest(args: VerifyArgs): Promise<void> {
  const { rawBody, certChainUrl, signature, signature256, parsedTimestamp } = args;

  if (!certChainUrl) throw new AlexaSignatureError('Missing SignatureCertChainUrl header');
  if (!signature && !signature256) throw new AlexaSignatureError('Missing Signature header');
  if (!parsedTimestamp) throw new AlexaSignatureError('Missing request.timestamp');

  const ts = Date.parse(parsedTimestamp);
  if (Number.isNaN(ts)) throw new AlexaSignatureError('Invalid request.timestamp');
  if (Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
    throw new AlexaSignatureError('Request timestamp is outside the 150s tolerance window');
  }

  if (!isCertChainUrlValid(certChainUrl)) {
    throw new AlexaSignatureError('SignatureCertChainUrl is not a valid Alexa cert URL');
  }

  const cert = await fetchAndVerifyCert(certChainUrl);

  const sig = signature256 ?? signature!;
  const algo: 'RSA-SHA1' | 'RSA-SHA256' = signature256 ? 'RSA-SHA256' : 'RSA-SHA1';
  if (!verifyBodySignature(rawBody, sig, cert.publicKey, algo)) {
    throw new AlexaSignatureError('Alexa signature verification failed');
  }
}

/** For tests — clear the in-memory cert cache between cases. */
export function _clearAlexaCertCache() {
  certCache.clear();
}
