/**
 * The scheduled billing sweep.
 *
 * Three jobs, in this order, each independent of the others so one failure
 * cannot stall the rest:
 *
 *   1. **Age out abandoned checkouts.** An order left `pending` past its expiry
 *      is a customer who closed the tab. Closing it keeps the ledger honest and
 *      stops the reuse path in `createCheckout` handing out a stale session.
 *   2. **Expire lapsed subscriptions.** Turn `active` into `expired` (or
 *      `canceled`, when the customer asked not to renew) once the paid period
 *      has elapsed, and revoke access.
 *   3. **Reconcile split settlements.** Re-apply any order that reached `paid`
 *      without its subscription advancing.
 *
 * Job 3 exists because settlement is not a single database transaction. It
 * cannot be: the order and subscription writes go through the tenant-guarded
 * client, while the entitlement projection onto `User`/`Tenant` has to use
 * `systemDb`, and the two cannot share one transaction. So a process killed
 * between "order marked paid" and "subscription advanced" would otherwise leave
 * a customer who paid without the access they bought. Rather than pretend that
 * window does not exist, this reconciles it — which also covers the case where
 * the entitlement write itself failed.
 *
 * ## Why `systemDb`
 *
 * This is the sanctioned "cron sweep that legitimately spans tenants" case from
 * ARCHITECTURE.md §2. Candidate *discovery* is unavoidably cross-tenant; every
 * mutation that follows is performed through `tenantDb` for the specific tenant
 * that owns the row.
 */

import { normalizePlanId, type BillingCycle } from '@/lib/billing/plans';

import { getLogger, systemDb, tenantDb } from '../kernel';
import { SubscriptionRepository } from '../repositories/billing.repository';
import { BillingService } from './billing.service';

const log = getLogger('billing.sweep');

/**
 * Per-run ceiling on each job. A sweep that tried to process an unbounded
 * backlog in one request would hit the HTTP timeout and accomplish nothing;
 * capping means the next scheduled run picks up where this one stopped.
 */
const BATCH_LIMIT = 500;

export interface BillingSweepResult {
  ordersExpired: number;
  subscriptionsExpired: number;
  accountsLocked: number;
}

export class BillingSweepService {
  static create(): BillingSweepService {
    return new BillingSweepService();
  }

  async run(now: Date = new Date()): Promise<BillingSweepResult> {
    const ordersExpired = await this.expireAbandonedOrders(now);
    const { subscriptionsExpired, accountsLocked } = await this.expireLapsedSubscriptions(now);
    await this.reconcileSettledOrders(now);

    log.info('billing sweep finished', { ordersExpired, subscriptionsExpired, accountsLocked });
    return { ordersExpired, subscriptionsExpired, accountsLocked };
  }

  /**
   * Closes checkout sessions that were never completed.
   *
   * A single cross-tenant `updateMany` rather than a per-tenant loop: this only
   * changes a status column on rows already identified by their own expiry, so
   * there is no tenant-specific logic to get wrong and no benefit to fanning out.
   */
  private async expireAbandonedOrders(now: Date): Promise<number> {
    const stale = await systemDb.paymentOrder.findMany({
      where: { status: 'pending', expiresAt: { lte: now } },
      select: { id: true },
      take: BATCH_LIMIT,
    });
    if (stale.length === 0) return 0;

    const result = await systemDb.paymentOrder.updateMany({
      where: { id: { in: stale.map((order) => order.id) }, status: 'pending' },
      data: {
        status: 'expired',
        failureReason: 'The checkout session expired before payment was completed.',
      },
    });

    return result.count;
  }

  /**
   * Expires subscriptions whose paid period has elapsed and locks their accounts.
   *
   * `expired` and `canceled` are kept distinct because they mean different
   * things to the customer and to reporting: `canceled` is a subscriber who
   * chose to leave, `expired` is one whose renewal did not happen. Both revoke
   * access identically.
   */
  private async expireLapsedSubscriptions(
    now: Date,
  ): Promise<{ subscriptionsExpired: number; accountsLocked: number }> {
    const lapsed = await systemDb.subscription.findMany({
      where: { status: 'active', currentPeriodEnd: { lte: now } },
      select: { id: true, tenantId: true, cancelAtPeriodEnd: true },
      take: BATCH_LIMIT,
    });

    let subscriptionsExpired = 0;
    let accountsLocked = 0;

    for (const subscription of lapsed) {
      try {
        const updated = await systemDb.subscription.updateMany({
          // Re-asserting `status: 'active'` makes the transition idempotent
          // against two overlapping sweep runs.
          where: { id: subscription.id, status: 'active' },
          data: { status: subscription.cancelAtPeriodEnd ? 'canceled' : 'expired' },
        });
        if (updated.count === 0) continue;

        subscriptionsExpired += 1;

        const service = BillingService.create(tenantDb(subscription.tenantId), subscription.tenantId);
        accountsLocked += await service.revokeAccess();

        await this.recordSweepEvent({
          tenantId: subscription.tenantId,
          eventType: 'subscription.expired',
          dedupeKey: `sweep:expire:${subscription.id}:${now.toISOString().slice(0, 13)}`,
          payload: { reason: subscription.cancelAtPeriodEnd ? 'canceled_at_period_end' : 'period_elapsed' },
        });
      } catch (error) {
        // One tenant's failure must not abort the batch — the remaining lapsed
        // subscriptions would keep their access indefinitely.
        log.error('could not expire a subscription', { tenantId: subscription.tenantId, err: error });
      }
    }

    return { subscriptionsExpired, accountsLocked };
  }

  /**
   * Finds paid orders whose entitlement was never fully applied, and applies it.
   *
   * ## Why this checks two things, not one
   *
   * Settlement writes in four steps: claim the event, mark the order paid,
   * advance the subscription, project onto `User`/`Tenant`. The projection is
   * last, is the only cross-database write, and therefore the most likely to
   * fail. And because the dedupe key is claimed first, a failure after that
   * point makes every provider retry a no-op — retries cannot heal a partial
   * settlement, only this sweep can.
   *
   * An earlier version tested only whether `Subscription.currentPeriodEnd` had
   * advanced. That is precisely the wrong test: a failed projection leaves the
   * subscription completely correct and the access columns untouched, so the
   * check passed and the sweep skipped the one case it was written for. The
   * customer's card was charged, `Subscription` read `active`, and login still
   * answered "choose a plan to activate your workspace" — inviting them to pay
   * twice.
   *
   * So both halves are verified: the subscription must have advanced **and** the
   * tenant's members must actually hold the access it implies.
   *
   * Only recent orders are considered. Re-granting from a months-old payment
   * would resurrect a long-lapsed account.
   */
  private async reconcileSettledOrders(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const candidates = await systemDb.paymentOrder.findMany({
      where: { status: 'paid', paidAt: { gte: cutoff, lte: now } },
      select: {
        id: true,
        tenantId: true,
        reference: true,
        planId: true,
        billingCycle: true,
        currency: true,
        paidAt: true,
        periodEnd: true,
        setupFeeMinor: true,
        subscription: { select: { currentPeriodEnd: true, status: true } },
      },
      take: BATCH_LIMIT,
    });

    for (const order of candidates) {
      const orderPeriodEnd = order.periodEnd;
      const paidAt = order.paidAt;
      if (!orderPeriodEnd || !paidAt) continue;

      const recorded = order.subscription?.currentPeriodEnd;
      const subscriptionApplied =
        order.subscription?.status === 'active' &&
        recorded !== null &&
        recorded !== undefined &&
        recorded.getTime() >= orderPeriodEnd.getTime();

      // The projection is checked independently, because it is the write that
      // fails while leaving the subscription looking perfect.
      const projectionApplied = subscriptionApplied
        ? await this.isEntitlementProjected(order.tenantId, orderPeriodEnd)
        : false;

      if (subscriptionApplied && projectionApplied) continue;

      const planId = normalizePlanId(order.planId);
      if (!planId) {
        log.warn('cannot reconcile an order with an unknown plan', {
          reference: order.reference,
          planId: order.planId,
        });
        continue;
      }

      try {
        const billingCycle: BillingCycle = order.billingCycle === 'annual' ? 'annual' : 'monthly';
        const db = tenantDb(order.tenantId);
        const subscriptions = new SubscriptionRepository(db);

        await subscriptions.ensure({ planId, billingCycle, currency: order.currency });

        // The period is taken from what the order *recorded at settlement*, not
        // recomputed from "now". Recomputing would quietly extend the
        // subscription past what the payment actually bought every time
        // reconciliation ran.
        await subscriptions.applyPayment({
          planId,
          billingCycle,
          currency: order.currency,
          periodStart: paidAt,
          periodEnd: orderPeriodEnd,
          paidAt,
          setupFeePaidPlanId: order.setupFeeMinor > 0 ? planId : null,
        });

        const service = BillingService.create(db, order.tenantId);
        await service.reapplyEntitlement({ periodEnd: orderPeriodEnd, planId });

        log.warn('reconciled a settled order whose entitlement was incomplete', {
          reference: order.reference,
          tenantId: order.tenantId,
          periodEnd: orderPeriodEnd.toISOString(),
          subscriptionApplied,
          projectionApplied,
        });

        await this.recordSweepEvent({
          tenantId: order.tenantId,
          orderId: order.id,
          eventType: 'subscription.reconciled',
          dedupeKey: `sweep:reconcile:${order.id}:${orderPeriodEnd.toISOString()}`,
          payload: { reference: order.reference, periodEnd: orderPeriodEnd.toISOString() },
        });
      } catch (error) {
        log.error('could not reconcile a settled order', { reference: order.reference, err: error });
      }
    }
  }

  /**
   * Has the paid period actually reached the columns that gate access?
   *
   * The test is `Tenant.isActive` plus every non-operator member carrying a
   * `subscriptionExpiresAt` at or beyond the period the order bought.
   *
   * Deliberately does **not** test `isVerified`, even though that is the column
   * access actually turns on. Two reasons, and the second is the important one:
   *
   *  - `isVerified` and `subscriptionExpiresAt` are written in the same
   *    `$transaction`, so the expiry landing is sufficient evidence that the
   *    whole projection ran. Nothing is lost.
   *  - An operator-suspended member legitimately has `isVerified: false` with an
   *    unexpired period. Including it would mark that tenant's projection
   *    permanently incomplete, so the sweep would re-apply and log a warning
   *    every hour, forever, for an account that is in exactly the state the
   *    operator intended.
   *
   * Operators are excluded for the same reason `grantAccess` excludes them: their
   * access never depends on billing, so their row says nothing about whether the
   * projection ran.
   */
  private async isEntitlementProjected(tenantId: string, periodEnd: Date): Promise<boolean> {
    const tenant = await systemDb.tenant.findUnique({
      where: { id: tenantId },
      select: { isActive: true },
    });
    if (!tenant?.isActive) return false;

    const profiles = await systemDb.profile.findMany({
      where: { tenantId },
      select: { userId: true },
    });
    const memberIds = profiles.map((profile) => profile.userId);
    if (memberIds.length === 0) return true;

    const unprojected = await systemDb.user.count({
      where: {
        id: { in: memberIds },
        role: { not: 'super_admin' },
        OR: [{ subscriptionExpiresAt: null }, { subscriptionExpiresAt: { lt: periodEnd } }],
      },
    });

    return unprojected === 0;
  }

  /**
   * Writes an audit row for a sweep action.
   *
   * Best-effort: the sweep's real work has already happened, and a duplicate
   * dedupe key (two runs in the same hour) is the expected way this returns
   * false. A failure here is logged and swallowed rather than allowed to mask a
   * successful expiry.
   */
  private async recordSweepEvent(input: {
    tenantId: string;
    orderId?: string;
    eventType: string;
    dedupeKey: string;
    payload: unknown;
  }): Promise<void> {
    try {
      await systemDb.paymentEvent.create({
        data: {
          tenantId: input.tenantId,
          orderId: input.orderId ?? null,
          source: 'cron',
          eventType: input.eventType,
          dedupeKey: input.dedupeKey.slice(0, 191),
          payload: JSON.parse(JSON.stringify(input.payload)),
        },
        select: { id: true },
      });
    } catch {
      // Duplicate key or a transient write failure. Neither changes the outcome.
    }
  }
}
