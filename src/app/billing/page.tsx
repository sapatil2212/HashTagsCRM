"use client";

/**
 * The billing page: choose a plan, pay, or renew.
 *
 * Deliberately **not** under `(dashboard)` and deliberately absent from the
 * proxy's `protectedPaths`. It has to be reachable by an account that cannot
 * hold a session — a new signup, or a subscriber whose period lapsed — because
 * `isVerified === false` is exactly what the login route and
 * `rotateRefreshToken` refuse. Those callers arrive holding a short-lived
 * checkout grant cookie instead; see `src/lib/billing/grant.ts`.
 *
 * The page is therefore not "unauthenticated": every endpoint it calls resolves
 * a session *or* a grant and returns 401 when it has neither, which is what the
 * "sign in again" state below reflects.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, CreditCard, Loader2, ShieldCheck } from "lucide-react";

import {
  DEFAULT_PLAN_ID,
  cycleSuffix,
  formatAmount,
  normalizePlanId,
  type BillingCycle,
  type PlanId,
} from "@/lib/billing/plans";
import { BillingCycleToggle, PlanCards } from "@/components/billing/plan-cards";
import { useCheckout } from "@/components/billing/use-checkout";
import { Button } from "@/components/ui/button";
import { InteractiveGrid } from "@/components/marketing/interactive-grid";

interface SubscriptionView {
  planId: string | null;
  planName: string | null;
  billingCycle: BillingCycle;
  status: "incomplete" | "active" | "past_due" | "canceled" | "expired";
  currency: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  isActive: boolean;
  daysRemaining: number | null;
  setupFeePaidPlanId: string | null;
  lastPaymentAt: string | null;
}

interface QuoteView {
  totalMinor: number;
  planAmountMinor: number;
  setupFeeMinor: number;
  currency: string;
  lineItems: { kind: "plan" | "setup_fee"; label: string; amountMinor: number }[];
}

type LoadState = "loading" | "ready" | "unauthenticated" | "error";

function BillingPageInner() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [planId, setPlanId] = useState<PlanId>(DEFAULT_PLAN_ID);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const checkout = useCheckout();

  // Load current entitlement, and pre-select whatever the customer already has
  // or picked at signup — a renewal should not make them re-choose.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/billing/subscription");
        if (response.status === 401) {
          if (!cancelled) setLoadState("unauthenticated");
          return;
        }
        const body = await response.json();
        if (!response.ok || !body.data) {
          if (!cancelled) setLoadState("error");
          return;
        }
        if (cancelled) return;

        const current = body.data as SubscriptionView;
        setSubscription(current);
        setBillingCycle(current.billingCycle);
        setPlanId(normalizePlanId(current.planId) ?? DEFAULT_PLAN_ID);
        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Re-quote on every change of plan or cycle. The setup fee is tenant-specific,
  // so the total cannot be computed client-side without risking showing a figure
  // that differs from what gets charged.
  const loadQuote = useCallback(async (nextPlanId: PlanId, nextCycle: BillingCycle) => {
    setQuoteLoading(true);
    try {
      const params = new URLSearchParams({ planId: nextPlanId, billingCycle: nextCycle });
      const response = await fetch(`/api/billing/quote?${params.toString()}`);
      const body = await response.json();
      if (response.ok && body.data) setQuote(body.data as QuoteView);
      else setQuote(null);
    } catch {
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loadState !== "ready") return;
    void loadQuote(planId, billingCycle);
  }, [loadState, planId, billingCycle, loadQuote]);

  if (loadState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--m-bg-primary)]">
        <Loader2 className="size-6 animate-spin text-orange-500" />
      </div>
    );
  }

  if (loadState === "unauthenticated") {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/10">
            <AlertTriangle className="size-6 text-orange-400" aria-hidden="true" />
          </span>
          <h1 className="text-lg font-bold text-[var(--m-text-heading)]">Your checkout link expired</h1>
          <p className="max-w-sm text-[11px] leading-relaxed text-[var(--m-text-tertiary)]">
            For security, the link that let you pay without signing in is only valid for a short time. Sign in
            again and we will bring you straight back here.
          </p>
          <Link
            href="/login"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-orange-500 px-4 text-[11px] font-bold text-white transition-colors hover:bg-orange-400"
          >
            Sign in to continue
          </Link>
        </div>
      </Shell>
    );
  }

  if (loadState === "error") {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
            <AlertTriangle className="size-6 text-red-400" aria-hidden="true" />
          </span>
          <h1 className="text-lg font-bold text-[var(--m-text-heading)]">We could not load your billing details</h1>
          <p className="max-w-sm text-[11px] text-[var(--m-text-tertiary)]">
            Please refresh the page. If it keeps happening, contact support.
          </p>
        </div>
      </Shell>
    );
  }

  const isRenewal = Boolean(subscription?.lastPaymentAt);

  return (
    <Shell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2 text-center">
          <h1 className="text-xl font-bold tracking-tight text-[var(--m-text-heading)]">
            {isRenewal ? "Renew your workspace" : "Activate your workspace"}
          </h1>
          <p className="mx-auto max-w-md text-[11px] leading-relaxed text-[var(--m-text-tertiary)]">
            {reason === "expired"
              ? "Your subscription has ended. Pick up exactly where you left off — your data is untouched."
              : "Choose the plan that fits, pay securely with Safepay, and your workspace unlocks immediately."}
          </p>
        </header>

        <StatusStrip subscription={subscription} />

        <div className="flex justify-center">
          <BillingCycleToggle
            value={billingCycle}
            onChange={setBillingCycle}
            disabled={checkout.isRedirecting}
          />
        </div>

        <PlanCards
          billingCycle={billingCycle}
          selectedPlanId={planId}
          onSelect={setPlanId}
          currentPlanId={subscription?.isActive ? subscription.planId : null}
          setupFeePaidPlanId={subscription?.setupFeePaidPlanId}
          disabled={checkout.isRedirecting}
        />

        <div className="rounded-2xl border border-[var(--m-border-glass)] bg-[var(--m-bg-secondary)]/50 p-4">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[var(--m-text-muted)]">
            Order summary
          </h2>

          {quoteLoading || !quote ? (
            <div className="flex items-center gap-2 py-3 text-[11px] text-[var(--m-text-tertiary)]">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Calculating…
            </div>
          ) : (
            <dl className="flex flex-col gap-2">
              {quote.lineItems.map((line) => (
                <div key={line.kind} className="flex items-baseline justify-between gap-4">
                  <dt className="text-[11px] text-[var(--m-text-secondary)]">{line.label}</dt>
                  <dd className="text-[11px] font-semibold text-[var(--m-text-primary)]">
                    {formatAmount(line.amountMinor, quote.currency)}
                  </dd>
                </div>
              ))}
              <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-[var(--m-border-glass)]/60 pt-2">
                <dt className="text-[11px] font-bold text-[var(--m-text-heading)]">Due today</dt>
                <dd className="text-base font-bold text-[var(--m-text-heading)]">
                  {formatAmount(quote.totalMinor, quote.currency)}
                </dd>
              </div>
              <p className="text-[10px] leading-relaxed text-[var(--m-text-muted)]">
                Then {formatAmount(quote.planAmountMinor, quote.currency)}
                {cycleSuffix(billingCycle)}. Cancel any time from Settings → Billing.
              </p>
            </dl>
          )}
        </div>

        {checkout.error && (
          <p
            role="alert"
            className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-center text-[11px] leading-relaxed text-red-400"
          >
            {checkout.error}
          </p>
        )}

        <Button
          type="button"
          disabled={checkout.isRedirecting || quoteLoading || !quote}
          onClick={() => void checkout.start({ planId, billingCycle })}
          className="h-10 w-full bg-orange-500 text-[12px] font-bold text-white shadow-md shadow-orange-500/20 hover:bg-orange-400"
        >
          {checkout.isRedirecting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Opening secure checkout…
            </>
          ) : (
            <>
              <CreditCard className="size-4" aria-hidden="true" />
              {quote ? `Pay ${formatAmount(quote.totalMinor, quote.currency)} with Safepay` : "Continue to payment"}
            </>
          )}
        </Button>

        <p className="flex items-center justify-center gap-1.5 text-[10px] text-[var(--m-text-muted)]">
          <ShieldCheck className="size-3" aria-hidden="true" />
          Card details are entered on Safepay and never reach our servers.
        </p>
      </div>
    </Shell>
  );
}

/** Current entitlement, stated plainly. Nothing here is decorative. */
function StatusStrip({ subscription }: { subscription: SubscriptionView | null }) {
  if (!subscription) return null;

  if (subscription.isActive) {
    return (
      <p className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-400">
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {subscription.planName} is active
          {subscription.daysRemaining !== null && <> — {subscription.daysRemaining} days remaining</>}.
          {subscription.cancelAtPeriodEnd && " Auto-renewal is off."} Paying now extends your period rather
          than replacing it.
        </span>
      </p>
    );
  }

  if (subscription.status === "expired" || subscription.status === "canceled") {
    return (
      <p className="flex items-center justify-center gap-2 rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-[11px] text-orange-400">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        Your {subscription.planName ?? "subscription"} has ended. Your data is safe and comes straight back
        when you renew.
      </p>
    );
  }

  return null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-y-auto bg-[var(--m-bg-primary)] px-4 py-12">
      <InteractiveGrid gridSize={40} className="opacity-20" />
      <div className="pointer-events-none absolute left-[20%] top-[20%] size-[50%] rounded-full bg-orange-500/5 blur-[120px]" />

      <Link
        href="/"
        className="absolute left-6 top-6 z-20 inline-flex items-center gap-1.5 rounded-lg border border-[var(--m-border-glass)] bg-[var(--m-bg-secondary)]/60 px-3 py-1.5 text-xs font-semibold text-[var(--m-text-tertiary)] backdrop-blur transition-colors hover:text-[var(--m-text-primary)]"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Back Home
      </Link>

      <div className="z-10 w-full max-w-3xl">{children}</div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--m-bg-primary)]">
          <Loader2 className="size-6 animate-spin text-orange-500" />
        </div>
      }
    >
      <BillingPageInner />
    </Suspense>
  );
}
