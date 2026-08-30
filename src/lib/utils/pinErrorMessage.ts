/**
 * Turning a failed PIN response into something a person can act on.
 *
 * Three PIN pads each hardcoded `setError('Incorrect PIN')` and discarded the
 * response body. The API sends more than that: a reason, how many tries are
 * left, and — when the account is locked out — how long for.
 *
 * The consequence was worst exactly where it mattered. After five wrong
 * attempts the lockout escalates (5 minutes, then 15, then an hour, then
 * four), and during that window the CORRECT PIN also fails. The display said
 * "Incorrect PIN". Someone who had just typed their own PIN correctly was
 * told, for up to four hours, that it was wrong — with nothing suggesting
 * waiting would help.
 *
 * On a kitchen wall display the person hitting this is usually the one least
 * able to reason about it.
 */

export interface PinFailureResponse {
  error?: string;
  lockedOut?: boolean;
  /** Seconds until another attempt is allowed. */
  retryAfter?: number;
  remainingAttempts?: number;
  pinRequired?: boolean;
}

/**
 * A clock time reads better than a duration on a wall display: "try again at
 * 4:15" needs no arithmetic and stays true if you walk away and come back,
 * where "try again in 300 seconds" is stale the moment you read it.
 */
function formatRetryTime(retryAfterSeconds: number, now: Date): string {
  const when = new Date(now.getTime() + retryAfterSeconds * 1000);
  return when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * @param status  HTTP status from the PIN endpoint.
 * @param body    Parsed response body, or null if it could not be read.
 * @param now     Injected for testing.
 */
export function pinErrorMessage(
  status: number,
  body: PinFailureResponse | null,
  now: Date = new Date(),
): string {
  // Nothing readable came back — usually the hub being unreachable rather than
  // anything to do with the PIN, so do not accuse the user of getting it wrong.
  if (!body) {
    return status === 0
      ? "Can't reach Prism right now. Try again in a moment."
      : 'Something went wrong. Try again in a moment.';
  }

  if (body.lockedOut) {
    const when = typeof body.retryAfter === 'number' && body.retryAfter > 0
      ? ` Try again at ${formatRetryTime(body.retryAfter, now)}.`
      : ' Try again shortly.';
    return `Too many tries.${when}`;
  }

  // The member has no PIN at all. The API's own wording is written for a
  // support ticket; this says who can fix it and where.
  if (body.pinRequired) {
    return 'No PIN set for this person yet. A parent can add one in Settings, Family Members.';
  }

  if (typeof body.remainingAttempts === 'number') {
    if (body.remainingAttempts <= 0) return 'Too many tries. Try again shortly.';
    if (body.remainingAttempts === 1) {
      return "That PIN didn't work. 1 try left before this locks for a few minutes.";
    }
    return `That PIN didn't work. ${body.remainingAttempts} tries left.`;
  }

  // Fall back to whatever the server said before inventing our own wording.
  return body.error || "That PIN didn't work.";
}
