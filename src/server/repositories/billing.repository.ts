/**
 * Billing persistence: subscriptions, payment orders, and the event log.
 *
 * Three repositories in one file because they form a single aggregate boundary —
 * an order settles and a subscription advances in the same transaction, and
 * splitting them across files would only hide that coupling.
 *
 * ## Why `upsert` is avoided
 *
 * `Subscription` is keyed by a unique `tenantId`, but a repository has no
 * `tenantId` to pass: the whole design of `tenantDb` is that application code
 * never names a tenant. Prisma's `upsert` demands the unique selector in
 * `where`, so calling it would mean passing a placeholder for the guard to
 * overwrite — technically fine, but it reads like the code chooses a tenant,
 * which is exactly the confusion the guard exists to prevent. `findFirst` then
 * `create`, with the unique index catching the concurrent case, keeps that
 * property visible.
 */

import type { Prisma } from '@prisma/client';

import { scoped, type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { toInputJson } from '../dtos/common.dto';
import { BaseRepository } from './base.repository';

/** Prisma's error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;
}

const subscriptionSelect = {
  id: true,
  planId: true,
  billingCycle: true,
  status: true,
  currency: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  canceledAt: true,
  setupFeePaidPlanId: true,
  setupFeePaidAt: true,
  lastPaymentAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SubscriptionSelect;

export type SubscriptionRow = Prisma.SubscriptionGetPayload<{ select: typeof subscriptionSelect }>;

export class SubscriptionRepository extends BaseRepository {
  protected readonly resourceName = 'Subscription';

  constructor(db: TenantDb) {
    super(db);
  }

  async find(): Promise<SubscriptionRow | null> {
    return this.db.subscription.findFirst({ select: subscriptionSelect });
  }

  async require(): Promise<SubscriptionRow> {
    return this.requireFound(await this.find());
  }

  /**
   * Returns the tenant's subscription, creating an `incomplete` one if absent.
   *
   * `incomplete` is the correct starting state: the row records an *intent* to
   * subscribe (which plan the customer is buying) and carries no period, so
   * `isSubscriptionActive` reports false until a payment settles. Creating it at
   * checkout rather than at settlement means an abandoned checkout leaves a
   * visible record of what was attempted.
   */
  async ensure(input: { planId: string; billingCycle: string; currency: string }): Promise<SubscriptionRow> {
    const existing = await this.find();
    if (existing) return existing;

    try {
      return await this.db.subscription.create({
        data: scoped({
          planId: input.planId,
          billingCycle: input.billingCycle,
          currency: input.currency,
          status: 'incomplete',
        }),
        select: subscriptionSelect,
      });
    } catch (error) {
      // Lost a race against a concurrent checkout. The unique index on
      // tenantId is what makes this safe; the winner's row is the right one.
      if (isUniqueViolation(error)) return this.require();
      throw error;
    }
  }

  /**
   * Advances the subscription after a payment settles.
   *
   * Writes the plan and cycle from the *order*, not from the current row, so a
   * customer switching tiers or cycles lands on what they actually paid for.
   */
  async applyPayment(input: {
    planId: string;
    billingCycle: string;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
    paidAt: Date;
    /** Set when this order included the one-time onboarding fee. */
    setupFeePaidPlanId: string | null;
  }): Promise<SubscriptionRow> {
    this.requireAffected(
      await this.db.subscription.updateMany({
        // Monotonic guard: only advance the period, never pull it back. The
        // period is computed from a read of `currentPeriodEnd` that happened
        // before this write, so a concurrent settlement could have moved it
        // forward in between — and applying a stale, earlier end would shorten a
        // subscription the customer has already paid for. An unaffected row here
        // means the concurrent write was the later one and already won, which
        // `requireAffected` would report as a conflict, so the null case is
        // included explicitly for a first payment.
        where: { OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { lte: input.periodEnd } }] },
        data: {
          planId: input.planId,
          billingCycle: input.billingCycle,
          currency: input.currency,
          status: 'active',
          currentPeriodStart: input.periodStart,
          currentPeriodEnd: input.periodEnd,
          lastPaymentAt: input.paidAt,
          // A successful payment revokes a pending cancellation: the customer
          // demonstrably wants to continue.
          cancelAtPeriodEnd: false,
          canceledAt: null,
          ...(input.setupFeePaidPlanId
            ? { setupFeePaidPlanId: input.setupFeePaidPlanId, setupFeePaidAt: input.paidAt }
            : {}),
        },
      }),
    );
    return this.require();
  }

  async setCancelAtPeriodEnd(cancelAtPeriodEnd: boolean): Promise<SubscriptionRow> {
    this.requireAffected(
      await this.db.subscription.updateMany({
        where: {},
        data: { cancelAtPeriodEnd, canceledAt: cancelAtPeriodEnd ? new Date() : null },
      }),
    );
    return this.require();
  }
}

// ── payment orders ──────────────────────────────────────────────────

const orderSelect = {
  id: true,
  subscriptionId: true,
  reference: true,
  userId: true,
  planId: true,
  billingCycle: true,
  status: true,
  currency: true,
  planAmountMinor: true,
  setupFeeMinor: true,
  amountMinor: true,
  lineItems: true,
  gateway: true,
  gatewayEnvironment: true,
  tracker: true,
  referenceCode: true,
  paidAt: true,
  failureReason: true,
  periodStart: true,
  periodEnd: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentOrderSelect;

export type PaymentOrderRow = Prisma.PaymentOrderGetPayload<{ select: typeof orderSelect }>;

/** Statuses from which an order can still change. Anything else is settled. */
const OPEN_ORDER_STATUSES = ['pending'] as const;

export class PaymentOrderRepository extends BaseRepository {
  protected readonly resourceName = 'Payment order';

  constructor(db: TenantDb) {
    super(db);
  }

  async create(input: {
    subscriptionId: string;
    reference: string;
    userId: string | null;
    planId: string;
    billingCycle: string;
    currency: string;
    planAmountMinor: number;
    setupFeeMinor: number;
    amountMinor: number;
    lineItems: unknown;
    gatewayEnvironment: string;
    tracker: string;
    expiresAt: Date;
  }): Promise<PaymentOrderRow> {
    return this.db.paymentOrder.create({
      data: scoped({
        subscriptionId: input.subscriptionId,
        reference: input.reference,
        userId: input.userId,
        planId: input.planId,
        billingCycle: input.billingCycle,
        status: 'pending',
        currency: input.currency,
        planAmountMinor: input.planAmountMinor,
        setupFeeMinor: input.setupFeeMinor,
        amountMinor: input.amountMinor,
        lineItems: toInputJson(input.lineItems) ?? [],
        gateway: 'safepay',
        gatewayEnvironment: input.gatewayEnvironment,
        tracker: input.tracker,
        expiresAt: input.expiresAt,
      }),
      select: orderSelect,
    });
  }

  async findByReference(reference: string): Promise<PaymentOrderRow | null> {
    return this.db.paymentOrder.findFirst({ where: { reference }, select: orderSelect });
  }

  async requireByReference(reference: string): Promise<PaymentOrderRow> {
    return this.requireFound(await this.findByReference(reference));
  }

  async findByTracker(tracker: string): Promise<PaymentOrderRow | null> {
    return this.db.paymentOrder.findFirst({ where: { tracker }, select: orderSelect });
  }

  async list(pagination: PaginationQuery): Promise<Page<PaymentOrderRow>> {
    return this.paginate(
      ({ skip, take }) =>
        this.db.paymentOrder.findMany({
          select: orderSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.paymentOrder.count(),
      pagination,
    );
  }

  /** The most recent order still awaiting an outcome, if any. */
  async findOpenForPlan(input: { planId: string; billingCycle: string; now: Date }): Promise<PaymentOrderRow | null> {
    return this.db.paymentOrder.findFirst({
      where: {
        planId: input.planId,
        billingCycle: input.billingCycle,
        status: { in: [...OPEN_ORDER_STATUSES] },
        expiresAt: { gt: input.now },
      },
      select: orderSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Closes every other pending order for this tenant.
   *
   * Called when a new checkout session opens. Without it, a customer who starts
   * on monthly, goes back, switches to annual and pays would leave the monthly
   * tracker payable for the rest of the hour — two live payment sessions for one
   * intent, each carrying the setup fee. Two tabs produce the same state.
   *
   * `keepOrderId` is the session just created (or reused), which must survive.
   */
  async closeOtherPending(input: { keepOrderId: string; reason: string }): Promise<number> {
    const affected = await this.db.paymentOrder.updateMany({
      where: { id: { not: input.keepOrderId }, status: { in: [...OPEN_ORDER_STATUSES] } },
      data: { status: 'canceled', failureReason: input.reason },
    });
    return affected.count;
  }

  /**
   * Transitions an order to `paid`.
   *
   * The `status: 'pending'` filter is the second half of the idempotency story
   * (the first being `PaymentEvent.dedupeKey`): a redelivered callback that
   * somehow gets past the dedupe key still matches zero rows here, so the
   * subscription cannot be extended twice. Returns whether *this* call was the
   * one that settled it.
   */
  async markPaid(input: {
    id: string;
    paidAt: Date;
    referenceCode: string | null;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<boolean> {
    const affected = await this.db.paymentOrder.updateMany({
      where: { id: input.id, status: 'pending' },
      data: {
        status: 'paid',
        paidAt: input.paidAt,
        referenceCode: input.referenceCode,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        failureReason: null,
      },
    });
    return affected.count > 0;
  }

  /**
   * Moves an open order to a terminal non-paid state.
   *
   * Never touches a `paid` order: a late "failed" or "canceled" notification
   * arriving after settlement must not revoke a subscription the customer paid
   * for. Deciding that here, in the `where` clause, means no caller can forget.
   */
  async closeUnpaid(input: {
    id: string;
    status: 'failed' | 'canceled' | 'expired';
    reason: string | null;
    referenceCode?: string | null;
  }): Promise<boolean> {
    const affected = await this.db.paymentOrder.updateMany({
      where: { id: input.id, status: { in: [...OPEN_ORDER_STATUSES] } },
      data: {
        status: input.status,
        failureReason: input.reason,
        ...(input.referenceCode ? { referenceCode: input.referenceCode } : {}),
      },
    });
    return affected.count > 0;
  }
}

// ── event log ───────────────────────────────────────────────────────

export class PaymentEventRepository extends BaseRepository {
  protected readonly resourceName = 'Payment event';

  constructor(db: TenantDb) {
    super(db);
  }

  /**
   * Appends an event, claiming `dedupeKey` in the process.
   *
   * Returns `false` when the key is already present — meaning this exact
   * provider event has been handled and the caller must stop. The insert is
   * deliberately the *first* write of any settlement: making the UNIQUE index
   * the arbiter means two concurrent deliveries of the same webhook cannot both
   * pass a check-then-act race, which an application-level "have I seen this?"
   * query would allow.
   */
  async record(input: {
    orderId: string | null;
    source: string;
    eventType: string;
    dedupeKey: string;
    payload: unknown;
  }): Promise<boolean> {
    try {
      await this.db.paymentEvent.create({
        data: scoped({
          orderId: input.orderId,
          source: input.source,
          eventType: input.eventType,
          // Truncated to the column width. A key long enough to be cut is
          // already pathological, but a silent MySQL truncation would collapse
          // two distinct events into one.
          dedupeKey: input.dedupeKey.slice(0, 191),
          payload: toInputJson(input.payload) ?? {},
        }),
        select: { id: true },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }
}
