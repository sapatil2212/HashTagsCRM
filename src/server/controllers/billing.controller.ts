/**
 * Billing endpoints.
 *
 * Six handlers, three distinct authentication stories, and it is worth being
 * explicit about which is which because getting one wrong here has a direct
 * financial consequence.
 *
 * | Handler | Auth | Why |
 * | --- | --- | --- |
 * | `plans` | `public` | The price list is public. It is the pricing page's data source. |
 * | `subscription`, `quote`, `checkout` | `session`, falling back to a signed checkout grant | Must be reachable by an account that has signed up but not yet paid — which by design cannot hold a session. See `@/lib/billing/grant`. |
 * | `orders`, `cancel` | `tenant` | Dashboard-only. A grant deliberately cannot read payment history or change renewal. |
 * | `callback`, `webhook` | `public` + HMAC | No session exists; authenticity comes from the signature, verified before anything is read. |
 * | `cron` | `cron` | `x-cron-secret`, and it spans tenants. |
 *
 * ## Tenant derivation on the gateway callbacks
 *
 * A callback from Safepay carries no session, so the tenant has to be *derived*
 * from the order reference or tracker it names. That is the same shape as the
 * WhatsApp webhook resolving a tenant from `phone_number_id`, and the same
 * justification applies: one `systemDb` lookup establishes the tenant, and
 * everything after it runs on the guarded client.
 *
 * The lookup is by `reference` or `tracker`, both of which are UNIQUE and
 * unguessable, and it grants nothing on its own — the signature still has to
 * verify, and the tracker still has to match the order it was found by.
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  BILLING_CURRENCY,
  PLAN_LIST,
  isBillingCycle,
  isPlanId,
  type BillingCycle,
  type PlanId,
} from '@/lib/billing/plans';
import { CHECKOUT_GRANT_COOKIE, verifyCheckoutGrant } from '@/lib/billing/grant';
import { classifyState, parseRedirectCallback, parseWebhookCallback } from '@/lib/safepay/callback';
import {
  SafepayConfigError,
  resolveSafepayConfig,
  resolveSiteOrigin,
  type SafepayConfig,
} from '@/lib/safepay/config';
import { verifyRedirectSignature, verifyWebhookSignature } from '@/lib/safepay/signature';

import {
  UnauthenticatedError,
  createHandler,
  createRawHandler,
  getLogger,
  redact,
  result,
  systemDb,
  tenantDb,
  type AuthContext,
  type TenantDb,
} from '../kernel';
import { listOf } from '../dtos/common.dto';
import {
  billingDiagnosticsDtoSchema,
  billingSweepDtoSchema,
  checkoutSessionDtoSchema,
  paymentOrderDtoSchema,
  quoteDtoSchema,
  subscriptionDtoSchema,
  type BillingDiagnosticsDto,
} from '../dtos/billing.dto';
import { BillingService } from '../services/billing.service';
import { BillingSweepService } from '../services/billing-sweep.service';
import {
  cancelSubscriptionBodySchema,
  createCheckoutBodySchema,
  listOrdersQuerySchema,
  quoteQuerySchema,
} from '../validators/billing.validator';
import { paged } from './controller-kit';

const log = getLogger('billing.http');

// ── actor resolution ────────────────────────────────────────────────

interface BillingActor {
  /** Null is possible in principle; in practice both paths supply one. */
  userId: string | null;
  tenantId: string;
  db: TenantDb;
  /** How the caller was authenticated, for the logs. */
  via: 'session' | 'grant';
}

/**
 * Resolves the caller from a session if there is one, otherwise from a checkout
 * grant.
 *
 * Session first, deliberately: a logged-in user renewing from the dashboard
 * should be treated as themselves even if a stale grant cookie is still lying
 * around from signup.
 */
function resolveActor(input: {
  ctx: AuthContext | null;
  db: TenantDb | null;
  request: NextRequest;
}): BillingActor {
  if (input.ctx && input.db) {
    return { userId: input.ctx.userId, tenantId: input.ctx.tenantId, db: input.db, via: 'session' };
  }

  const grant = verifyCheckoutGrant(input.request.cookies.get(CHECKOUT_GRANT_COOKIE)?.value);
  if (grant) {
    return {
      userId: grant.userId,
      tenantId: grant.tenantId,
      db: tenantDb(grant.tenantId),
      via: 'grant',
    };
  }

  throw new UnauthenticatedError('Sign in, or restart signup, to manage billing.');
}

function serviceFor(actor: BillingActor): BillingService {
  return BillingService.create(actor.db, actor.tenantId);
}

// ── gateway callback plumbing ───────────────────────────────────────

interface ResolvedOrder {
  tenantId: string;
  reference: string;
  tracker: string | null;
  status: string;
  orderId: string;
}

/**
 * Finds the order a callback refers to.
 *
 * Justified `systemDb` use: a gateway callback carries no tenant, and this is
 * the query that establishes one. Both lookup columns are UNIQUE, so there is
 * no ambiguity and no ordering to get wrong.
 *
 * Tracker is tried first because it is issued by Safepay and therefore cannot be
 * confused with a value the browser supplied.
 */
async function resolveOrder(input: {
  tracker: string | null;
  reference: string | null;
}): Promise<ResolvedOrder | null> {
  const select = { id: true, tenantId: true, reference: true, tracker: true, status: true } as const;

  const row = input.tracker
    ? await systemDb.paymentOrder.findUnique({ where: { tracker: input.tracker }, select })
    : input.reference
      ? await systemDb.paymentOrder.findUnique({ where: { reference: input.reference }, select })
      : null;

  if (!row) return null;
  return {
    tenantId: row.tenantId,
    reference: row.reference,
    tracker: row.tracker,
    status: row.status,
    orderId: row.id,
  };
}

/**
 * Strips credentials from a provider payload before it is persisted.
 *
 * `sig` is removed explicitly: it is the one field that would let a stored
 * payload be replayed as a valid callback, and the kernel's `redact` does not
 * match a three-letter key. `nonce` goes too, as it is only meaningful to the
 * sender. Everything else passes through `redact`, which masks
 * `token`/`secret`/`password`/`apiKey`/`credential` at any depth.
 */
function sanitizeCallbackPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return redact(value);

  const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of ['sig', 'signature', 'nonce']) delete clone[key];
  return redact(clone);
}

/**
 * Gateway config for a callback, tolerating a malformed `SAFEPAY_ENVIRONMENT`.
 *
 * `resolveSafepayConfig` throws on an invalid environment value, and a callback
 * must never turn a completed payment into an unhandled 500 — the money has
 * already moved. Returning null routes it into the same fail-closed
 * "unverified" path as a missing secret, which is logged and visible.
 */
function callbackConfig(): ReturnType<typeof resolveSafepayConfig> {
  try {
    return resolveSafepayConfig();
  } catch (error) {
    if (error instanceof SafepayConfigError) {
      log.error('gateway configuration is invalid; refusing to verify a callback', { err: error });
      return null;
    }
    throw error;
  }
}

/**
 * Dedupe key for a *rejected* callback, bucketed to the minute.
 *
 * Rejections are recorded so repeated forgery attempts are visible, but they
 * must not be keyed per-millisecond: a caller who knows one real order
 * reference could then write an unbounded number of audit rows. One row per
 * order per minute keeps the signal and caps the volume.
 */
function rejectionDedupeKey(prefix: string, reference: string, now: Date = new Date()): string {
  return `${prefix}:${reference}:${now.toISOString().slice(0, 16)}`;
}

/** Where the customer lands after a callback. Always a GET page. */
function resultRedirect(input: { origin: string; reference: string | null; status: string }): NextResponse {
  const params = new URLSearchParams({ status: input.status });
  if (input.reference) params.set('ref', input.reference);
  // 303 so the browser converts Safepay's POST into a GET. A 302 would have it
  // re-POST to the result page, which would then 405.
  return NextResponse.redirect(`${input.origin}/billing/result?${params.toString()}`, 303);
}

/**
 * Reads a callback body that may be form-encoded or JSON.
 *
 * Safepay documents an HTML form POST (`application/x-www-form-urlencoded`), but
 * accepting JSON costs nothing and avoids a total failure if that changes.
 */
async function readCallbackBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  const raw = await request.text();

  if (contentType.includes('application/json')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to form parsing — a mislabelled content type is more
      // likely than a genuinely unparseable body.
    }
  }

  return Object.fromEntries(new URLSearchParams(raw));
}

// ── handlers ────────────────────────────────────────────────────────

export const billingController = {
  /**
   * Current entitlement.
   *
   * Reachable with a checkout grant, so the pre-payment billing page can show
   * what is (not yet) active. There is deliberately no endpoint serving the plan
   * catalogue: prices are code, not data, and `@/lib/billing/plans` is
   * isomorphic — every page imports it directly rather than paying for a round
   * trip to be told its own constants.
   */
  subscription: createHandler({
    operation: 'billing.subscription.get',
    auth: 'session',
    response: subscriptionDtoSchema,
    message: 'Subscription retrieved.',
    handle: async ({ ctx, db, request }) => serviceFor(resolveActor({ ctx, db, request })).getSubscription(),
  }),

  /** What a given plan would cost this tenant, setup fee included or not. */
  quote: createHandler({
    operation: 'billing.quote',
    auth: 'session',
    query: quoteQuerySchema,
    response: quoteDtoSchema,
    message: 'Quote calculated.',
    handle: async ({ ctx, db, request, query }) =>
      serviceFor(resolveActor({ ctx, db, request })).quote(query.planId, query.billingCycle),
  }),

  /**
   * Opens a hosted checkout session and returns the URL to navigate to.
   *
   * Rate limited per actor. Each call is a server-to-server request to Safepay
   * that creates a payment session, so an unthrottled endpoint is both a way to
   * exhaust the gateway's rate limit and a way to fill the ledger with orders.
   */
  checkout: createHandler({
    operation: 'billing.checkout.create',
    auth: 'session',
    body: createCheckoutBodySchema,
    response: checkoutSessionDtoSchema,
    message: 'Checkout session created.',
    status: 201,
    rateLimit: {
      limit: 8,
      windowMs: 60_000,
      key: ({ request, ctx }) => {
        const grant = ctx ? null : verifyCheckoutGrant(request.cookies.get(CHECKOUT_GRANT_COOKIE)?.value);
        const identity =
          ctx?.tenantId ?? grant?.tenantId ?? request.headers.get('x-forwarded-for') ?? 'anon';
        return `billing.checkout:${identity}`;
      },
    },
    handle: async ({ ctx, db, request, body }) => {
      const actor = resolveActor({ ctx, db, request });
      log.info('checkout requested', { planId: body.planId, billingCycle: body.billingCycle, via: actor.via });
      return serviceFor(actor).createCheckout(body, { userId: actor.userId });
    },
  }),

  /** Payment history. Dashboard-only — a checkout grant cannot read it. */
  orders: createHandler({
    operation: 'billing.orders.list',
    auth: 'tenant',
    query: listOrdersQuerySchema,
    response: listOf(paymentOrderDtoSchema),
    handle: async ({ db, ctx, query }) =>
      paged(await BillingService.create(db, ctx.tenantId).listOrders(query), 'Payments retrieved.'),
  }),

  /**
   * Turns auto-renewal off or back on. Access always runs to the end of the
   * period already paid for.
   */
  cancel: createHandler({
    operation: 'billing.subscription.cancel',
    auth: 'tenant',
    body: cancelSubscriptionBodySchema,
    response: subscriptionDtoSchema,
    handle: async ({ db, ctx, body }) => {
      const subscription = await BillingService.create(db, ctx.tenantId).setCancelAtPeriodEnd(
        body.cancelAtPeriodEnd,
      );
      return result(subscription, {
        message: body.cancelAtPeriodEnd
          ? 'Auto-renewal turned off. Your workspace stays active until the end of the current period.'
          : 'Auto-renewal turned back on.',
      });
    },
  }),

  /**
   * The browser's return trip from checkout.
   *
   * A raw handler because it must answer with a redirect, not the JSON envelope —
   * this URL is loaded by the customer's browser as a form target, so the
   * response has to be a page they can look at.
   *
   * `POST` is the completion path (Safepay submits a form with `sig`); `GET` is
   * the cancel path. Neither is trusted to decide anything on its own: `POST`
   * proceeds only if the HMAC verifies *and* the tracker matches the order it
   * was looked up by, and `GET` can only ever move an order out of `pending`.
   *
   * This is the *secondary* settlement path. The webhook is primary. Both exist
   * because a customer who closes the tab must still get what they paid for, and
   * a merchant whose webhook is not enabled must still be able to sell.
   */
  callback: createRawHandler({
    operation: 'billing.callback',
    auth: 'public',
    handle: async ({ request }) => {
      const origin = safeOrigin();

      if (request.method === 'GET') {
        return handleCancelReturn(request, origin);
      }

      const body = await readCallbackBody(request);
      const callback = parseRedirectCallback(body);

      const order = await resolveOrder({ tracker: callback.tracker, reference: callback.orderReference });
      if (!order) {
        log.warn('redirect callback for an unknown order', {
          reference: callback.orderReference,
          hasTracker: Boolean(callback.tracker),
        });
        return resultRedirect({ origin, reference: callback.orderReference, status: 'unknown' });
      }

      const config = callbackConfig();
      if (!config) {
        // Fails closed. Without the secret nothing can be verified, and treating
        // an unverifiable callback as payment would let anyone activate an
        // account by POSTing to this URL.
        log.error('redirect callback received while the gateway is unconfigured');
        return resultRedirect({ origin, reference: order.reference, status: 'unverified' });
      }

      const service = BillingService.create(tenantDb(order.tenantId), order.tenantId);

      // The tracker must belong to *this* order. Without this check a valid
      // signature for any tracker could be paired with an unrelated order
      // reference to settle it — the signature covers the tracker alone, so it
      // says nothing about which order is being paid.
      const trackerMatches = Boolean(callback.tracker) && callback.tracker === order.tracker;
      const signatureValid =
        trackerMatches &&
        verifyRedirectSignature({
          tracker: callback.tracker as string,
          signature: callback.signature,
          secret: config.v1Secret,
        });

      if (!signatureValid) {
        log.warn('rejected a redirect callback', {
          reference: order.reference,
          trackerMatches,
          hasSignature: Boolean(callback.signature),
        });
        await service.recordRejectedCallback({
          orderId: order.orderId,
          source: 'redirect',
          eventType: 'signature.rejected',
          dedupeKey: rejectionDedupeKey('redirect:rejected', order.reference),
          payload: sanitizeCallbackPayload({ ...body, trackerMatches }),
        });
        return resultRedirect({ origin, reference: order.reference, status: 'unverified' });
      }

      // A verified signature proves Safepay processed this tracker; it does not
      // by itself prove a capture, because `sig` covers the tracker alone and is
      // a fixed value for its lifetime. So if the body carries a state, that
      // state decides — a signed decline must not settle as paid. Safepay's
      // documented redirect body has no state field, in which case we fall back
      // to treating a valid signature as a capture, which is what the official
      // WooCommerce and ASP.NET integrations do.
      const declaredOutcome = classifyState(callback.state);
      if (declaredOutcome === 'unknown' && callback.state) {
        // A state we cannot interpret is not evidence of payment. Leave the order
        // pending for the webhook (or the sweep) rather than guessing.
        log.warn('redirect callback carried an unrecognised state', {
          reference: order.reference,
          state: callback.state,
        });
        await service.recordRejectedCallback({
          orderId: order.orderId,
          source: 'redirect',
          eventType: 'state.unrecognised',
          dedupeKey: rejectionDedupeKey('redirect:unknown', order.reference),
          payload: sanitizeCallbackPayload(body),
        });
        return resultRedirect({ origin, reference: order.reference, status: 'pending' });
      }

      const outcome = declaredOutcome === 'unknown' ? 'paid' : declaredOutcome;

      const settlement = await service.settle({
        reference: order.reference,
        outcome,
        referenceCode: callback.referenceCode,
        source: 'redirect',
        // Keyed on the tracker and outcome, not on a timestamp: a customer who
        // refreshes the return page must not be able to settle twice.
        dedupeKey: `redirect:${outcome}:${order.tracker}`,
        payload: sanitizeCallbackPayload(body),
      });

      return resultRedirect({
        origin,
        reference: order.reference,
        status: settlement.order.status,
      });
    },
  }),

  /**
   * Safepay's server-to-server notification. The primary settlement path.
   *
   * Order of operations, and why:
   *
   *  1. Read the raw body **once** and verify `X-SFPY-SIGNATURE` over exactly
   *     those bytes. Re-serialising parsed JSON changes whitespace and key
   *     order, which breaks the HMAC.
   *  2. Reject with 401 on a bad or missing signature, before parsing.
   *  3. Resolve the order, settle, and only then answer 200.
   *
   * Unlike the WhatsApp webhook this does **not** acknowledge before
   * processing. That pattern exists there because one inbound message fans out
   * into AI calls, flows and automations — seconds of work. Settlement is a
   * handful of indexed queries, and for money the tradeoff inverts: if the
   * process dies mid-settlement we *want* Safepay to retry, which only happens
   * if it has not already had its 200. Duplicate deliveries are free, thanks to
   * the dedupe key.
   */
  webhook: createRawHandler({
    operation: 'billing.webhook',
    auth: 'public',
    handle: async ({ request }) => {
      const rawBody = await request.text();

      const config = callbackConfig();
      if (!config) {
        // 503, so Safepay retries once an operator fixes the configuration
        // rather than treating the notification as delivered.
        log.error('webhook received while the gateway is unconfigured');
        return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 });
      }

      const verification = verifyWebhookSignature({
        rawBody,
        signature: request.headers.get('x-sfpy-signature'),
        secret: config.webhookSecret,
      });

      if (!verification.valid) {
        log.warn('rejected a webhook signature', {
          hasDedicatedWebhookSecret: config.hasDedicatedWebhookSecret,
        });
        return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
      }

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        // Signed but unparseable. 200 rather than 400: retrying will not fix a
        // malformed body, and Safepay would redeliver it indefinitely.
        log.error('webhook body was signed but is not valid JSON');
        return NextResponse.json({ status: 'ignored' }, { status: 200 });
      }

      const callback = parseWebhookCallback(parsed);
      const outcome = classifyState(callback.state);

      const order = await resolveOrder({ tracker: callback.tracker, reference: callback.orderReference });
      if (!order) {
        // Most often a webhook for a payment made through another integration on
        // the same merchant account. Logged, acknowledged, ignored.
        log.warn('webhook for an unknown order', {
          reference: callback.orderReference,
          state: callback.state,
          signaturePayload: verification.matched,
        });
        return NextResponse.json({ status: 'ignored' }, { status: 200 });
      }

      if (outcome === 'unknown') {
        // A state we do not recognise is never read as payment. Logged at error
        // because it may mean a charged card with no subscription, and recorded
        // so the vocabulary can be extended from real payloads rather than
        // guesswork.
        log.error('webhook carried an unrecognised state; the order was left untouched', {
          reference: order.reference,
          state: callback.state,
        });
        const service = BillingService.create(tenantDb(order.tenantId), order.tenantId);
        await service.recordRejectedCallback({
          orderId: order.orderId,
          source: 'webhook',
          eventType: 'state.unrecognised',
          dedupeKey: `webhook:unknown:${callback.eventId ?? order.tracker}:${callback.state ?? 'none'}`,
          payload: sanitizeCallbackPayload(parsed),
        });
        return NextResponse.json({ status: 'ignored' }, { status: 200 });
      }

      const service = BillingService.create(tenantDb(order.tenantId), order.tenantId);
      const settlement = await service.settle({
        reference: order.reference,
        outcome,
        referenceCode: callback.referenceCode,
        source: 'webhook',
        // Prefer the provider's own event id. Falling back to tracker+outcome
        // still dedupes redeliveries while letting a genuine state change
        // (pending → failed → paid on retry) through.
        dedupeKey: callback.eventId
          ? `webhook:${callback.eventId}`
          : `webhook:${order.tracker}:${outcome}`,
        payload: sanitizeCallbackPayload(parsed),
      });

      log.info('webhook processed', {
        reference: order.reference,
        outcome,
        changed: settlement.changed,
        activated: settlement.activated,
        signaturePayload: verification.matched,
      });

      return NextResponse.json({ status: 'processed' }, { status: 200 });
    },
  }),

  /**
   * Operator preflight: is the gateway usably configured, and what exactly
   * should be pasted into the Safepay dashboard?
   *
   * Exists because every value here is derivable but easy to get wrong, and the
   * failure modes are silent in the worst way — a stale `NEXT_PUBLIC_SITE_URL`
   * sends paying customers to a domain that does not exist, and a missing cron
   * secret means lapsed subscriptions are never expired. Both look fine until
   * money is involved.
   *
   * Built from the same `resolveSafepayConfig` / `resolveSiteOrigin` the checkout
   * path uses, so it cannot report one thing while the integration does another.
   * `auth: 'superAdmin'` because it enumerates which secrets are set; it never
   * returns a secret's value.
   */
  diagnostics: createHandler({
    operation: 'billing.diagnostics',
    auth: 'superAdmin',
    response: billingDiagnosticsDtoSchema,
    message: 'Billing configuration report.',
    handle: async () => buildDiagnostics(),
  }),

  /**
   * Scheduled sweep: age out abandoned checkouts, expire lapsed subscriptions,
   * reconcile split settlements. Ping from an external scheduler, hourly.
   */
  cron: createHandler({
    operation: 'billing.cron',
    auth: 'cron',
    response: billingSweepDtoSchema,
    message: 'Billing sweep completed.',
    handle: async () => BillingSweepService.create().run(),
  }),
};

/**
 * Assembles the operator configuration report.
 *
 * Every check here corresponds to a way this integration has actually been
 * observed to be misconfigured, so the list is empirical rather than defensive.
 */
function buildDiagnostics(): BillingDiagnosticsDto {
  const errors: string[] = [];
  const warnings: string[] = [];

  let config: SafepayConfig | null = null;
  try {
    config = resolveSafepayConfig();
  } catch (error) {
    errors.push(error instanceof SafepayConfigError ? error.message : 'Gateway configuration is unreadable.');
  }

  if (!config && errors.length === 0) {
    const missing = [
      !process.env.SAFEPAY_API_KEY ? 'SAFEPAY_API_KEY' : null,
      !process.env.SAFEPAY_SECRET_KEY ? 'SAFEPAY_SECRET_KEY' : null,
    ].filter((name): name is string => name !== null);
    errors.push(
      `Safepay is not configured — set ${missing.join(' and ')}. Checkout currently returns 501 and no payment can be taken.`,
    );
  }

  let origin: string | null = null;
  try {
    origin = resolveSiteOrigin();
  } catch (error) {
    errors.push(
      error instanceof SafepayConfigError
        ? error.message
        : 'NEXT_PUBLIC_SITE_URL is not a usable absolute URL.',
    );
  }

  const cronSecret = Boolean(process.env.AUTOMATION_CRON_SECRET);
  if (!cronSecret) {
    errors.push(
      'AUTOMATION_CRON_SECRET is not set, so GET /api/billing/cron refuses to run. Lapsed subscriptions will never be expired and a payment that settled without its entitlement landing will never be repaired.',
    );
  }

  if (config?.environment === 'sandbox') {
    warnings.push('SAFEPAY_ENVIRONMENT is "sandbox" — real cards will not be charged.');
  }
  if (config && !config.hasDedicatedWebhookSecret) {
    warnings.push(
      'SAFEPAY_WEBHOOK_SECRET is not set, so webhook signatures are verified with SAFEPAY_SECRET_KEY. That works, but a dedicated webhook secret is stronger.',
    );
  }
  if (origin && /^http:\/\//i.test(origin)) {
    warnings.push(
      'NEXT_PUBLIC_SITE_URL is plain http. Safepay will still redirect, but card-payment return traffic should be https in production.',
    );
  }
  if (origin && /localhost|127\.0\.0\.1|\[::1\]/i.test(origin)) {
    warnings.push(
      'NEXT_PUBLIC_SITE_URL points at localhost, which Safepay cannot reach — webhooks will not be delivered. The browser redirect still works, so checkout is testable, but settlement depends on the redirect alone. Use a tunnel (cloudflared, ngrok) or a public domain to test webhooks.',
    );
  }
  if (origin && /example\.(com|org|invalid)/i.test(origin)) {
    errors.push(
      `NEXT_PUBLIC_SITE_URL is still a placeholder (${origin}). Safepay would send paying customers there after checkout.`,
    );
  }

  return {
    configured: config !== null && errors.length === 0,
    environment: config?.environment ?? null,
    credentials: {
      apiKey: Boolean(process.env.SAFEPAY_API_KEY),
      secretKey: Boolean(process.env.SAFEPAY_SECRET_KEY),
      dedicatedWebhookSecret: config?.hasDedicatedWebhookSecret ?? false,
      cronSecret,
    },
    siteOrigin: origin,
    endpoints: {
      webhook: origin ? `${origin}/api/billing/webhook` : null,
      redirect: origin ? `${origin}/api/billing/callback` : null,
      cancel: origin ? `${origin}/api/billing/callback?outcome=cancel&ref=<reference>` : null,
      cron: origin ? `${origin}/api/billing/cron` : null,
      trackerApi: config ? `${config.apiBaseUrl}/order/v1/init` : null,
      checkout: config ? `${config.checkoutBaseUrl}/pay` : null,
    },
    errors,
    warnings,
    currency: BILLING_CURRENCY,
    plans: PLAN_LIST.map((plan) => ({
      id: plan.id,
      name: plan.name,
      monthlyMinor: plan.pricing.monthly.priceMinor,
      annualMinor: plan.pricing.annual.priceMinor,
      setupFeeMinor: plan.setupFeeMinor,
    })),
  };
}

/**
 * Origin for the redirect targets, tolerating a misconfigured
 * `NEXT_PUBLIC_SITE_URL`.
 *
 * A configuration error must not turn a completed payment into a 500 — the money
 * has already moved. Falling back to the request-independent default keeps the
 * customer on a page that can explain itself.
 */
function safeOrigin(): string {
  try {
    return resolveSiteOrigin();
  } catch (error) {
    if (error instanceof SafepayConfigError) {
      log.error('NEXT_PUBLIC_SITE_URL is not a usable origin', { err: error });
      return 'https://wacrm.tech';
    }
    throw error;
  }
}

/**
 * The cancel URL. Safepay sends the customer here as a plain GET when they
 * abandon checkout.
 *
 * **This deliberately changes no state.** It is unauthenticated and unsigned —
 * the only thing it receives is an order reference, which is also rendered in
 * the result page's URL and therefore reaches browser history, server logs and
 * referrer headers. Closing an order on the strength of that would let anyone
 * holding a reference terminate a checkout *while the customer is still on
 * Safepay's payment page*; the payment would then land against a closed order,
 * taking the money and granting nothing.
 *
 * Nothing is lost by leaving the order open: the next checkout closes the
 * tenant's other pending orders, and the hourly sweep ages out whatever remains.
 * An abandoned checkout and a cancelled one are the same thing to us, and
 * neither is worth an unauthenticated write.
 */
async function handleCancelReturn(request: NextRequest, origin: string): Promise<NextResponse> {
  const reference = request.nextUrl.searchParams.get('ref');
  if (!reference) return resultRedirect({ origin, reference: null, status: 'canceled' });

  const order = await resolveOrder({ tracker: null, reference });
  if (!order) return resultRedirect({ origin, reference, status: 'unknown' });

  // Report what the order actually says. A customer can reach this URL after
  // paying (back button, a stale tab), and they should not be told their
  // completed payment was cancelled.
  if (order.status !== 'pending') {
    return resultRedirect({ origin, reference: order.reference, status: order.status });
  }

  log.info('customer returned from the cancel URL', { reference: order.reference });
  return resultRedirect({ origin, reference: order.reference, status: 'canceled' });
}

/** Narrowing helpers used by the super-admin bridge. */
export function coercePlanId(value: unknown, fallback: PlanId): PlanId {
  return isPlanId(value) ? value : fallback;
}

export function coerceBillingCycle(value: unknown, fallback: BillingCycle): BillingCycle {
  return isBillingCycle(value) ? value : fallback;
}
