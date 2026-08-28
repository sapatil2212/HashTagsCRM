/**
 * The checkout grant — a narrow, signed capability that lets a signed-up but
 * unpaid account reach checkout.
 *
 * ## Why this exists
 *
 * Payment has to happen *before* the account is usable, but this codebase
 * refuses a session to exactly those accounts:
 *
 *   - `POST /api/auth/login` rejects any user with `isVerified === false`.
 *   - `rotateRefreshToken` does the same, and additionally deletes every
 *     refresh token the user holds.
 *
 * So a new signup, or a subscriber whose period has lapsed, cannot hold a
 * session — and a session is what `auth: 'tenant'` requires. That leaves three
 * options, and only one of them is safe:
 *
 *   1. Relax the login gate. Rejected: it would hand pre-payment accounts a
 *      real session with access to the whole dashboard.
 *   2. An endpoint that takes `userId` from the request body. Rejected — that is
 *      what the old `POST /api/auth/payment-proof` did, and it was forgeable by
 *      anyone who could guess a uuid. It has been deleted along with the manual
 *      QR-and-screenshot flow it served.
 *   3. A short-lived signed token that names the user and tenant, and
 *      authorises *only* billing operations. This file.
 *
 * ## Security properties
 *
 * - **Domain-separated key.** Signed with a key derived from `JWT_SECRET` via
 *   HMAC, not `JWT_SECRET` itself. This matters: a grant signed with the access
 *   token key would verify as an access token, and since a grant carries no
 *   `role` claim it would authenticate as a principal with an undefined role.
 *   Deriving the key means a grant presented in the `accessToken` cookie fails
 *   signature verification outright. It also needs no new environment variable,
 *   so there is no way to deploy this half-configured.
 * - **Purpose claim**, checked on verify, as defence in depth behind the key
 *   separation.
 *   `httpOnly`, so page scripts cannot read it.
 * - **Short lived** (45 minutes — long enough to complete a bank's 3-D Secure
 *   step, short enough that a leaked grant is near-worthless).
 * - **Narrow authority.** A grant can price a plan, open a checkout session and
 *   read its own subscription state. It cannot read contacts, send messages, or
 *   change a password.
 */

import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';

/** Cookie holding the grant. */
export const CHECKOUT_GRANT_COOKIE = 'billingGrant';

/** Grant lifetime. Mirrored in the cookie's `maxAge`. */
export const CHECKOUT_GRANT_TTL_SECONDS = 45 * 60;

const GRANT_PURPOSE = 'billing_checkout';

/**
 * Key-separation label. Bump the version suffix to invalidate every
 * outstanding grant without touching `JWT_SECRET`.
 */
const GRANT_KEY_INFO = 'hashtags-crm/billing-checkout-grant/v1';

export interface CheckoutGrant {
  userId: string;
  tenantId: string;
  email: string;
}

interface GrantClaims extends CheckoutGrant {
  purpose: typeof GRANT_PURPOSE;
}

/**
 * Derives the signing key from `JWT_SECRET`.
 *
 * The dev fallback matches `getSecret`'s behaviour in `src/lib/auth.ts` — a
 * fixed value locally, and a hard failure in production rather than a silently
 * guessable key. Resolved per call because `NODE_ENV` and the secret are both
 * runtime values.
 */
function grantKey(): string {
  const base = process.env.JWT_SECRET;
  if (!base) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[Security] JWT_SECRET is missing in production; cannot sign checkout grants.');
    }
    return createHmac('sha256', 'dev_jwt_access_secret_key_change_me').update(GRANT_KEY_INFO).digest('hex');
  }
  return createHmac('sha256', base).update(GRANT_KEY_INFO).digest('hex');
}

export function issueCheckoutGrant(grant: CheckoutGrant): string {
  const claims: GrantClaims = { ...grant, purpose: GRANT_PURPOSE };
  return jwt.sign(claims, grantKey(), { expiresIn: CHECKOUT_GRANT_TTL_SECONDS });
}

/**
 * Verifies a grant. Returns `null` for anything not a currently-valid grant —
 * bad signature, expired, or missing/incorrect purpose.
 */
export function verifyCheckoutGrant(token: string | null | undefined): CheckoutGrant | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, grantKey());
    if (!decoded || typeof decoded !== 'object') return null;

    const claims = decoded as Partial<GrantClaims>;
    if (claims.purpose !== GRANT_PURPOSE) return null;
    if (!claims.userId || !claims.tenantId || !claims.email) return null;

    return { userId: claims.userId, tenantId: claims.tenantId, email: claims.email };
  } catch {
    return null;
  }
}

/** Cookie attributes, shared by the set and clear paths so they cannot drift. */
export function checkoutGrantCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // `lax` matches the auth cookies. The grant is deliberately not needed by
    // the gateway callback — Safepay's return POST is cross-site, so no cookie
    // would be sent anyway; that request identifies the order by its signed
    // reference instead.
    sameSite: 'lax',
    path: '/',
    maxAge: CHECKOUT_GRANT_TTL_SECONDS,
  };
}
