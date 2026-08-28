/**
 * Normalising Safepay's two callback shapes.
 *
 * The redirect return is a well-documented HTML form POST with four fields. The
 * webhook is not: Safepay has shipped several payload generations, its public
 * guides disagree on the envelope, and merchant accounts differ by provisioning
 * date. So this module reads *defensively* — it hunts for a tracker token, an
 * order reference and a state string across the shapes Safepay is known to use,
 * instead of asserting one schema and breaking on a variant.
 *
 * That tolerance is safe here, and it is worth being explicit about why:
 *
 *   - Authenticity is already settled. Nothing in this file is reached until
 *     the HMAC in `signature.ts` has verified the payload against our secret.
 *   - The extracted values are only ever used to *locate* an order we already
 *     created. The amount, plan, cycle and period all come from our own
 *     database row, never from the callback.
 *
 * So the worst a malformed-but-signed payload can do is fail to match an order,
 * which is logged and ignored.
 */

/** Tracker tokens are `track_<uuid>`; used to recognise one positionally. */
const TRACKER_PREFIX = 'track_';

export interface RedirectCallback {
  /** Our `PaymentOrder.reference`, echoed back as `order_id`. */
  orderReference: string | null;
  /** Safepay tracker token. */
  tracker: string | null;
  /** The `sig` field — HMAC-SHA256 of `tracker`. */
  signature: string | null;
  /** Safepay's own transaction reference code, for reconciliation. */
  referenceCode: string | null;
  /**
   * Provider state, when the redirect carries one.
   *
   * Safepay's documented redirect body is four fields with no state, so this is
   * usually null — but the signature covers the tracker alone and is a fixed
   * value for that tracker's lifetime, so it proves "Safepay processed this
   * tracker", not "Safepay captured this payment". If a state *is* present it is
   * strictly better evidence than that inference, and the caller must respect it.
   */
  state: string | null;
}

/**
 * Reads the redirect POST body.
 *
 * Safepay submits an HTML form, so the content type is
 * `application/x-www-form-urlencoded` — but some integrations report JSON, and
 * a browser-driven POST is cheap to be lenient about. Both are accepted.
 */
export function parseRedirectCallback(source: URLSearchParams | Record<string, unknown>): RedirectCallback {
  const get = (key: string): string | null => {
    const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    orderReference: get('order_id') ?? get('orderId'),
    tracker: get('tracker') ?? get('beacon') ?? get('token'),
    // `sig` is the documented field name; `signature` appears in some samples.
    signature: get('sig') ?? get('signature'),
    referenceCode: get('reference') ?? get('reference_code') ?? get('referenceCode'),
    state: get('state') ?? get('tracker_state') ?? get('status'),
  };
}

export interface WebhookCallback {
  orderReference: string | null;
  tracker: string | null;
  referenceCode: string | null;
  /** Raw provider state/event string, e.g. `TRACKER_ENDED` or `payment.succeeded`. */
  state: string | null;
  /** Provider-side event id, when present — the best idempotency key available. */
  eventId: string | null;
}

/**
 * Extracts the fields we need from a webhook body.
 *
 * Searches the top level, a `data` envelope, and one level of nesting under
 * `data.tracker` / `data.payment` / `data.order`, which covers every payload
 * variant Safepay's SDKs and guides describe.
 */
export function parseWebhookCallback(body: unknown): WebhookCallback {
  const scopes = collectScopes(body);

  return {
    orderReference: findString(scopes, ['order_id', 'orderId', 'client_order_id', 'merchant_order_id']),
    tracker: findTracker(scopes),
    referenceCode: findString(scopes, ['reference', 'reference_code', 'referenceCode', 'payment_reference']),
    // `state` and `tracker_state` first: those name the payment's actual
    // lifecycle position. `type` / `event` are envelope labels and only worth
    // consulting when no real state is present anywhere.
    state: findString(scopes, ['state', 'tracker_state', 'status', 'event_type', 'event', 'type']),
    eventId: findString(scopes, ['event_id', 'eventId', 'webhook_id', 'notification_id', 'id']),
  };
}

/**
 * Provider states that mean "the money moved".
 *
 * Safepay's v1 tracker lifecycle ends at `TRACKER_ENDED`; the v3 payment API
 * and its webhooks use `paid` / `succeeded` / `completed` style verbs. All are
 * matched case-insensitively against a substring, because several are delivered
 * as dotted event names (`payment.succeeded`).
 */
const PAID_STATE_MARKERS = [
  'tracker_ended',
  'succeeded',
  'success',
  'completed',
  'complete',
  'captured',
  'paid',
] as const;

/** Provider states that mean the attempt definitively failed. */
const FAILED_STATE_MARKERS = ['failed', 'declined', 'rejected', 'error', 'expired'] as const;

/** Provider states that mean the customer walked away. */
const CANCELED_STATE_MARKERS = ['cancel', 'abandon', 'void'] as const;

export type CallbackOutcome = 'paid' | 'failed' | 'canceled' | 'unknown';

/**
 * Classifies a provider state string.
 *
 * Order matters: failure and cancellation are checked before success, so a
 * value like `payment_failed` cannot match on a stray `paid` substring. Unknown
 * states resolve to `unknown` and leave the order untouched — a state we do not
 * understand must never be read as payment.
 */
export function classifyState(state: string | null | undefined): CallbackOutcome {
  if (!state) return 'unknown';
  const value = state.trim().toLowerCase();
  if (value.length === 0) return 'unknown';

  if (FAILED_STATE_MARKERS.some((marker) => value.includes(marker))) return 'failed';
  if (CANCELED_STATE_MARKERS.some((marker) => value.includes(marker))) return 'canceled';
  if (PAID_STATE_MARKERS.some((marker) => value.includes(marker))) return 'paid';
  return 'unknown';
}

// ── traversal helpers ───────────────────────────────────────────────

type Scope = Record<string, unknown>;

function asScope(value: unknown): Scope | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Scope) : null;
}

/**
 * Flattens the body into the handful of objects worth searching, outermost
 * first so a top-level field wins over a nested one.
 */
function collectScopes(body: unknown): Scope[] {
  const root = asScope(body);
  if (!root) return [];

  const scopes: Scope[] = [root];
  const data = asScope(root.data);
  if (data) {
    scopes.push(data);
    for (const key of ['tracker', 'payment', 'order', 'transaction', 'object']) {
      const nested = asScope(data[key]);
      if (nested) scopes.push(nested);
    }
  }
  return scopes;
}

/**
 * Finds the first non-empty string for any of `keys`, searching **key-major**:
 * every scope is tried for `keys[0]` before anything is tried for `keys[1]`.
 *
 * The iteration order is the whole point. Scope-major search would return an
 * outer envelope's generic `type` (`"tracker.updated"`) in preference to the
 * actual `data.tracker.state` (`"TRACKER_ENDED"`) nested one level deeper — and
 * since `classifyState` refuses to guess at a vocabulary it does not recognise,
 * that would classify a real capture as `unknown` and silently leave a charged
 * card with no subscription. Key priority is meaningful; nesting depth is not.
 */
function findString(scopes: Scope[], keys: readonly string[]): string | null {
  for (const key of keys) {
    for (const scope of scopes) {
      const value = scope[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
  }
  return null;
}

/**
 * Finds the tracker token.
 *
 * `tracker` is sometimes the token string and sometimes an object containing
 * one, and `token` is reused for unrelated ids elsewhere in Safepay's API — so
 * a candidate is only accepted from the generic keys if it carries the
 * `track_` prefix. An explicitly-named `tracker` string is trusted as-is,
 * since a future prefix change must not break settlement.
 */
function findTracker(scopes: Scope[]): string | null {
  for (const scope of scopes) {
    const direct = scope.tracker;
    if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();
  }

  for (const scope of scopes) {
    for (const key of ['token', 'beacon', 'tracker_token', 'trackerToken']) {
      const value = scope[key];
      if (typeof value === 'string' && value.trim().startsWith(TRACKER_PREFIX)) {
        return value.trim();
      }
    }
  }

  return null;
}
