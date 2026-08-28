/**
 * The plan catalogue — the single source of truth for what we sell.
 *
 * Before this module the same three tiers were declared four times with four
 * different vocabularies and three different price lists: the signup wizard's
 * local `PLANS`, the marketing pricing page's inline `plans` + feature matrix,
 * `profile-form.tsx`'s `planLabels`, and `Tenant.plan`'s
 * `free | starter | pro | enterprise` comment. A payment gateway cannot be
 * built on that: whatever the gateway charges has to agree, to the cent, with
 * what the pricing page promised and with what the entitlement check reads
 * back. So every one of those call sites now resolves through here.
 *
 * ## Money
 *
 * Prices are integers in the currency's **minor unit** (US cents). No floats,
 * anywhere, ever: `0.1 + 0.2 !== 0.3`, and a half-cent rounding error in a
 * subscription total is a support ticket at best and a chargeback at worst.
 * The only place a major-unit decimal appears is the Safepay request body,
 * which demands one — see `toMajorUnits`.
 *
 * The catalogue is denominated in USD because that is how the plans are
 * publicly quoted. Safepay settles Pakistani accounts in PKR and performs the
 * conversion itself (its tracker response carries `default_currency` and
 * `conversion_rate`), so we quote and charge USD and let the processor convert.
 * Do not "translate" these numbers to PKR here — that would silently detach
 * our ledger from the published price.
 *
 * ## Setup fees
 *
 * Growth and Managed carry a one-time onboarding fee. It is charged on the
 * first order for that tier and not on renewals; moving between tiers charges
 * the new tier's fee, because Guided Setup and Done-for-You are genuinely
 * different pieces of work. `Subscription.setupFeePaidPlanId` records which
 * tier's fee has been settled, and `resolveSetupFeeMinor` is the one function
 * that decides.
 */

/** Canonical plan identifiers. Persisted, so treat as an append-only list. */
export const PLAN_IDS = ['essential', 'growth', 'managed'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/**
 * ISO-4217 code the catalogue is denominated in. A constant rather than a
 * setting: changing it without restating every `priceMinor` below would
 * misprice every plan by the exchange rate.
 */
export const BILLING_CURRENCY = 'USD';

/** Minor units per major unit for `BILLING_CURRENCY`. USD has cents. */
export const MINOR_UNITS_PER_MAJOR = 100;

export interface PlanPricing {
  /** Recurring charge per period, in minor units. */
  priceMinor: number;
  /**
   * Undiscounted equivalent, for showing "save X" on annual. Annual is priced
   * at ten months of the monthly rate, so this is `monthly x 12`.
   */
  listPriceMinor: number;
}

export interface Plan {
  id: PlanId;
  /** Display name. */
  name: string;
  /** How the tier is positioned — the "Positioning" column of the price grid. */
  positioning: string;
  /** One-line pitch — the "Core message" column. */
  coreMessage: string;
  pricing: Record<BillingCycle, PlanPricing>;
  /** One-time onboarding charge in minor units. Zero means none. */
  setupFeeMinor: number;
  /** Bullet list for the pricing cards. */
  features: readonly string[];
  /**
   * Icon name resolved by the UI. A string, not a component, so this module
   * stays importable from services and the webhook — neither of which can
   * pull in `lucide-react`.
   */
  icon: 'zap' | 'trending-up' | 'crown';
  /** Tailwind accent used by the pricing cards. */
  accent: 'orange' | 'violet' | 'amber';
  /** Highlighted as the default recommendation. Exactly one plan may set this. */
  recommended: boolean;
}

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  essential: {
    id: 'essential',
    name: 'Essential',
    positioning: 'Self-Service',
    coreMessage: 'For businesses ready to bring WhatsApp into their workflow.',
    pricing: {
      monthly: { priceMinor: 1_900, listPriceMinor: 1_900 },
      annual: { priceMinor: 19_000, listPriceMinor: 22_800 },
    },
    setupFeeMinor: 0,
    features: [
      'Official WhatsApp Business API',
      'Visual flow & chatbot builder',
      'Shared collaborative inbox',
      'Contacts, tags and sales pipelines',
      '0% markup on Meta conversation fees',
    ],
    icon: 'zap',
    accent: 'orange',
    recommended: false,
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    positioning: 'Guided Setup',
    coreMessage: 'For businesses ready to automate and grow.',
    pricing: {
      monthly: { priceMinor: 3_900, listPriceMinor: 3_900 },
      annual: { priceMinor: 39_000, listPriceMinor: 46_800 },
    },
    setupFeeMinor: 3_900,
    features: [
      'Everything in Essential',
      'Meta business verification assistance',
      'WhatsApp co-existence configuration',
      'Broadcast campaigns & template approval help',
      'Dedicated account setup session',
    ],
    icon: 'trending-up',
    accent: 'violet',
    recommended: true,
  },
  managed: {
    id: 'managed',
    name: 'Managed',
    positioning: 'Done-for-You',
    coreMessage: 'For businesses that want Hashtags Technology to do the heavy lifting.',
    pricing: {
      monthly: { priceMinor: 9_900, listPriceMinor: 9_900 },
      annual: { priceMinor: 99_000, listPriceMinor: 118_800 },
    },
    setupFeeMinor: 9_900,
    features: [
      'Everything in Growth',
      '2–3 custom automations built for you',
      'Message templates written & submitted',
      'Dedicated account manager',
      'Monthly 1-on-1 strategy calls',
    ],
    icon: 'crown',
    accent: 'amber',
    recommended: false,
  },
};

/** Catalogue as an array, in display order. */
export const PLAN_LIST: readonly Plan[] = PLAN_IDS.map((id) => PLANS[id]);

/** The tier a brand-new signup lands on if it never chooses. */
export const DEFAULT_PLAN_ID: PlanId = 'growth';

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === 'string' && (BILLING_CYCLES as readonly string[]).includes(value);
}

/**
 * Plan ids written by earlier versions of the app, mapped onto the current
 * catalogue.
 *
 * `User.selectedPlan` and `Tenant.plan` are free-text columns that have
 * accumulated four vocabularies: the signup wizard wrote
 * `starter | growth | managed`, `profile-form` rendered `professional`,
 * `Tenant.plan` defaulted to `free` and documented `pro | enterprise`. Rather
 * than a data migration that guesses at intent, existing rows are translated
 * on read. `free` is deliberately absent — it means "never subscribed", which
 * `normalizePlanId` reports as `null` rather than inventing a paid tier.
 */
const LEGACY_PLAN_IDS: Readonly<Record<string, PlanId>> = {
  starter: 'essential',
  basic: 'essential',
  professional: 'growth',
  pro: 'growth',
  enterprise: 'managed',
};

/**
 * Best-effort resolution of any stored plan string to a catalogue id.
 * Returns `null` for "no plan" (`free`, empty, unrecognised) so callers must
 * decide explicitly what an unsubscribed account should see.
 */
export function normalizePlanId(value: string | null | undefined): PlanId | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  if (isPlanId(key)) return key;
  return LEGACY_PLAN_IDS[key] ?? null;
}

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

/** Recurring charge for one period of `cycle`, in minor units. */
export function getPlanPriceMinor(id: PlanId, cycle: BillingCycle): number {
  return PLANS[id].pricing[cycle].priceMinor;
}

/**
 * The one-time setup fee owed for moving to `planId`.
 *
 * `setupFeePaidPlanId` is the tier whose fee has already been settled. Equal
 * tiers owe nothing (this is what makes renewals cheap); anything else owes
 * the target tier's fee in full. Deliberately never prorated or refunded —
 * the fee buys human onboarding work, which is not divisible.
 */
export function resolveSetupFeeMinor(planId: PlanId, setupFeePaidPlanId: string | null | undefined): number {
  const plan = PLANS[planId];
  if (plan.setupFeeMinor === 0) return 0;
  return normalizePlanId(setupFeePaidPlanId) === planId ? 0 : plan.setupFeeMinor;
}

export interface QuoteLineItem {
  /** Stable machine key: `plan` or `setup_fee`. */
  kind: 'plan' | 'setup_fee';
  /** Human-readable label, safe to render on an invoice. */
  label: string;
  amountMinor: number;
}

export interface Quote {
  planId: PlanId;
  billingCycle: BillingCycle;
  currency: string;
  planAmountMinor: number;
  setupFeeMinor: number;
  /** `planAmountMinor + setupFeeMinor`. What we actually charge. */
  totalMinor: number;
  lineItems: QuoteLineItem[];
}

/**
 * Prices an order. This is the *only* place a chargeable total is computed;
 * the checkout endpoint, the receipt, and the settlement amount check all read
 * the same function, so the three can never disagree.
 */
export function quote(input: {
  planId: PlanId;
  billingCycle: BillingCycle;
  setupFeePaidPlanId?: string | null;
}): Quote {
  const plan = PLANS[input.planId];
  const planAmountMinor = getPlanPriceMinor(input.planId, input.billingCycle);
  const setupFeeMinor = resolveSetupFeeMinor(input.planId, input.setupFeePaidPlanId);

  const lineItems: QuoteLineItem[] = [
    {
      kind: 'plan',
      label: `${plan.name} plan — ${input.billingCycle === 'annual' ? '12 months' : '1 month'}`,
      amountMinor: planAmountMinor,
    },
  ];
  if (setupFeeMinor > 0) {
    lineItems.push({
      kind: 'setup_fee',
      label: `${plan.name} onboarding (one-time)`,
      amountMinor: setupFeeMinor,
    });
  }

  return {
    planId: input.planId,
    billingCycle: input.billingCycle,
    currency: BILLING_CURRENCY,
    planAmountMinor,
    setupFeeMinor,
    totalMinor: planAmountMinor + setupFeeMinor,
    lineItems,
  };
}

// ── period arithmetic ───────────────────────────────────────────────

/**
 * Advances a date by one billing period, clamping to the end of the target
 * month.
 *
 * `Date.setMonth` rolls over: 31 January plus one month is 3 March, which
 * would silently hand a subscriber two extra days every year and shift their
 * renewal date permanently. Clamping instead maps it to 28 February (29 in a
 * leap year), which is what every billing system does and what a customer
 * expects.
 *
 * All arithmetic is in UTC. The codebase has already been bitten once by
 * local-zone date construction (see `dateOnlyInputSchema`), and a renewal
 * boundary that moves with the server's timezone is the same bug with money
 * attached.
 */
export function addBillingPeriod(from: Date, cycle: BillingCycle): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();

  const targetYear = cycle === 'annual' ? year + 1 : month === 11 ? year + 1 : year;
  const targetMonth = cycle === 'annual' ? month : (month + 1) % 12;

  // Day 0 of the following month is the last day of the target month.
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(day, daysInTargetMonth),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

/**
 * The period a payment buys.
 *
 * Renewals extend from the current period end, not from "now", so a subscriber
 * who pays early is not penalised by losing the remaining days. An expired or
 * absent period starts fresh at `paidAt`.
 */
export function resolveBillingPeriod(input: {
  paidAt: Date;
  cycle: BillingCycle;
  currentPeriodEnd?: Date | null;
}): { start: Date; end: Date } {
  const extendFrom =
    input.currentPeriodEnd && input.currentPeriodEnd.getTime() > input.paidAt.getTime()
      ? input.currentPeriodEnd
      : input.paidAt;
  return { start: extendFrom, end: addBillingPeriod(extendFrom, input.cycle) };
}

// ── formatting ──────────────────────────────────────────────────────

/**
 * Minor units to the major-unit decimal the Safepay `/order/v1/init` body
 * expects. Rounded because the API takes a float and we refuse to hand it
 * anything with a floating-point tail.
 */
export function toMajorUnits(amountMinor: number): number {
  return Math.round(amountMinor) / MINOR_UNITS_PER_MAJOR;
}

/**
 * Display formatting. Whole amounts render without decimals (`$19`, not
 * `$19.00`) to match the pricing page; anything with cents keeps them.
 */
export function formatAmount(amountMinor: number, currency: string = BILLING_CURRENCY): string {
  const major = toMajorUnits(amountMinor);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

/** `/mo` or `/yr`, for appending to a formatted price. */
export function cycleSuffix(cycle: BillingCycle): string {
  return cycle === 'annual' ? '/yr' : '/mo';
}

/**
 * How much an annual commitment saves against paying monthly, in minor units.
 * Zero when the two are priced the same.
 */
export function annualSavingMinor(id: PlanId): number {
  const { priceMinor, listPriceMinor } = PLANS[id].pricing.annual;
  return Math.max(0, listPriceMinor - priceMinor);
}
