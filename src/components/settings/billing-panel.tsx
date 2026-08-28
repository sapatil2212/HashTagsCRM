"use client";

/**
 * Settings → Billing.
 *
 * Three jobs: state the current entitlement precisely, let the customer change
 * or renew a plan, and show the payment history. The history matters more than
 * it looks — before this, the only record of a payment was a WhatsApp message
 * and a screenshot, so a customer asking "what did I pay and when" had no
 * answer available to them.
 *
 * Reads `/api/billing/subscription` and `/api/billing/orders`. Prices come from
 * the catalogue; the order *total* comes from the stored order, because a
 * receipt has to show what was charged at the time, not what the plan costs now.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Loader2,
  RefreshCw,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Subscription {
  planId: string | null;
  planName: string | null;
  billingCycle: BillingCycle;
  status: "incomplete" | "active" | "past_due" | "canceled" | "expired";
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  isActive: boolean;
  daysRemaining: number | null;
  setupFeePaidPlanId: string | null;
  lastPaymentAt: string | null;
}

interface PaymentOrder {
  reference: string;
  planName: string | null;
  billingCycle: BillingCycle;
  status: "pending" | "paid" | "failed" | "canceled" | "expired";
  currency: string;
  amountMinor: number;
  referenceCode: string | null;
  paidAt: string | null;
  periodEnd: string | null;
  failureReason: string | null;
  createdAt: string;
}

const ORDER_STATUS_STYLES: Record<PaymentOrder["status"], { label: string; className: string }> = {
  paid: { label: "Paid", className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  pending: { label: "Awaiting payment", className: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  failed: { label: "Failed", className: "bg-red-500/10 text-red-500 border-red-500/20" },
  canceled: { label: "Cancelled", className: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
  expired: { label: "Expired", className: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function BillingPanel() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingRenewal, setSavingRenewal] = useState(false);

  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [planId, setPlanId] = useState<PlanId>(DEFAULT_PLAN_ID);

  const checkout = useCheckout();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetched together: a subscription without its payment history is half an
      // answer, and two sequential round trips would show the panel twice.
      const [subscriptionResponse, ordersResponse] = await Promise.all([
        fetch("/api/billing/subscription"),
        fetch("/api/billing/orders?pageSize=10"),
      ]);

      const subscriptionBody = await subscriptionResponse.json();
      if (!subscriptionResponse.ok || !subscriptionBody.data) {
        setError(subscriptionBody.message ?? "Could not load your subscription.");
        return;
      }

      const current = subscriptionBody.data as Subscription;
      setSubscription(current);
      setBillingCycle(current.billingCycle);
      setPlanId(normalizePlanId(current.planId) ?? DEFAULT_PLAN_ID);

      if (ordersResponse.ok) {
        const ordersBody = await ordersResponse.json();
        setOrders((ordersBody.data ?? []) as PaymentOrder[]);
      }
    } catch {
      setError("Could not load your billing details.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRenewal = async () => {
    if (!subscription) return;
    setSavingRenewal(true);
    try {
      const response = await fetch("/api/billing/subscription", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelAtPeriodEnd: !subscription.cancelAtPeriodEnd }),
      });
      const body = await response.json();
      if (!response.ok || !body.data) {
        toast.error(body.message ?? "Could not update auto-renewal.");
        return;
      }
      setSubscription(body.data as Subscription);
      toast.success(body.message ?? "Auto-renewal updated.");
    } catch {
      toast.error("Could not update auto-renewal.");
    } finally {
      setSavingRenewal(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-slate-800 bg-slate-900/40">
        <CardContent className="flex items-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading billing details…
        </CardContent>
      </Card>
    );
  }

  if (error || !subscription) {
    return (
      <Card className="border-slate-800 bg-slate-900/40">
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <p className="flex items-center gap-2 text-sm text-red-400">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {error ?? "Could not load your billing details."}
          </p>
          <Button type="button" variant="outline" onClick={() => void load()}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isChangingPlan = normalizePlanId(subscription.planId) !== planId;
  const isChangingCycle = subscription.billingCycle !== billingCycle;
  const actionLabel = !subscription.isActive
    ? "Pay and activate"
    : isChangingPlan || isChangingCycle
      ? "Switch plan"
      : "Extend subscription";

  return (
    <div className="space-y-6">
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-white">Subscription</CardTitle>
          <CardDescription className="text-slate-400">
            Your current plan, billing period, and renewal setting.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div
            className={
              subscription.isActive
                ? "flex items-start gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5"
                : "flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5"
            }
          >
            {subscription.isActive ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
            )}
            <div className="text-sm">
              <p className={subscription.isActive ? "font-semibold text-emerald-400" : "font-semibold text-amber-400"}>
                {subscription.isActive
                  ? `${subscription.planName} is active`
                  : subscription.status === "incomplete"
                    ? "No active subscription"
                    : `Your ${subscription.planName ?? "subscription"} has ended`}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {subscription.isActive ? (
                  <>
                    Billed {subscription.billingCycle}. Renews {formatDate(subscription.currentPeriodEnd)}
                    {subscription.daysRemaining !== null && <> — {subscription.daysRemaining} days left</>}.
                    {subscription.cancelAtPeriodEnd && " Auto-renewal is off, so access ends on that date."}
                  </>
                ) : (
                  "Choose a plan below to activate your workspace. Your data is untouched in the meantime."
                )}
              </p>
            </div>
          </div>

          <dl className="grid gap-3 sm:grid-cols-3">
            <Detail icon={CreditCard} label="Plan" value={subscription.planName ?? "None"} />
            <Detail
              icon={CalendarClock}
              label="Current period"
              value={
                subscription.currentPeriodStart
                  ? `${formatDate(subscription.currentPeriodStart)} → ${formatDate(subscription.currentPeriodEnd)}`
                  : "Not started"
              }
            />
            <Detail icon={Receipt} label="Last payment" value={formatDate(subscription.lastPaymentAt)} />
          </dl>

          {subscription.isActive && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
              <div className="text-sm">
                <p className="font-medium text-slate-200">Auto-renewal</p>
                <p className="text-xs text-slate-400">
                  {subscription.cancelAtPeriodEnd
                    ? "Off — your workspace will lock at the end of this period."
                    : "On — we will invoice you again at the end of this period."}
                </p>
              </div>
              <Button type="button" variant="outline" onClick={toggleRenewal} disabled={savingRenewal}>
                {savingRenewal && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {subscription.cancelAtPeriodEnd ? "Turn auto-renewal on" : "Turn auto-renewal off"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-white">
            {subscription.isActive ? "Change or extend your plan" : "Choose a plan"}
          </CardTitle>
          <CardDescription className="text-slate-400">
            Paying while a period is still running extends it rather than replacing it, so nothing is lost by
            renewing early.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <BillingCycleToggle
            value={billingCycle}
            onChange={setBillingCycle}
            disabled={checkout.isRedirecting}
          />

          <PlanCards
            billingCycle={billingCycle}
            selectedPlanId={planId}
            onSelect={setPlanId}
            currentPlanId={subscription.isActive ? subscription.planId : null}
            setupFeePaidPlanId={subscription.setupFeePaidPlanId}
            disabled={checkout.isRedirecting}
          />

          {checkout.error && (
            <p role="alert" className="text-sm text-red-400">
              {checkout.error}
            </p>
          )}

          <Button
            type="button"
            disabled={checkout.isRedirecting}
            onClick={() => void checkout.start({ planId, billingCycle })}
          >
            {checkout.isRedirecting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Opening secure checkout…
              </>
            ) : (
              <>
                <CreditCard className="size-4" aria-hidden="true" />
                {actionLabel}
              </>
            )}
          </Button>

          <p className="text-xs text-slate-500">
            You will be taken to Safepay to pay. Card details are entered there and never reach our servers.
          </p>
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-white">Payment history</CardTitle>
          <CardDescription className="text-slate-400">
            Your ten most recent payment attempts. Quote the reference when contacting support.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {orders.length === 0 ? (
            <p className="py-4 text-sm text-slate-400">No payments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Recent payment attempts</caption>
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th scope="col" className="py-2 pr-4 font-semibold">Date</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Plan</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Amount</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Status</th>
                    <th scope="col" className="py-2 font-semibold">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const style = ORDER_STATUS_STYLES[order.status];
                    return (
                      <tr key={order.reference} className="border-b border-slate-800/60 last:border-0">
                        <td className="py-2.5 pr-4 text-slate-300">
                          {formatDate(order.paidAt ?? order.createdAt)}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-300">
                          {order.planName ?? "—"}
                          <span className="ml-1 text-xs text-slate-500">
                            {cycleSuffix(order.billingCycle)}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-medium text-slate-200">
                          {formatAmount(order.amountMinor, order.currency)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${style.className}`}
                          >
                            {style.label}
                          </span>
                          {order.failureReason && order.status === "failed" && (
                            <span className="mt-0.5 block text-xs text-slate-500">{order.failureReason}</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <code className="rounded bg-slate-800/60 px-1.5 py-0.5 font-mono text-xs text-slate-400">
                            {order.referenceCode ?? order.reference}
                          </code>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CreditCard;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-slate-200">{value}</dd>
    </div>
  );
}
