"use client";

/**
 * The plan picker.
 *
 * One component, three consumers — the signup wizard, `/billing`, and the
 * Settings → Billing panel. Prices used to be hardcoded separately in each of
 * those places (and disagreed with each other); this reads the catalogue in
 * `@/lib/billing/plans`, which is the only place a price is written down.
 *
 * The catalogue is plain data and pure functions, so importing it into a client
 * component costs a couple of hundred bytes and removes a round trip: there is
 * no loading state here, and no way for the displayed price to differ from the
 * one the server charges.
 */

import { Check, Crown, TrendingUp, Zap, type LucideIcon } from "lucide-react";

import {
  PLAN_LIST,
  annualSavingMinor,
  cycleSuffix,
  formatAmount,
  normalizePlanId,
  type BillingCycle,
  type Plan,
  type PlanId,
} from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

const ICONS: Record<Plan["icon"], LucideIcon> = {
  zap: Zap,
  "trending-up": TrendingUp,
  crown: Crown,
};

/**
 * Accent classes are written out per plan rather than interpolated.
 * `border-${accent}-500` would be invisible to Tailwind's class scanner and get
 * stripped from the production build — a mistake that only shows up after
 * deploying.
 */
const ACCENTS: Record<
  Plan["accent"],
  { text: string; border: string; bg: string; ring: string; button: string }
> = {
  orange: {
    text: "text-orange-400",
    border: "border-orange-500/60",
    bg: "bg-orange-500/10",
    ring: "ring-orange-500/20",
    button: "bg-orange-500 hover:bg-orange-400",
  },
  violet: {
    text: "text-violet-400",
    border: "border-violet-500/60",
    bg: "bg-violet-500/10",
    ring: "ring-violet-500/20",
    button: "bg-violet-500 hover:bg-violet-400",
  },
  amber: {
    text: "text-amber-400",
    border: "border-amber-500/60",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/20",
    button: "bg-amber-500 hover:bg-amber-400",
  },
};

export interface BillingCycleToggleProps {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  disabled?: boolean;
}

/** Monthly / annual switch, with the annual saving stated rather than implied. */
export function BillingCycleToggle({ value, onChange, disabled }: BillingCycleToggleProps) {
  // Every plan is priced at ten months for a year, so the headline is the same
  // for all three. Derived from the catalogue so a pricing change updates the
  // copy instead of leaving it stale.
  const savingMonths = Math.round(
    annualSavingMinor("growth") / PLAN_LIST.find((plan) => plan.id === "growth")!.pricing.monthly.priceMinor,
  );

  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="inline-flex items-center gap-1 rounded-xl border border-[var(--m-border-glass)] bg-[var(--m-bg-secondary)]/60 p-1 backdrop-blur"
    >
      {(["monthly", "annual"] as const).map((cycle) => (
        <button
          key={cycle}
          type="button"
          role="radio"
          aria-checked={value === cycle}
          disabled={disabled}
          onClick={() => onChange(cycle)}
          className={cn(
            "cursor-pointer rounded-lg px-3.5 py-1.5 text-[11px] font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60",
            value === cycle
              ? "bg-orange-500 text-white shadow-sm shadow-orange-500/20"
              : "text-[var(--m-text-tertiary)] hover:text-[var(--m-text-primary)]",
          )}
        >
          {cycle === "monthly" ? "Monthly" : "Annual"}
          {cycle === "annual" && savingMonths > 0 && (
            <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide opacity-80">
              save {savingMonths} months
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export interface PlanCardsProps {
  billingCycle: BillingCycle;
  selectedPlanId: PlanId | null;
  onSelect: (planId: PlanId) => void;
  /** The tenant's active plan, badged as "Current plan". */
  currentPlanId?: string | null;
  /**
   * Tier whose one-time setup fee is already settled. Its card then shows the
   * fee as paid rather than as an amount about to be charged — the difference
   * between a $39 renewal and a $78 one.
   */
  setupFeePaidPlanId?: string | null;
  disabled?: boolean;
}

export function PlanCards({
  billingCycle,
  selectedPlanId,
  onSelect,
  currentPlanId,
  setupFeePaidPlanId,
  disabled,
}: PlanCardsProps) {
  const current = normalizePlanId(currentPlanId);
  const feePaidFor = normalizePlanId(setupFeePaidPlanId);

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {PLAN_LIST.map((plan) => {
        const Icon = ICONS[plan.icon];
        const accent = ACCENTS[plan.accent];
        const selected = selectedPlanId === plan.id;
        const isCurrent = current === plan.id;
        const setupFeeDue = plan.setupFeeMinor > 0 && feePaidFor !== plan.id;
        const price = plan.pricing[billingCycle];

        return (
          <button
            key={plan.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onSelect(plan.id)}
            className={cn(
              "relative flex cursor-pointer flex-col gap-3 rounded-2xl border p-4 text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? cn(accent.border, accent.bg, "ring-2", accent.ring)
                : "border-[var(--m-border-glass)] bg-[var(--m-bg-secondary)]/40 hover:border-[var(--m-border-glass)]/80",
            )}
          >
            {plan.recommended && !isCurrent && (
              <span className="absolute -top-2 right-3 rounded-full bg-violet-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                Recommended
              </span>
            )}
            {isCurrent && (
              <span className="absolute -top-2 right-3 rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                Current plan
              </span>
            )}

            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-xl border border-[var(--m-border-glass)]",
                  accent.bg,
                )}
              >
                <Icon className={cn("size-4", accent.text)} aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-bold text-[var(--m-text-heading)]">{plan.name}</span>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--m-text-muted)]">
                  {plan.positioning}
                </span>
              </span>
            </div>

            <div>
              <span className="text-2xl font-bold tracking-tight text-[var(--m-text-heading)]">
                {formatAmount(price.priceMinor)}
              </span>
              <span className="text-[11px] font-semibold text-[var(--m-text-tertiary)]">
                {cycleSuffix(billingCycle)}
              </span>
              {billingCycle === "annual" && annualSavingMinor(plan.id) > 0 && (
                <span className="ml-1.5 text-[10px] font-semibold text-emerald-400">
                  save {formatAmount(annualSavingMinor(plan.id))}
                </span>
              )}
            </div>

            <p className="text-[11px] leading-relaxed text-[var(--m-text-tertiary)]">{plan.coreMessage}</p>

            <p className="text-[10px] font-semibold">
              {plan.setupFeeMinor === 0 ? (
                <span className="text-emerald-400">Setup included</span>
              ) : setupFeeDue ? (
                <span className="text-[var(--m-text-secondary)]">
                  + {formatAmount(plan.setupFeeMinor)} one-time setup
                </span>
              ) : (
                <span className="text-emerald-400">Setup fee already paid</span>
              )}
            </p>

            <ul className="flex flex-col gap-1.5 border-t border-[var(--m-border-glass)]/60 pt-3">
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--m-text-secondary)]"
                >
                  <Check className={cn("mt-0.5 size-3 shrink-0", accent.text)} aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>
  );
}
