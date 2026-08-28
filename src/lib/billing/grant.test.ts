import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

import {
  CHECKOUT_GRANT_TTL_SECONDS,
  checkoutGrantCookieOptions,
  issueCheckoutGrant,
  verifyCheckoutGrant,
} from './grant';

const GRANT = { userId: 'user-1', tenantId: 'tenant-1', email: 'owner@example.com' };

// `vi.stubEnv` rather than assigning `process.env.NODE_ENV` directly: the latter
// is typed readonly, and stubbing also restores cleanly if a test throws.
beforeEach(() => {
  vi.stubEnv('JWT_SECRET', 'test-jwt-access-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('issueCheckoutGrant / verifyCheckoutGrant', () => {
  it('round-trips the identity it was issued for', () => {
    expect(verifyCheckoutGrant(issueCheckoutGrant(GRANT))).toEqual(GRANT);
  });

  it('rejects a grant signed with a different JWT_SECRET', () => {
    const token = issueCheckoutGrant(GRANT);
    vi.stubEnv('JWT_SECRET', 'a-different-secret');
    expect(verifyCheckoutGrant(token)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    // The realistic attack: swap in someone else's tenant to open a checkout —
    // or, worse, to read their subscription.
    const token = issueCheckoutGrant(GRANT);
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...GRANT, tenantId: 'victim-tenant', purpose: 'billing_checkout' }),
    ).toString('base64url');
    expect(verifyCheckoutGrant(`${header}.${forgedPayload}.${signature}`)).toBeNull();
  });

  it('cannot be forged with JWT_SECRET itself', () => {
    // The whole point of deriving the signing key: an attacker (or a bug) holding
    // JWT_SECRET must not be able to mint a grant, and conversely a grant must
    // not verify as an access token.
    const forged = jwt.sign(
      { ...GRANT, purpose: 'billing_checkout' },
      process.env.JWT_SECRET as string,
      { expiresIn: 600 },
    );
    expect(verifyCheckoutGrant(forged)).toBeNull();
  });

  it('is not accepted as an access token', () => {
    // A grant carries no `role` claim, so if it verified under the access-token
    // key it would authenticate a principal with an undefined role.
    const token = issueCheckoutGrant(GRANT);
    expect(() => jwt.verify(token, process.env.JWT_SECRET as string)).toThrow();
  });

  it('rejects a token with a different purpose', () => {
    // Defence in depth behind the key separation: even a correctly signed token
    // has to say what it is for, so a future token type sharing the derived key
    // cannot be spent as a checkout grant.
    expect(verifyCheckoutGrant(jwt.sign({ ...GRANT, purpose: 'password_reset' }, 'whatever'))).toBeNull();
  });

  it('rejects a grant missing the identity it is supposed to carry', () => {
    expect(verifyCheckoutGrant(jwt.sign({ purpose: 'billing_checkout' }, 'whatever'))).toBeNull();
  });

  it('rejects an expired grant', () => {
    const token = issueCheckoutGrant(GRANT);
    expect(verifyCheckoutGrant(token)).not.toBeNull();

    // Fast-forward past the TTL rather than sleeping.
    const realNow = Date.now;
    Date.now = () => realNow() + (CHECKOUT_GRANT_TTL_SECONDS + 60) * 1000;
    try {
      expect(verifyCheckoutGrant(token)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('rejects absent and malformed input without throwing', () => {
    expect(verifyCheckoutGrant(null)).toBeNull();
    expect(verifyCheckoutGrant(undefined)).toBeNull();
    expect(verifyCheckoutGrant('')).toBeNull();
    expect(verifyCheckoutGrant('not-a-jwt')).toBeNull();
    expect(verifyCheckoutGrant('a.b.c')).toBeNull();
  });

  it('refuses to sign in production without JWT_SECRET', () => {
    // Falling back to a known development key in production would make every
    // grant forgeable by anyone who read the source.
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => issueCheckoutGrant(GRANT)).toThrow(/JWT_SECRET/);
  });

  it('still works in development without JWT_SECRET', () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(verifyCheckoutGrant(issueCheckoutGrant(GRANT))).toEqual(GRANT);
  });
});

describe('checkoutGrantCookieOptions', () => {
  it('is httpOnly, lax, root-scoped, and expires with the grant', () => {
    const options = checkoutGrantCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(CHECKOUT_GRANT_TTL_SECONDS);
  });

  it('is only marked secure in production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(checkoutGrantCookieOptions().secure).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    expect(checkoutGrantCookieOptions().secure).toBe(true);
  });
});
