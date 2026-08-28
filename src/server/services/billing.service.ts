/**
 * Subscription and payment business rules.
 *
 * ## The trust model, stated plainly
 *
 * Safepay's v1 API offers no way to read a payment's state back, so settlement
 * is driven by two callbacks it sends us, each authenticated by an HMAC over our
 * own secret:
 *
 *   - the **webhook** (server to server, `X-SFPY-SIGNATURE`), and
 *   - the **redirect** (browser form POST, `sig`).
 *
 * Both are treated as authoritative for the single claim "Safepay processed this
 * tracker". Nothing else in either payload is trusted. In particular the
 * **amount, plan, cycle and period are always read from our own `PaymentOrder`
 * row**, never from the callback — so a caller who somehow forged a signature
 * still could not change what they were charged or what they received.
 *
 * The webhook is preferred (a customer closing the tab must not cost them a
 * subscription they paid for) but the redirect is honoured too, because webhook
 * delivery has to be enabled per merchant and a deployment where it silently is
 * not must still activate paying customers. Both paths converge on `settle`,
 * which is idempotent, so the ordinary case of *both* arriving is a no-op the
 * second time.
 *
 * ## Idempotency
 *
 * Two independent mechanisms, because payment providers retry until they get a
 * 2xx and duplicate activation means giving away a billing period:
 *
 *   1. `PaymentEvent.dedupeKey` — a UNIQUE index claimed *before* any state
 *      changes. The database, not application logic, decides who wins a race.
 *   2. `PaymentOrder.status = 'pending'` in the settlement `UPDATE`'s `WHERE`.
 *      An order can leave `pending` exactly once.
 *
 * ## Legacy field sync
 *
 * Access control in this codebase predates any notion of a subscription: the
 * login route, `rotateRefreshToken` and the super-admin tools all read
 * `User.isVerified` / `User.subscriptionExpiresAt` and `Tenant.plan` /
 * `Tenant.isActive`. Rather than rewrite those enforcement points — and risk
 * locking out every existing account — activation writes through to them, so
 * the new `Subscription` row and the old columns always agree. `Subscription` is
 * the source of truth; the others are a projection of it.
 */

import { randomBytes } from 'node:crypto';

import {
  BILLING_CURRENCY,
  addBillingPeriod,
  getPlan,
  normalizePlanId,
  quote as priceQuote,
  resolveBillingPeriod,
  type BillingCycle,
  type PlanId,
  type Quote,
} from '@/lib/billing/plans';
import { SafepayApiError, buildCheckoutUrl, createTracker } from '@/lib/safepay/client';
import {
  SafepayConfigError,
  requireSafepayConfig,
  resolveSiteOrigin,
  type SafepayConfig,
} from '@/lib/safepay/config';

import {
  ConflictError,
  ExternalApiError,
  NotFoundError,
  NotImplementedError,
  getLogger,
  systemDb,
  type Page,
  type TenantDb,
} from '../kernel';
import {
  emptySubscriptionDto,
  isSubscriptionActive,
  toPaymentOrderDto,
  toSubscriptionDto,
  type CheckoutSessionDto,
  type PaymentOrderDto,
  type QuoteDto,
  type SubscriptionDto,
} from '../dtos/billing.dto';
import {
  PaymentEventRepository,
  PaymentOrderRepository,
  SubscriptionRepository,
  type PaymentOrderRow,
} from '../repositories/billing.repository';
import type { CreateCheckoutBody, ListOrdersQuery } from '../validators/billing.validator';

const log = getLogger('billing');

/**
 * How long a checkout session stays usable. Generous enough for a bank's 3-D
 * Secure step-up and a retry, short enough that an abandoned order does not sit
 * `pending` for days looking like a payment in flight.
 */
const CHECKOUT_TTL_MS = 60 * 60 * 1000;

export interface SettlementResult {
  order: PaymentOrderDto;
  /** True when *this* call transitioned the order out of `pending`. */
  changed: boolean;
  /** True when this call activated or extended the subscription. */
  activated: boolean;
  subscription: SubscriptionDto | null;
}

export interface BillingServiceDeps {
  subscriptions: SubscriptionRepository;
  orders: PaymentOrderRepository;
  events: PaymentEventRepository;
}

export class BillingService {
  constructor(
    private readonly deps: BillingServiceDeps,
    private readonly tenantId: string,
  ) {}

  static create(db: TenantDb, tenantId: string): BillingService {
    return new BillingService(
      {
        subscriptions: new SubscriptionRepository(db),
        orders: new PaymentOrderRepository(db),
        events: new PaymentEventRepository(db),
      },
      tenantId,
    );
  }

  // ── reads ─────────────────────────────────────────────────────────

  async getSubscription(): Promise<SubscriptionDto> {
    const row = await this.deps.subscriptions.find();
    if (row) return toSubscriptionDto(row);

    // No row is a legitimate state, not a 404: it means "never subscribed".
    // The plan chosen at signup is surfaced as a preference so the billing page
    // can pre-select it, with every entitlement field left empty.
    const selectedPlan = await this.readSignupPlanPreference();
    return emptySubscriptionDto(BILLING_CURRENCY, selectedPlan);
  }

  /**
   * Prices a plan for this tenant, including whether the one-time onboarding
   * fee still applies. The fee is the only tenant-dependent part of a quote.
   */
  async quote(planId: PlanId, billingCycle: BillingCycle): Promise<QuoteDto> {
    const subscription = await this.deps.subscriptions.find();
    return priceQuote({ planId, billingCycle, setupFeePaidPlanId: subscription?.setupFeePaidPlanId ?? null });
  }

  async listOrders(query: ListOrdersQuery): Promise<Page<PaymentOrderDto>> {
    const page = await this.deps.orders.list(query);
    return { ...page, items: page.items.map(toPaymentOrderDto) };
  }

  async getOrder(reference: string): Promise<PaymentOrderDto> {
    return toPaymentOrderDto(await this.deps.orders.requireByReference(reference));
  }

  // ── checkout ──────────────────────────────────────────────────────

  /**
   * Opens a hosted checkout session.
   *
   * Order of operations matters. The tracker is created at Safepay *before* the
   * local order row, because the tracker is the one step that can fail for
   * reasons outside our control; doing it first means a gateway outage leaves no
   * orphan `pending` order behind. The reverse order would litter the ledger
   * with orders that never had a payment session.
   */
  async createCheckout(body: CreateCheckoutBody, input: { userId: string | null }): Promise<CheckoutSessionDto> {
    const config = this.requireGateway();
    const now = new Date();

    const subscription = await this.deps.subscriptions.ensure({
      planId: body.planId,
      billingCycle: body.billingCycle,
      currency: BILLING_CURRENCY,
    });

    const pricing = priceQuote({
      planId: body.planId,
      billingCycle: body.billingCycle,
      setupFeePaidPlanId: subscription.setupFeePaidPlanId,
    });

    // Reusing a live session is not just tidiness: a customer who double-clicks
    // "Pay" or reloads the checkout page would otherwise open a second payment
    // session, and two live trackers for one intent is how double charges
    // happen.
    const reusable = await this.findReusableOrder({ pricing, config, now });
    if (reusable) {
      log.info('reusing an open checkout session', { reference: reusable.reference, planId: body.planId });
      await this.closeSupersededOrders(reusable.id);
      return this.toCheckoutSession({ order: reusable, pricing, config });
    }

    const reference = generateOrderReference(now);
    const tracker = await this.openGatewaySession({ config, pricing, reference });

    const order = await this.deps.orders.create({
      subscriptionId: subscription.id,
      reference,
      userId: input.userId,
      planId: pricing.planId,
      billingCycle: pricing.billingCycle,
      currency: pricing.currency,
      planAmountMinor: pricing.planAmountMinor,
      setupFeeMinor: pricing.setupFeeMinor,
      amountMinor: pricing.totalMinor,
      lineItems: pricing.lineItems,
      gatewayEnvironment: config.environment,
      tracker,
      expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MS),
    });

    // Exactly one payable session per tenant at a time. Anything else the
    // customer left open would still be payable, and two live trackers for one
    // intent is how a setup fee gets charged twice.
    await this.closeSupersededOrders(order.id);

    await this.deps.events.record({
      orderId: order.id,
      source: 'checkout',
      eventType: 'order.created',
      dedupeKey: `checkout:${order.reference}`,
      payload: {
        planId: pricing.planId,
        billingCycle: pricing.billingCycle,
        amountMinor: pricing.totalMinor,
        currency: pricing.currency,
        environment: config.environment,
        tracker,
      },
    });

    log.info('checkout session opened', {
      reference: order.reference,
      planId: pricing.planId,
      billingCycle: pricing.billingCycle,
      amountMinor: pricing.totalMinor,
      environment: config.environment,
    });

    return this.toCheckoutSession({ order, pricing, config });
  }

  /**
   * Cancels every pending order except the session being handed out.
   *
   * Best-effort: the customer has a working checkout URL either way, and failing
   * their payment because a tidy-up query errored would be the wrong trade. The
   * hourly sweep expires anything left behind.
   */
  private async closeSupersededOrders(keepOrderId: string): Promise<void> {
    try {
      const closed = await this.deps.orders.closeOtherPending({
        keepOrderId,
        reason: 'Superseded by a newer checkout session.',
      });
      if (closed > 0) log.info('closed superseded checkout sessions', { closed });
    } catch (error) {
      log.warn('could not close superseded checkout sessions', { err: error });
    }
  }

  /**
   * An existing `pending`, unexpired order for the same plan, cycle, price and
   * gateway environment. Any mismatch — most likely the setup fee having been
   * settled in between — means the old session would charge the wrong amount, so
   * a fresh one is opened instead.
   */
  private async findReusableOrder(input: {
    pricing: Quote;
    config: SafepayConfig;
    now: Date;
  }): Promise<PaymentOrderRow | null> {
    const candidate = await this.deps.orders.findOpenForPlan({
      planId: input.pricing.planId,
      billingCycle: input.pricing.billingCycle,
      now: input.now,
    });
    if (!candidate?.tracker) return null;
    if (candidate.amountMinor !== input.pricing.totalMinor) return null;
    if (candidate.currency !== input.pricing.currency) return null;
    if (candidate.gatewayEnvironment !== input.config.environment) return null;
    return candidate;
  }

  private async openGatewaySession(input: {
    config: SafepayConfig;
    pricing: Quote;
    reference: string;
  }): Promise<string> {
    try {
      const session = await createTracker({
        config: input.config,
        amountMinor: input.pricing.totalMinor,
        currency: input.pricing.currency,
      });

      // Logged because it is the only visibility into what a USD-quoted charge
      // will actually settle as in the merchant's home currency.
      log.info('safepay tracker created', {
        reference: input.reference,
        state: session.state,
        settlementCurrency: session.settlementCurrency,
        conversionRate: session.conversionRate,
      });

      return session.tracker;
    } catch (error) {
      if (error instanceof SafepayApiError) {
        log.error('safepay refused to open a payment session', {
          reference: input.reference,
          providerStatus: error.status,
          providerErrors: error.providerErrors,
          err: error,
        });
        // 502, not 500: the failure is upstream, and the client is entitled to
        // know retrying may work.
        throw new ExternalApiError('safepay', 'Could not start the payment. Please try again.', {
          cause: error,
        });
      }
      throw error;
    }
  }

  private toCheckoutSession(input: {
    order: PaymentOrderRow;
    pricing: Quote;
    config: SafepayConfig;
  }): CheckoutSessionDto {
    const origin = resolveSiteOrigin();
    const tracker = input.order.tracker;
    if (!tracker) {
      // Unreachable: a tracker is required to create the row. Asserted rather
      // than non-null-asserted so a future code path that breaks the invariant
      // fails loudly instead of building a checkout URL with `beacon=null`.
      throw new ConflictError('This payment session is missing its gateway tracker. Start a new checkout.');
    }

    return {
      reference: input.order.reference,
      checkoutUrl: buildCheckoutUrl({
        config: input.config,
        tracker,
        orderReference: input.order.reference,
        // Safepay POSTs here on completion. It is a route handler, not a page,
        // because the signature has to be verified before anything is rendered.
        redirectUrl: `${origin}/api/billing/callback`,
        cancelUrl: `${origin}/api/billing/callback?outcome=cancel&ref=${encodeURIComponent(input.order.reference)}`,
        webhooks: true,
      }),
      quote: input.pricing,
      expiresAt: input.order.expiresAt.toISOString(),
      environment: input.config.environment,
    };
  }

  // ── settlement ────────────────────────────────────────────────────

  /**
   * Applies a gateway outcome to an order. Safe to call repeatedly with the same
   * event; safe to call from both the webhook and the redirect.
   */
  async settle(input: {
    reference: string;
    outcome: 'paid' | 'failed' | 'canceled';
    referenceCode: string | null;
    source: 'webhook' | 'redirect';
    /** Provider event id where available, else a derived stable key. */
    dedupeKey: string;
    /** Already-redacted provider payload, for the audit trail. */
    payload: unknown;
    now?: Date;
  }): Promise<SettlementResult> {
    const now = input.now ?? new Date();
    const order = await this.deps.orders.requireByReference(input.reference);

    // Claim the event first. If the key is taken, this exact provider event has
    // already been processed and we must not touch anything.
    const claimed = await this.deps.events.record({
      orderId: order.id,
      source: input.source,
      eventType: `payment.${input.outcome === 'paid' ? 'succeeded' : input.outcome}`,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
    });

    if (!claimed) {
      log.info('duplicate settlement ignored', { reference: order.reference, source: input.source });
      const subscription = await this.deps.subscriptions.find();
      return {
        order: toPaymentOrderDto(order),
        changed: false,
        activated: false,
        subscription: subscription ? toSubscriptionDto(subscription, now) : null,
      };
    }

    return input.outcome === 'paid'
      ? this.applyPaidOutcome({ order, referenceCode: input.referenceCode, source: input.source, now })
      : this.applyUnpaidOutcome({ order, outcome: input.outcome, referenceCode: input.referenceCode, now });
  }

  private async applyPaidOutcome(input: {
    order: PaymentOrderRow;
    referenceCode: string | null;
    source: 'webhook' | 'redirect';
    now: Date;
  }): Promise<SettlementResult> {
    const { order, now } = input;

    // Already settled — the other callback got here first. Not an error: it is
    // the expected outcome when both the webhook and the redirect arrive.
    if (order.status === 'paid') {
      const subscription = await this.deps.subscriptions.find();
      return {
        order: toPaymentOrderDto(order),
        changed: false,
        activated: false,
        subscription: subscription ? toSubscriptionDto(subscription, now) : null,
      };
    }

    if (order.status !== 'pending') {
      // A payment for an order we had already given up on (expired, or
      // superseded by a newer session the customer then abandoned). Logged at
      // **error** rather than warn on purpose: the money moved and the customer
      // has nothing to show for it, so a human has to intervene, and error level
      // is what reaches monitoring. Not thrown — the provider must still get a
      // 2xx, because retrying cannot change the outcome.
      log.error('payment settled against a closed order; manual intervention required', {
        reference: order.reference,
        orderStatus: order.status,
        source: input.source,
      });
      return {
        order: toPaymentOrderDto(order),
        changed: false,
        activated: false,
        subscription: null,
      };
    }

    const planId = normalizePlanId(order.planId);
    const billingCycle: BillingCycle = order.billingCycle === 'annual' ? 'annual' : 'monthly';
    if (!planId) {
      log.error('paid order references an unknown plan', { reference: order.reference, planId: order.planId });
      throw new ConflictError('This order references a plan that no longer exists. Contact support.');
    }

    const subscription = await this.deps.subscriptions.ensure({
      planId,
      billingCycle,
      currency: order.currency,
    });

    // Renewals extend from the existing period end so paying early never costs
    // the customer the days they had left.
    const period = resolveBillingPeriod({
      paidAt: now,
      cycle: billingCycle,
      currentPeriodEnd: subscription.currentPeriodEnd,
    });

    const settled = await this.deps.orders.markPaid({
      id: order.id,
      paidAt: now,
      referenceCode: input.referenceCode,
      periodStart: period.start,
      periodEnd: period.end,
    });

    if (!settled) {
      // Lost a race with a concurrent delivery. The winner did the work.
      log.info('settlement raced and lost; the concurrent delivery won', { reference: order.reference });
      const current = await this.deps.orders.requireByReference(order.reference);
      const latest = await this.deps.subscriptions.find();
      return {
        order: toPaymentOrderDto(current),
        changed: false,
        activated: false,
        subscription: latest ? toSubscriptionDto(latest, now) : null,
      };
    }

    const advanced = await this.deps.subscriptions.applyPayment({
      planId,
      billingCycle,
      currency: order.currency,
      periodStart: period.start,
      periodEnd: period.end,
      paidAt: now,
      setupFeePaidPlanId: order.setupFeeMinor > 0 ? planId : null,
    });

    // `now` is threaded through rather than letting `grantAccess` read the clock
    // again. Its suspended-user predicate compares against this instant, and a
    // settlement that used two different "now"s could classify a member
    // differently from the period it just wrote.
    await this.grantAccess({ periodEnd: period.end, planId, now });

    log.info('subscription activated', {
      reference: order.reference,
      planId,
      billingCycle,
      periodEnd: period.end.toISOString(),
      source: input.source,
    });

    return {
      order: toPaymentOrderDto(await this.deps.orders.requireByReference(order.reference)),
      changed: true,
      activated: true,
      subscription: toSubscriptionDto(advanced, now),
    };
  }

  private async applyUnpaidOutcome(input: {
    order: PaymentOrderRow;
    outcome: 'failed' | 'canceled';
    referenceCode: string | null;
    now: Date;
  }): Promise<SettlementResult> {
    const reason =
      input.outcome === 'failed'
        ? 'The payment was declined or could not be completed.'
        : 'Checkout was cancelled before payment completed.';

    const changed = await this.deps.orders.closeUnpaid({
      id: input.order.id,
      status: input.outcome,
      reason,
      referenceCode: input.referenceCode,
    });

    const subscription = await this.deps.subscriptions.find();

    // Deliberately does not touch entitlement. A failed renewal must not revoke
    // a period the customer already paid for — that is the expiry sweep's job,
    // and only once the period actually elapses.
    return {
      order: toPaymentOrderDto(await this.deps.orders.requireByReference(input.order.reference)),
      changed,
      activated: false,
      subscription: subscription ? toSubscriptionDto(subscription, input.now) : null,
    };
  }

  /** Records a callback we could authenticate but not act on. */
  async recordRejectedCallback(input: {
    orderId: string | null;
    source: 'webhook' | 'redirect';
    eventType: string;
    dedupeKey: string;
    payload: unknown;
  }): Promise<void> {
    await this.deps.events.record(input);
  }

  // ── cancellation ──────────────────────────────────────────────────

  /**
   * Turns auto-renewal off (or back on). Access continues to the end of the
   * paid period — there is no immediate-termination path, because revoking a
   * period the customer paid for would be theft.
   */
  async setCancelAtPeriodEnd(cancelAtPeriodEnd: boolean): Promise<SubscriptionDto> {
    const existing = await this.deps.subscriptions.find();
    if (!existing) throw new NotFoundError('Subscription');
    return toSubscriptionDto(await this.deps.subscriptions.setCancelAtPeriodEnd(cancelAtPeriodEnd));
  }

  // ── legacy projection ─────────────────────────────────────────────

  /**
   * Re-applies entitlement for an already-settled payment.
   *
   * Used by the reconciliation sweep, which has confirmed a payment landed but
   * found the projection missing. Public because it is the sweep's only way in;
   * it grants nothing that `settle` would not have granted, and it takes the
   * period from the settled order rather than computing a new one.
   */
  async reapplyEntitlement(input: { periodEnd: Date; planId: PlanId }): Promise<void> {
    await this.grantAccess(input);
  }

  /**
   * Activates a subscription without a gateway payment.
   *
   * The escape hatch for the operator flows that predate this integration: a
   * bank transfer settled out of band, a comped account, a customer whose card
   * cannot reach a Pakistani processor. Both super-admin approval paths route
   * through here so that a manually approved account gets a real `Subscription`
   * row instead of only the legacy columns — otherwise the billing page would
   * show "not subscribed" to someone an operator had just activated.
   *
   * Recorded in `PaymentEvent` with `source: 'admin'`, because a manual grant is
   * exactly the kind of thing that needs to be attributable later.
   */
  async activateManually(input: {
    planId: PlanId;
    billingCycle: BillingCycle;
    /** Operator identity, for the audit trail. */
    actor: string;
    now?: Date;
  }): Promise<SubscriptionDto> {
    const now = input.now ?? new Date();

    const subscription = await this.deps.subscriptions.ensure({
      planId: input.planId,
      billingCycle: input.billingCycle,
      currency: BILLING_CURRENCY,
    });

    const period = resolveBillingPeriod({
      paidAt: now,
      cycle: input.billingCycle,
      currentPeriodEnd: subscription.currentPeriodEnd,
    });

    // Claimed *before* the grant, and keyed on the period it would produce
    // rather than on a timestamp. An operator double-clicking "Approve" would
    // otherwise compute the same period twice and stack two months onto the
    // subscription — a millisecond-precision key deduplicates nothing.
    const claimed = await this.deps.events.record({
      orderId: null,
      source: 'admin',
      eventType: 'subscription.activated',
      dedupeKey: `admin:${this.tenantId}:${input.planId}:${period.end.toISOString()}`,
      payload: {
        planId: input.planId,
        billingCycle: input.billingCycle,
        periodEnd: period.end.toISOString(),
        actor: input.actor,
      },
    });

    if (!claimed) {
      log.info('duplicate manual activation ignored', { planId: input.planId });
      return toSubscriptionDto(await this.deps.subscriptions.require(), now);
    }

    const advanced = await this.deps.subscriptions.applyPayment({
      planId: input.planId,
      billingCycle: input.billingCycle,
      currency: BILLING_CURRENCY,
      periodStart: period.start,
      periodEnd: period.end,
      paidAt: now,
      // A manual activation covers onboarding too: an operator granting Managed
      // is not going to ask the customer for the setup fee separately.
      setupFeePaidPlanId: getPlan(input.planId).setupFeeMinor > 0 ? input.planId : null,
    });

    await this.grantAccess({ periodEnd: period.end, planId: input.planId, now });

    log.info('subscription activated manually', {
      planId: input.planId,
      billingCycle: input.billingCycle,
      periodEnd: period.end.toISOString(),
    });

    return toSubscriptionDto(advanced, now);
  }

  /**
   * Mirrors the subscription onto the columns the existing access checks read.
   *
   * Justified `systemDb` use: `User` and `Tenant` are classified `global` in
   * `TENANT_SCOPES` and are unreachable through the guarded client by design.
   * Both writes are constrained to this tenant — the `Tenant` update by id, the
   * `User` update to the set of users whose `Profile.tenantId` is this tenant —
   * so no row outside the tenant can be touched.
   *
   * Applied to every member, not only the owner, because the subscription is a
   * tenant-level entitlement: if the workspace is paid for, the whole team can
   * log in. Platform operators are excluded so a billing lapse can never lock
   * an administrator out of the tooling needed to fix it.
   */
  private async grantAccess(input: { periodEnd: Date; planId: PlanId; now?: Date }): Promise<void> {
    const memberIds = await this.tenantMemberUserIds();
    const now = input.now ?? new Date();

    await systemDb.$transaction([
      systemDb.tenant.update({
        where: { id: this.tenantId },
        data: { plan: input.planId, isActive: true },
      }),

      // Restoring access comes FIRST, and the order is load-bearing.
      //
      // `isVerified: false` means two different things on this schema — "billing
      // has not been settled" and "an operator suspended this person" — and a
      // blanket grant would quietly un-suspend the latter every time their
      // workspace renewed.
      //
      // The two are told apart by the same signature the login route uses: a
      // suspended user has an unexpired `subscriptionExpiresAt` *and*
      // `isVerified: false`, because their period was already paid for when the
      // operator switched them off. Anyone whose period had lapsed (or who never
      // had one) was locked by billing, and this payment is what unlocks them.
      //
      // Prisma runs these sequentially, so this predicate has to read the
      // *pre-payment* expiry. Writing the new period first would set everyone's
      // date into the future and make every billing-locked user look suspended —
      // which would mean nobody was ever re-enabled by paying.
      systemDb.user.updateMany({
        where: {
          id: { in: memberIds },
          role: { not: 'super_admin' },
          OR: [
            { isVerified: true },
            { subscriptionExpiresAt: null },
            { subscriptionExpiresAt: { lte: now } },
          ],
        },
        data: { isVerified: true },
      }),

      // The paid period and plan then apply to every member unconditionally:
      // that is a fact about the workspace, not about any one user's access.
      systemDb.user.updateMany({
        where: { id: { in: memberIds }, role: { not: 'super_admin' } },
        data: { subscriptionExpiresAt: input.periodEnd, selectedPlan: input.planId },
      }),
    ]);
  }

  /**
   * Revokes access after a period lapses, and kills live sessions.
   *
   * Deleting refresh tokens is what makes the lock immediate. Without it an
   * expired subscriber keeps working for up to fifteen minutes on an
   * unexpired access token — and `rotateRefreshToken` would eventually refuse
   * them anyway, so this only brings that forward rather than introducing new
   * behaviour.
   */
  async revokeAccess(): Promise<number> {
    const memberIds = await this.tenantMemberUserIds();
    if (memberIds.length === 0) return 0;

    const [, locked] = await systemDb.$transaction([
      systemDb.tenant.update({ where: { id: this.tenantId }, data: { isActive: false } }),
      systemDb.user.updateMany({
        where: { id: { in: memberIds }, role: { not: 'super_admin' } },
        data: { isVerified: false },
      }),
      systemDb.refreshToken.deleteMany({
        where: { userId: { in: memberIds }, user: { role: { not: 'super_admin' } } },
      }),
    ]);

    return locked.count;
  }

  /**
   * Users belonging to this tenant.
   *
   * Justified `systemDb` use: `Profile` is tenant-scoped but `User` is not, and
   * this resolves the bridge between them. Filtered by `tenantId` explicitly
   * because the guarded client is not in play here.
   */
  private async tenantMemberUserIds(): Promise<string[]> {
    const profiles = await systemDb.profile.findMany({
      where: { tenantId: this.tenantId },
      select: { userId: true },
    });

    const ids = new Set(profiles.map((profile) => profile.userId));

    // The owner is included even without a profile row. Signup always creates
    // one, but a tenant provisioned by an older release or by an operator may
    // not have it, and leaving the owner unactivated would mean a customer who
    // paid still cannot log in.
    const tenant = await systemDb.tenant.findUnique({
      where: { id: this.tenantId },
      select: { ownerUserId: true },
    });
    if (tenant?.ownerUserId) ids.add(tenant.ownerUserId);

    return [...ids];
  }

  /**
   * The plan chosen during signup, before any payment.
   *
   * Justified `systemDb` use: `User.selectedPlan` is on a global model. Read
   * only to pre-select a card on the billing page — it grants nothing.
   */
  private async readSignupPlanPreference(): Promise<string | null> {
    const tenant = await systemDb.tenant.findUnique({
      where: { id: this.tenantId },
      select: { plan: true, owner: { select: { selectedPlan: true } } },
    });
    return tenant?.owner?.selectedPlan ?? tenant?.plan ?? null;
  }

  // ── configuration ─────────────────────────────────────────────────

  /**
   * Translates a configuration failure into an HTTP-shaped error.
   *
   * 501 rather than 500: the endpoint exists and the code is fine, the operator
   * simply has not supplied credentials — the same distinction
   * `requireCronSecret` makes. The message is ours, so it is safe to expose and
   * tells the operator exactly which variable is missing.
   */
  private requireGateway(): SafepayConfig {
    try {
      return requireSafepayConfig();
    } catch (error) {
      if (error instanceof SafepayConfigError) {
        log.error('checkout attempted with an unconfigured gateway', { missing: error.missing });
        throw new NotImplementedError(error.message);
      }
      throw error;
    }
  }
}

/**
 * Human-readable, unguessable order reference.
 *
 * The date prefix makes a support conversation ("order from the 28th") tractable
 * without a database lookup. The random suffix is 32 bits from a CSPRNG: the
 * reference travels through Safepay and appears in the cancel URL, so a
 * sequential counter would leak order volume and let anyone enumerate other
 * customers' references.
 */
export function generateOrderReference(now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `HTC-${date}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Re-exported so the cron sweep and the settlement path agree on the rule. */
export { addBillingPeriod, getPlan, isSubscriptionActive };
