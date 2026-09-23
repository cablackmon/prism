import { z } from 'zod';

/**
 * Validation for the manual Google refresh-token connect flow (OAuth Playground).
 *
 * These three values are pasted by an admin and are high-value credentials, so
 * the schema is deliberately strict on charset + length: the values are only
 * ever sent to Google as URL-encoded form bodies and then stored encrypted, and
 * a tight regex keeps anything unexpected out before it reaches either.
 */
export const googleManualTokenSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(20)
    .max(200)
    .regex(
      /^[A-Za-z0-9\-_.]+\.apps\.googleusercontent\.com$/,
      'Must be a Google OAuth client ID ending in .apps.googleusercontent.com'
    ),
  clientSecret: z
    .string()
    .trim()
    .min(10)
    .max(200)
    // Printable ASCII, no spaces (Google secrets look like "GOCSPX-…").
    .regex(/^[\x21-\x7e]+$/, 'Invalid characters in client secret'),
  refreshToken: z
    .string()
    .trim()
    .min(20)
    .max(1024)
    // Playground refresh tokens look like "1//0g…".
    .regex(/^[A-Za-z0-9\-_./]+$/, 'Invalid characters in refresh token'),
  // Explicit consent to replace an existing, *different* stored client id/secret.
  overwriteCredentials: z.boolean().optional().default(false),
});

export type GoogleManualTokenInput = z.infer<typeof googleManualTokenSchema>;
