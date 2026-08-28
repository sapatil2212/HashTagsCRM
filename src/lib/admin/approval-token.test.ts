import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApprovalToken, verifyApprovalToken } from './approval-token';

const USER = 'user-abc';

// `vi.stubEnv` rather than assigning `process.env.NODE_ENV` directly: the latter
// is typed readonly, and stubbing also restores cleanly if a test throws.
beforeEach(() => {
  vi.stubEnv('SUPER_ADMIN_SECRET', 'test-super-admin-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('approval tokens', () => {
  it('accepts a freshly issued token for the user it names', () => {
    expect(verifyApprovalToken(USER, createApprovalToken(USER))).toBe('valid');
  });

  it('rejects a token issued for a different user', () => {
    // This is the hole the token closes: the endpoint used to activate whatever
    // `?userId=` said, with no authentication at all. A MAC over one user id must
    // not authorise another.
    expect(verifyApprovalToken('someone-else', createApprovalToken(USER))).toBe('invalid');
  });

  it('rejects a token signed with a different secret', () => {
    const token = createApprovalToken(USER);
    vi.stubEnv('SUPER_ADMIN_SECRET', 'a-different-secret');
    expect(verifyApprovalToken(USER, token)).toBe('invalid');
  });

  it('rejects an extended expiry', () => {
    // The expiry is inside the MAC, so pushing it out invalidates the signature.
    const token = createApprovalToken(USER);
    const [, mac] = token.split('.');
    const farFuture = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
    expect(verifyApprovalToken(USER, `${farFuture}.${mac}`)).toBe('invalid');
  });

  it('reports an expired token distinctly from a forged one', () => {
    // Different operator remedies: "approve from the dashboard" vs "this link is
    // not valid". Telling them apart leaks nothing — the expiry is already in the
    // token the holder has, and they still cannot forge the MAC.
    const issuedLongAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect(verifyApprovalToken(USER, createApprovalToken(USER, issuedLongAgo))).toBe('expired');
  });

  it('accepts a token issued just inside the window', () => {
    const almostExpired = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000);
    expect(verifyApprovalToken(USER, createApprovalToken(USER, almostExpired))).toBe('valid');
  });

  it('rejects absent and malformed tokens without throwing', () => {
    for (const token of [null, undefined, '', 'no-separator', '.abc', 'notanumber.abc']) {
      expect(verifyApprovalToken(USER, token)).toBe('invalid');
    }
  });

  it('does not throw on a MAC of the wrong length', () => {
    // timingSafeEqual throws on mismatched lengths, which would turn a rejection
    // into a 500 on a route that renders HTML.
    expect(() => verifyApprovalToken(USER, `${Date.now() + 1000}.ab`)).not.toThrow();
    expect(verifyApprovalToken(USER, `${Date.now() + 1000}.ab`)).toBe('invalid');
  });

  it('reports unavailable rather than invalid when the secret is missing in production', () => {
    // An operator seeing "not authorised" would hunt for a tampered link; they
    // need to be told the server cannot verify anything.
    const token = createApprovalToken(USER);
    vi.stubEnv('SUPER_ADMIN_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(verifyApprovalToken(USER, token)).toBe('unavailable');
  });

  it('does not fall back to a guessable key in production', () => {
    vi.stubEnv('SUPER_ADMIN_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => createApprovalToken(USER)).toThrow(/SUPER_ADMIN_SECRET/);
  });
});
