/**
 * Safepay signature verification.
 *
 * Two different signatures, two different algorithms, two different payloads.
 * Getting either wrong means either rejecting real payments or — far worse —
 * accepting forged ones, so both are implemented from the official
 * `@sfpy/node-sdk` source rather than from prose documentation.
 *
 *   Redirect (`sig` form field)   HMAC-**SHA256** over the *tracker token*,
 *                                 keyed by the secret key. Note it signs only
 *                                 the tracker, not the whole payload: it
 *                                 proves "Safepay processed this tracker", and
 *                                 the amount must still be checked against our
 *                                 own order record.
 *
 *   Webhook (`X-SFPY-SIGNATURE`)  HMAC-**SHA512** over the request body, keyed
 *                                 by the webhook secret.
 *
 * Both fail closed when the secret is absent, matching
 * `verifyMetaWebhookSignature`. A gateway that authenticates nothing because
 * an environment variable is unset is the single worst failure mode available
 * here: anyone who guesses the callback URL could grant themselves a paid
 * subscription.
 */

import crypto from 'node:crypto';

/**
 * Constant-time string comparison.
 *
 * The length check is not paranoia: `timingSafeEqual` throws on mismatched
 * buffer lengths, so an attacker sending a short signature would otherwise
 * turn a rejection into a 500.
 */
function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function hmacHex(algorithm: 'sha256' | 'sha512', secret: string, payload: string): string {
  return crypto.createHmac(algorithm, secret).update(payload, 'utf8').digest('hex');
}

/** Signatures arrive lowercase hex, but normalise rather than assume. */
function normalizeSignature(value: string): string {
  return value.trim().toLowerCase();
}

export interface RedirectSignatureInput {
  /** The `tracker` field from Safepay's redirect POST. */
  tracker: string;
  /** The `sig` field from Safepay's redirect POST. */
  signature: string | null | undefined;
  /** Safepay secret key. */
  secret: string;
}

/**
 * Verifies the signature on the browser redirect back from checkout.
 *
 * The customer's browser performs this POST, so every field in it is attacker
 * controlled. Only the HMAC makes it trustworthy, and only for the claim
 * "Safepay saw this tracker" — the caller must still confirm the tracker
 * belongs to one of its own orders and that the order's amount is what it
 * expected.
 */
export function verifyRedirectSignature(input: RedirectSignatureInput): boolean {
  if (!input.secret) return false;
  if (!input.signature) return false;
  if (!input.tracker) return false;

  return safeEqual(normalizeSignature(input.signature), hmacHex('sha256', input.secret, input.tracker));
}

export interface WebhookSignatureInput {
  /**
   * The raw request body, exactly as received. Must not be a re-serialisation
   * of parsed JSON — key order and whitespace both change the HMAC.
   */
  rawBody: string;
  /** The `X-SFPY-SIGNATURE` header. */
  signature: string | null | undefined;
  /** Safepay webhook secret. */
  secret: string;
}

export interface WebhookSignatureResult {
  valid: boolean;
  /**
   * Which payload convention matched. Useful in logs when a merchant account
   * is migrated between Safepay API generations.
   */
  matched: 'raw-body' | 'data-envelope' | null;
}

/**
 * Verifies a Safepay webhook signature.
 *
 * Safepay has shipped two conventions for what the HMAC covers, and which one
 * a merchant account uses depends on when it was provisioned:
 *
 *   `raw-body`       the entire request body. Documented in Safepay's current
 *                    integration guides.
 *   `data-envelope`  `JSON.stringify(body.data)` — the inner object only. This
 *                    is what the official Node SDK's `verify.webhook` computes.
 *
 * Both candidates are checked. This is not a weakening: each is derived from
 * the body we just received and keyed by the same secret, so an attacker who
 * cannot produce one cannot produce the other. Accepting only one convention
 * would instead mean silently dropping every real payment notification on
 * accounts using the other, which is indistinguishable from an outage.
 *
 * Comparison order is fixed and every candidate is evaluated with a
 * constant-time compare.
 */
export function verifyWebhookSignature(input: WebhookSignatureInput): WebhookSignatureResult {
  const miss: WebhookSignatureResult = { valid: false, matched: null };

  if (!input.secret) return miss;
  if (!input.signature) return miss;

  const provided = normalizeSignature(input.signature);

  if (safeEqual(provided, hmacHex('sha512', input.secret, input.rawBody))) {
    return { valid: true, matched: 'raw-body' };
  }

  const envelope = extractDataEnvelope(input.rawBody);
  if (envelope !== null && safeEqual(provided, hmacHex('sha512', input.secret, envelope))) {
    return { valid: true, matched: 'data-envelope' };
  }

  return miss;
}

/**
 * Re-serialises `body.data` the way the Node SDK does.
 *
 * `JSON.stringify` on a parsed object preserves insertion order, which for
 * `JSON.parse` output is the order the keys appeared on the wire — so this
 * reproduces the SDK's input byte-for-byte for any payload Safepay actually
 * sends. Returns `null` when the body is not JSON or carries no `data` object,
 * in which case only the raw-body convention can apply.
 */
function extractDataEnvelope(rawBody: string): string | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object') return null;
    const data = (parsed as { data?: unknown }).data;
    if (data === undefined) return null;
    return JSON.stringify(data);
  } catch {
    return null;
  }
}
