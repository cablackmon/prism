/**
 * What a failed PIN entry tells the person standing at the display.
 *
 * The case that motivated this: after five wrong attempts the account locks
 * out, and during the lockout the CORRECT PIN also fails. Every pad said
 * "Incorrect PIN", so someone who had just typed their own PIN correctly was
 * told for up to four hours that it was wrong, with no hint that waiting would
 * help. On a kitchen display that reads as a broken screen, not a lockout.
 */
import { pinErrorMessage } from '../pinErrorMessage';

const NOW = new Date('2026-08-30T16:10:00');

describe('pinErrorMessage — lockout', () => {
  it('says it is a lockout and when to come back, not that the PIN is wrong', () => {
    const msg = pinErrorMessage(403, { lockedOut: true, retryAfter: 300 }, NOW);
    expect(msg).toContain('Too many tries');
    expect(msg).toContain('4:15'); // 16:10 + 5 minutes, in local format
    expect(msg.toLowerCase()).not.toContain("didn't work");
  });

  it('still says something useful when the server omits a retry time', () => {
    const msg = pinErrorMessage(403, { lockedOut: true }, NOW);
    expect(msg).toContain('Too many tries');
    expect(msg).toContain('shortly');
  });
});

describe('pinErrorMessage — ordinary wrong PIN', () => {
  it('counts down the tries left, so the lockout is not a surprise', () => {
    expect(pinErrorMessage(401, { remainingAttempts: 3 }, NOW)).toBe(
      "That PIN didn't work. 3 tries left.",
    );
  });

  it('warns on the last try, in the singular', () => {
    const msg = pinErrorMessage(401, { remainingAttempts: 1 }, NOW);
    expect(msg).toContain('1 try left');
    expect(msg).toContain('locks');
  });

  it('treats zero remaining as a lockout rather than reporting "0 tries left"', () => {
    expect(pinErrorMessage(401, { remainingAttempts: 0 }, NOW)).toContain('Too many tries');
  });
});

describe('pinErrorMessage — member has no PIN', () => {
  it('names who can fix it and where, instead of "contact a parent"', () => {
    const msg = pinErrorMessage(403, { pinRequired: true, error: 'PIN not set.' }, NOW);
    expect(msg).toContain('Settings');
    expect(msg).toContain('Family Members');
  });
});

describe('pinErrorMessage — nothing useful came back', () => {
  it('does not accuse the user when the request never landed', () => {
    // A hub that is down is not a wrong PIN, and saying so sends someone
    // hunting for a credential problem that does not exist.
    const msg = pinErrorMessage(0, null, NOW);
    expect(msg).toContain("Can't reach Prism");
  });

  it('falls back to the server wording rather than inventing its own', () => {
    expect(pinErrorMessage(401, { error: 'Account disabled' }, NOW)).toBe('Account disabled');
  });

  it('has a plain default when the server says nothing at all', () => {
    expect(pinErrorMessage(401, {}, NOW)).toBe("That PIN didn't work.");
  });
});
