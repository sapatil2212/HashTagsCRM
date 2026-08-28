/**
 * Billing wire contracts.
 *
 * Amounts cross the wire as integer minor units with an explicit `currency`,
 * never as a pre-formatted string and never as a float. The browser formats
 * them with `formatAmount` from `@/lib/billing/plans`, so the pricing page, the
 * settings panel and a receipt cannot disagree about how `$19` is written.
 *
 * Nothing here exposes a gateway credential, a signature, or a raw provider
 * payload. `PaymentEvent.payload` in particular is never returned to a browser:
 * it exists for operators reading the database, and the DTO layer is the
 * allowlist that keeps it there.
 */

import { z } from 'zod';

import {
  BILLING_CYCLES,
  PLAN_IDS,
  getPlan,
  normalizePlanId,
  type PlanId,
} from '@/lib/billing/plans';

import { isoDateSchema, toIso, toIsoOrNull } from './common.dto';

const planIdSchema = z.enum(PLAN_IDS);
const billingCycleSchema = z.enum(BILLING_CYCLES);

// ── quote ───────────────────────────────────────────────────────────

export const quoteLineItemDtoSchema = z.object({
  kind: z.enum(['plan', 'setup_fee']),
  label: z.string(),
  amountMinor: z.number().int().nonnegative(),
});

export const quoteDtoSchema = z.object({
  planId: planIdSchema,
  billingCycle: billingCycleSchema,
  currency: z.string(),
  planAmountMinor: z.number().int().nonnegative(),
  setupFeeMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
  lineItems: z.array(quoteLineItemDtoSchema),
});
export type QuoteDto = z.infer<typeof quoteDtoSchema>;

// ── subscription ────────────────────────────────────────────────────

export const SUBSCRIPTION_STATUSES = ['incomplete', 'active', 'past_due', 'canceled', 'expired'] as const;
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

function narrowSubscriptionStatus(value: string): SubscriptionStatus {
  const parsed = subscriptionStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : 'incomplete';
}

export const subscriptionDtoSchema = z.object({
  /** Null for a tenant that has never subscribed. */
  planId: planIdSchema.nullable(),
  planName: z.string().nullable(),
  billingCycle: billingCycleSchema,
  status: subscriptionStatusSchema,
  currency: z.string(),
  currentPeriodStart: isoDateSchema.nullable(),
  currentPeriodEnd: isoDateSchema.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /**
   * Derived, not stored: `status === 'active'` *and* the period has not
   * elapsed. Computed server-side so the browser never has to reimplement the
   * entitlement rule — and cannot get it wrong on a stale clock.
   */
  isActive: z.boolean(),
  /** Whole days until `currentPeriodEnd`, floored at 0. Null when no period. */
  daysRemaining: z.number().int().nonnegative().nullable(),
  /** Tier whose one-time setup fee has been settled, if any. */
  setupFeePaidPlanId: planIdSchema.nullable(),
  lastPaymentAt: isoDateSchema.nullable(),
});
export type SubscriptionDto = z.infer<typeof subscriptionDtoSchema>;

interface SubscriptionRow {
  planId: string;
  billingCycle: string;
  status: string;
  currency: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  setupFeePaidPlanId: string | null;
  lastPaymentAt: Date | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True when the tenant is entitled to the product right now.
 *
 * Both halves are required. `status` alone is not enough — the sweep that flips
 * a lapsed subscription to `expired` runs on a schedule, so between the period
 * ending and the sweep firing the row still reads `active`. Checking the date
 * too means entitlement is correct the instant the period ends, whether or not
 * the cron ran.
 */
export function isSubscriptionActive(row: {
  status: string;
  currentPeriodEnd: Date | null;
}, now: Date = new Date()): boolean {
  if (narrowSubscriptionStatus(row.status) !== 'active') return false;
  if (!row.currentPeriodEnd) return false;
  return row.currentPeriodEnd.getTime() > now.getTime();
}

export function toSubscriptionDto(row: SubscriptionRow, now: Date = new Date()): SubscriptionDto {
  const planId = normalizePlanId(row.planId);
  const cycle = billingCycleSchema.safeParse(row.billingCycle);

  return {
    planId,
    planName: planId ? getPlan(planId).name : null,
    billingCycle: cycle.success ? cycle.data : 'monthly',
    status: narrowSubscriptionStatus(row.status),
    currency: row.currency,
    currentPeriodStart: toIsoOrNull(row.currentPeriodStart),
    currentPeriodEnd: toIsoOrNull(row.currentPeriodEnd),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    isActive: isSubscriptionActive(row, now),
    daysRemaining: row.currentPeriodEnd
      ? Math.max(0, Math.ceil((row.currentPeriodEnd.getTime() - now.getTime()) / MS_PER_DAY))
      : null,
    setupFeePaidPlanId: normalizePlanId(row.setupFeePaidPlanId),
    lastPaymentAt: toIsoOrNull(row.lastPaymentAt),
  };
}

/**
 * The subscription shape for a tenant with no row yet. Returned rather than a
 * 404 so the billing UI has one code path: "not subscribed" is a legitimate
 * state, not an error.
 */
export function emptySubscriptionDto(currency: string, selectedPlan?: string | null): SubscriptionDto {
  return {
    // A plan the user picked at signup but never paid for is shown as a
    // preference, while every field that implies entitlement stays empty.
    planId: normalizePlanId(selectedPlan),
    planName: normalizePlanId(selectedPlan) ? getPlan(normalizePlanId(selectedPlan) as PlanId).name : null,
    billingCycle: 'monthly',
    status: 'incomplete',
    currency,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    isActive: false,
    daysRemaining: null,
    setupFeePaidPlanId: null,
    lastPaymentAt: null,
  };
}

// ── payment order ───────────────────────────────────────────────────

export const PAYMENT_ORDER_STATUSES = ['pending', 'paid', 'failed', 'canceled', 'expired'] as const;
export const paymentOrderStatusSchema = z.enum(PAYMENT_ORDER_STATUSES);
export type PaymentOrderStatus = z.infer<typeof paymentOrderStatusSchema>;

function narrowOrderStatus(value: string): PaymentOrderStatus {
  const parsed = paymentOrderStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : 'pending';
}

export const paymentOrderDtoSchema = z.object({
  reference: z.string(),
  planId: planIdSchema.nullable(),
  planName: z.string().nullable(),
  billingCycle: billingCycleSchema,
  status: paymentOrderStatusSchema,
  currency: z.string(),
  planAmountMinor: z.number().int().nonnegative(),
  setupFeeMinor: z.number().int().nonnegative(),
  amountMinor: z.number().int().nonnegative(),
  lineItems: z.array(quoteLineItemDtoSchema),
  /**
   * Safepay's transaction reference. Surfaced because it is what a customer
   * quotes to support and what an operator searches for in Safepay's dashboard.
   */
  referenceCode: z.string().nullable(),
  paidAt: isoDateSchema.nullable(),
  periodStart: isoDateSchema.nullable(),
  periodEnd: isoDateSchema.nullable(),
  /** Present only for failures, and only ever a message we authored. */
  failureReason: z.string().nullable(),
  createdAt: isoDateSchema,
});
export type PaymentOrderDto = z.infer<typeof paymentOrderDtoSchema>;

interface PaymentOrderRow {
  reference: string;
  planId: string;
  billingCycle: string;
  status: string;
  currency: string;
  planAmountMinor: number;
  setupFeeMinor: number;
  amountMinor: number;
  lineItems: unknown;
  referenceCode: string | null;
  paidAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  failureReason: string | null;
  createdAt: Date;
}

/**
 * Re-parses the frozen line items.
 *
 * Stored as JSON at checkout time so a later catalogue price change cannot
 * rewrite an issued receipt. Validated on read rather than trusted: a row
 * written by an older release might not match the current shape, and a receipt
 * that renders `undefined` is worse than one that falls back to the totals.
 */
function readLineItems(row: PaymentOrderRow): QuoteDto['lineItems'] {
  const parsed = z.array(quoteLineItemDtoSchema).safeParse(row.lineItems);
  if (parsed.success && parsed.data.length > 0) return parsed.data;

  const planId = normalizePlanId(row.planId);
  const fallback: QuoteDto['lineItems'] = [
    {
      kind: 'plan',
      label: `${planId ? getPlan(planId).name : 'Subscription'} plan`,
      amountMinor: row.planAmountMinor,
    },
  ];
  if (row.setupFeeMinor > 0) {
    fallback.push({ kind: 'setup_fee', label: 'Onboarding (one-time)', amountMinor: row.setupFeeMinor });
  }
  return fallback;
}

export function toPaymentOrderDto(row: PaymentOrderRow): PaymentOrderDto {
  const planId = normalizePlanId(row.planId);
  const cycle = billingCycleSchema.safeParse(row.billingCycle);

  return {
    reference: row.reference,
    planId,
    planName: planId ? getPlan(planId).name : null,
    billingCycle: cycle.success ? cycle.data : 'monthly',
    status: narrowOrderStatus(row.status),
    currency: row.currency,
    planAmountMinor: row.planAmountMinor,
    setupFeeMinor: row.setupFeeMinor,
    amountMinor: row.amountMinor,
    lineItems: readLineItems(row),
    referenceCode: row.referenceCode,
    paidAt: toIsoOrNull(row.paidAt),
    periodStart: toIsoOrNull(row.periodStart),
    periodEnd: toIsoOrNull(row.periodEnd),
    failureReason: row.failureReason,
    createdAt: toIso(row.createdAt),
  };
}

// ── checkout session ────────────────────────────────────────────────

export const checkoutSessionDtoSchema = z.object({
  /** Our order reference. Also what Safepay echoes back. */
  reference: z.string(),
  /**
   * Absolute Safepay-hosted checkout URL. The browser must navigate here; the
   * page is not embeddable and card entry never touches this application.
   */
  checkoutUrl: z.string(),
  quote: quoteDtoSchema,
  /** After this the order is swept to `expired` and the URL stops working. */
  expiresAt: isoDateSchema,
  /** `sandbox` or `production`, so the UI can show an unmistakable test banner. */
  environment: z.enum(['sandbox', 'production']),
});
export type CheckoutSessionDto = z.infer<typeof checkoutSessionDtoSchema>;

// ── settlement result (used by the callback) ─────────────────────────

export const settlementDtoSchema = z.object({
  reference: z.string(),
  status: paymentOrderStatusSchema,
  /** True when this call is what transitioned the order to paid. */
  activated: z.boolean(),
  subscription: subscriptionDtoSchema.nullable(),
});
export type SettlementDto = z.infer<typeof settlementDtoSchema>;

// ── operator diagnostics ────────────────────────────────────────────

/**
 * Gateway configuration report for operators.
 *
 * Reports which credentials are *present*, never their values — the whole point
 * is to be safe to open in a browser and paste into a support thread. The URLs
 * are computed by the same functions checkout uses, so this cannot drift from
 * what the integration actually does: if this page says the webhook URL is X,
 * then X is what Safepay was told.
 */
export const billingDiagnosticsDtoSchema = z.object({
  configured: z.boolean(),
  environment: z.enum(['sandbox', 'production']).nullable(),
  credentials: z.object({
    apiKey: z.boolean(),
    secretKey: z.boolean(),
    /** False means the webhook falls back to the secret key. */
    dedicatedWebhookSecret: z.boolean(),
    cronSecret: z.boolean(),
  }),
  siteOrigin: z.string().nullable(),
  /** The exact values to paste into the Safepay dashboard and your scheduler. */
  endpoints: z.object({
    webhook: z.string().nullable(),
    redirect: z.string().nullable(),
    cancel: z.string().nullable(),
    cron: z.string().nullable(),
    trackerApi: z.string().nullable(),
    checkout: z.string().nullable(),
  }),
  /** Blocking problems — payments will not work until these are resolved. */
  errors: z.array(z.string()),
  /** Non-blocking, but you should know. */
  warnings: z.array(z.string()),
  currency: z.string(),
  plans: z.array(
    z.object({
      id: planIdSchema,
      name: z.string(),
      monthlyMinor: z.number().int().nonnegative(),
      annualMinor: z.number().int().nonnegative(),
      setupFeeMinor: z.number().int().nonnegative(),
    }),
  ),
});
export type BillingDiagnosticsDto = z.infer<typeof billingDiagnosticsDtoSchema>;

// ── cron sweep ──────────────────────────────────────────────────────

export const billingSweepDtoSchema = z.object({
  /** Unsettled checkout sessions aged out. */
  ordersExpired: z.number().int().nonnegative(),
  /** Subscriptions whose paid period elapsed. */
  subscriptionsExpired: z.number().int().nonnegative(),
  /** Accounts locked as a result (sessions revoked). */
  accountsLocked: z.number().int().nonnegative(),
});
export type BillingSweepDto = z.infer<typeof billingSweepDtoSchema>;
