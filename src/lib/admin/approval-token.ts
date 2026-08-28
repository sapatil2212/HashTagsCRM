/**
 * Signed, expiring tokens for the one-click account approval link.
 *
 * ## The problem this fixes
 *
 * `GET /api/super-admin/approve?userId=…` had **no authentication of any kind**.
 * It is a convenience link emailed to the operator, and it did exactly what the
 * name says: flipped `isVerified`, granted a month of subscription, and
 * activated the tenant. Anyone who guessed or obtained a user id could grant
 * themselves the product. That was already a privilege-escalation bug; with a
 * payment gateway attached it is also a way to take the product for free, and
 * fixing it is part of making billing production-ready rather than an unrelated
 * cleanup.
 *
 * The link now carries a MAC over the user id and an expiry, so possessing a
 * user id is no longer sufficient — you need the server's secret.
 *
 * ## Design notes
 *
 * - **Derived key.** HMAC of `SUPER_ADMIN_SECRET` under a fixed label, so an
 *   approval token can never be replayed as an operator session token (or the
 *   reverse) even though both trace back to one secret.
 * - **Expiry in the payload, covered by the MAC.** A stale link in an old
 *   mailbox stops working; an attacker cannot extend one without the key.
 * - **Fails closed in production.** No secret, no approvals — the alternative
 *   (falling back to a known default) would leave the original hole open.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long an emailed approval link stays usable. */
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const KEY_INFO = 'hashtags-crm/super-admin-approval/v1';

/** Raised when the server cannot sign or verify approval links at all. */
export class ApprovalTokenUnavailableError extends Error {
  constructor() {
    super('SUPER_ADMIN_SECRET is not configured; approval links cannot be issued or verified.');
    this.name = 'ApprovalTokenUnavailableError';
  }
}

function approvalKey(): string {
  const base = process.env.SUPER_ADMIN_SECRET;
  if (!base) {
    if (process.env.NODE_ENV === 'production') throw new ApprovalTokenUnavailableError();
    // Development only, and intentionally not the same string `lib/auth.ts`
    // uses, so a dev token is never mistaken for a session token.
    return createHmac('sha256', 'dev_super_admin_secret_change_me').update(KEY_INFO).digest('hex');
  }
  return createHmac('sha256', base).update(KEY_INFO).digest('hex');
}

function sign(userId: string, expiresAt: number): string {
  return createHmac('sha256', approvalKey()).update(`${userId}.${expiresAt}`).digest('hex');
}

/**
 * Builds the token for an approval link. Format is `<expiryMs>.<hexMac>`; the
 * user id travels separately in the query string and is covered by the MAC.
 */
export function createApprovalToken(userId: string, now: Date = new Date()): string {
  const expiresAt = now.getTime() + TOKEN_TTL_MS;
  return `${expiresAt}.${sign(userId, expiresAt)}`;
}

export type ApprovalTokenResult = 'valid' | 'invalid' | 'expired' | 'unavailable';

/**
 * Verifies an approval token against a user id.
 *
 * Distinguishes `expired` from `invalid` so the operator sees "this link has
 * expired, approve from the dashboard" rather than a generic rejection. That
 * leaks nothing an attacker does not already know: expiry is in the token they
 * hold, and they still cannot forge the MAC.
 */
export function verifyApprovalToken(
  userId: string,
  token: string | null | undefined,
  now: Date = new Date(),
): ApprovalTokenResult {
  if (!token) return 'invalid';

  // Probe the key first so a missing secret reports `unavailable` rather than
  // surfacing as a signature mismatch, which would send an operator hunting for
  // a tampered link instead of an unset environment variable.
  try {
    approvalKey();
  } catch {
    return 'unavailable';
  }

  const separator = token.indexOf('.');
  if (separator <= 0) return 'invalid';

  const expiresAt = Number(token.slice(0, separator));
  const provided = token.slice(separator + 1);
  if (!Number.isFinite(expiresAt)) return 'invalid';

  // Signature before expiry: an unforgeable token that happens to be expired is
  // a different situation from a forged one, and checking the MAC first is what
  // lets us tell them apart truthfully.
  const expected = sign(userId, expiresAt);
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return 'invalid';
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return 'invalid';

  return expiresAt < now.getTime() ? 'expired' : 'valid';
}
