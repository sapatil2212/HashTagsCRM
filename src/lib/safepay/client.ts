/**
 * Safepay HTTP client.
 *
 * Hand-rolled rather than pulling in `@sfpy/node-sdk`, for three reasons: the
 * SDK is axios-based (a dependency this project does not otherwise carry), its
 * `verify.webhook` reads an Express `req` object that does not exist under the
 * App Router, and it validates all four credentials up front — including a
 * webhook secret — so it cannot be constructed by a merchant who only has the
 * two keys the dashboard hands out. The wire format below is taken from that
 * SDK's source, so behaviour matches it exactly.
 *
 * ## The flow this implements
 *
 *   1. `createTracker` opens a payment session and returns a tracker token
 *      (Safepay also calls it a "beacon"). This is the only server-to-server
 *      call in the happy path.
 *   2. `buildCheckoutUrl` turns that token into a hosted checkout URL. Pure
 *      string work — no network, so it cannot fail.
 *   3. The customer pays on Safepay's domain and is redirected back.
 *
 * Notably absent: any "fetch payment status" call. Safepay's v1 API exposes no
 * documented endpoint for reading a tracker's state back, so settlement is
 * driven entirely by the two signed callbacks (webhook and redirect) rather
 * than by polling. That is the same trust model the official WooCommerce and
 * ASP.NET integrations use. The practical consequence is that an abandoned
 * checkout cannot be distinguished from a failed one, which is why unsettled
 * orders are aged out by the billing cron rather than reconciled against the
 * provider.
 */

import { toMajorUnits } from '@/lib/billing/plans';

import type { SafepayConfig } from './config';

/** An upstream Safepay failure. Translated to a 502 by the billing service. */
export class SafepayApiError extends Error {
  readonly status: number | null;
  /** Provider-reported messages, safe to log. */
  readonly providerErrors: readonly string[];

  constructor(message: string, options?: { status?: number | null; providerErrors?: readonly string[]; cause?: unknown }) {
    super(message);
    this.name = 'SafepayApiError';
    this.status = options?.status ?? null;
    this.providerErrors = options?.providerErrors ?? [];
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Upstream request budget. Safepay's tracker call is normally sub-second. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Shape of `POST /order/v1/init`. Only `data.token` is load-bearing; the rest
 * is echoed back for observability (`conversion_rate` is how you can see what
 * a USD-quoted charge will settle as in PKR).
 */
interface TrackerResponseBody {
  data?: {
    token?: unknown;
    state?: unknown;
    amount?: unknown;
    currency?: unknown;
    default_currency?: unknown;
    conversion_rate?: unknown;
  };
  status?: {
    errors?: unknown;
    message?: unknown;
  };
}

export interface CreateTrackerInput {
  config: SafepayConfig;
  /** Charge in minor units. Converted to the major-unit decimal Safepay wants. */
  amountMinor: number;
  /** ISO-4217 code. Safepay accepts PKR, USD, AED, SAR, CAD, EUR and GBP. */
  currency: string;
}

export interface CreateTrackerResult {
  /** The `track_…` token, passed to checkout as `beacon`. */
  tracker: string;
  /** Provider-side session state at creation, e.g. `TRACKER_STARTED`. */
  state: string | null;
  /** Settlement currency when Safepay converts, e.g. `PKR` for a USD charge. */
  settlementCurrency: string | null;
  /** Rate applied for that conversion, when reported. */
  conversionRate: number | null;
}

/**
 * Opens a payment session.
 *
 * The merchant is identified by `client` **in the request body** — Safepay's v1
 * order API takes no `Authorization` header, which reads like an oversight but
 * is the documented contract.
 */
export async function createTracker(input: CreateTrackerInput): Promise<CreateTrackerResult> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    // Guarding here rather than trusting the caller: a zero or negative charge
    // that reached the gateway could open a session that settles for nothing
    // and still activates a subscription downstream.
    throw new SafepayApiError(`Refusing to open a payment session for ${input.amountMinor} minor units.`);
  }

  const body = JSON.stringify({
    amount: toMajorUnits(input.amountMinor),
    client: input.config.apiKey,
    currency: input.currency,
    environment: input.config.environment,
  });

  const response = await postJson(`${input.config.apiBaseUrl}/order/v1/init`, body);
  const parsed = response.body as TrackerResponseBody | null;

  const providerErrors = collectProviderErrors(parsed);

  if (!response.ok) {
    throw new SafepayApiError(
      `Safepay rejected the payment session (HTTP ${response.status}).`,
      { status: response.status, providerErrors },
    );
  }

  const tracker = parsed?.data?.token;
  if (typeof tracker !== 'string' || tracker.trim().length === 0) {
    // A 200 with no token means the contract changed under us. Failing loudly
    // beats storing an empty tracker and building a checkout URL that silently
    // sends the customer to a blank page.
    throw new SafepayApiError('Safepay accepted the request but returned no tracker token.', {
      status: response.status,
      providerErrors,
    });
  }

  return {
    tracker: tracker.trim(),
    state: typeof parsed?.data?.state === 'string' ? parsed.data.state : null,
    settlementCurrency:
      typeof parsed?.data?.default_currency === 'string' ? parsed.data.default_currency : null,
    conversionRate: toFiniteNumber(parsed?.data?.conversion_rate),
  };
}

export interface BuildCheckoutUrlInput {
  config: SafepayConfig;
  /** Tracker token from `createTracker`. */
  tracker: string;
  /** Our own order reference. Safepay echoes it back on the redirect. */
  orderReference: string;
  /** Absolute URL Safepay POSTs to after a completed payment. */
  redirectUrl: string;
  /** Absolute URL Safepay sends the customer to if they abandon checkout. */
  cancelUrl: string;
  /**
   * Ask Safepay to also deliver a server-to-server webhook. Left on: the
   * redirect alone depends on the customer's browser surviving the round trip,
   * and a closed tab must not cost someone a subscription they paid for.
   */
  webhooks?: boolean;
}

/**
 * Builds the hosted checkout URL.
 *
 * Every value goes through `URLSearchParams`, so the callback URLs are
 * percent-encoded properly. Hand-concatenating these is the classic way to
 * lose everything after the first `&` of a redirect URL.
 */
export function buildCheckoutUrl(input: BuildCheckoutUrlInput): string {
  const params = new URLSearchParams({
    beacon: input.tracker,
    cancel_url: input.cancelUrl,
    env: input.config.environment,
    order_id: input.orderReference,
    redirect_url: input.redirectUrl,
    source: input.config.source,
    webhooks: String(input.webhooks ?? true),
  });

  return `${input.config.checkoutBaseUrl}/pay?${params.toString()}`;
}

// ── transport ───────────────────────────────────────────────────────

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * One POST, with a timeout and a single retry.
 *
 * The retry covers connection failures and 5xx only — never a 4xx, which would
 * fail identically. Opening a payment session is not idempotent, so a retry can
 * leave an unused tracker behind on the provider; that is deliberately
 * accepted, because an unpaid session has no cost or side effect, whereas
 * failing a customer's first checkout attempt does.
 */
async function postJson(url: string, body: string): Promise<JsonResponse> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await delay(400);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Payment sessions are per-request state; a cached response would be
        // catastrophic (two customers sharing one tracker).
        cache: 'no-store',
      });
    } catch (error) {
      lastError = error;
      continue;
    }

    const text = await response.text().catch(() => '');
    const parsed = safeParseJson(text);

    if (!response.ok && response.status >= 500 && attempt === 0) {
      lastError = new SafepayApiError(`Safepay returned HTTP ${response.status}.`, {
        status: response.status,
      });
      continue;
    }

    return { ok: response.ok, status: response.status, body: parsed };
  }

  throw new SafepayApiError('Could not reach Safepay.', { cause: lastError });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeParseJson(text: string): unknown {
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Safepay reports failures in `status.errors` (an array) and `status.message`.
 * Both are provider-authored strings about the request we sent, so they are
 * safe to log — but they are never forwarded to the browser, because we do not
 * control their contents.
 */
function collectProviderErrors(parsed: TrackerResponseBody | null): string[] {
  const out: string[] = [];
  const errors = parsed?.status?.errors;
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      if (typeof entry === 'string' && entry.length > 0) out.push(entry);
      else if (entry && typeof entry === 'object') out.push(JSON.stringify(entry));
    }
  }
  const message = parsed?.status?.message;
  if (typeof message === 'string' && message.length > 0 && message !== 'success') {
    out.push(message);
  }
  return out;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
