"use client";

/**
 * Where the customer lands after Safepay.
 *
 * The `status` in the query string is written by our own callback handler, which
 * only sets it after verifying the HMAC. It is still just a *display* input —
 * anyone can type `?status=paid` into the address bar — so it decides nothing.
 * Entitlement is read back from `GET /api/billing/subscription`, which reflects
 * the database, and that is what the "workspace is active" claim is based on.
 *
 * The subscription fetch is best-effort: after a successful first payment the
 * customer has no session yet (activation flips `isVerified`, but a session is
 * only issued at login), so a 401 here is expected and not an error. The page
 * then tells them to sign in, which is the honest next step.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

import { InteractiveGrid } from "@/components/marketing/interactive-grid";

/** Statuses our callback handler emits, plus a catch-all. */
type ResultStatus = "paid" | "failed" | "canceled" | "expired" | "pending" | "unverified" | "unknown";

const RESULT_COPY: Record<
  ResultStatus,
  { tone: "success" | "warning" | "error"; title: string; body: string }
> = {
  paid: {
    tone: "success",
    title: "Payment received",
    body: "Your workspace is active. Sign in to get started.",
  },
  pending: {
    tone: "warning",
    title: "Payment is still processing",
    body: "Safepay has not confirmed this payment yet. It usually takes a few seconds — refresh this page shortly. Nothing is charged twice if you wait.",
  },
  canceled: {
    tone: "warning",
    title: "Checkout cancelled",
    body: "No payment was taken. You can pick a plan and try again whenever you are ready.",
  },
  failed: {
    tone: "error",
    title: "The payment did not go through",
    body: "Your card was not charged. This is usually a bank decline — try again, or use a different card.",
  },
  expired: {
    tone: "warning",
    title: "That checkout link expired",
    body: "Payment links are short-lived for security. Start a new one and it will only take a moment.",
  },
  unverified: {
    tone: "error",
    title: "We could not verify this payment",
    body: "The response from the payment provider failed its security check, so we have not activated anything. If your card was charged, contact support with the reference below and we will sort it out.",
  },
  unknown: {
    tone: "error",
    title: "We could not match this payment",
    body: "We have no record of this order. If you were charged, contact support with the reference below.",
  },
};

const TONE_STYLES = {
  success: { icon: CheckCircle2, wrap: "border-emerald-500/20 bg-emerald-500/10", text: "text-emerald-400" },
  warning: { icon: Clock, wrap: "border-orange-500/20 bg-orange-500/10", text: "text-orange-400" },
  error: { icon: XCircle, wrap: "border-red-500/20 bg-red-500/10", text: "text-red-400" },
} as const;

function parseStatus(raw: string | null): ResultStatus {
  const allowed: ResultStatus[] = ["paid", "failed", "canceled", "expired", "pending", "unverified", "unknown"];
  return allowed.includes(raw as ResultStatus) ? (raw as ResultStatus) : "unknown";
}

interface SubscriptionView {
  planName: string | null;
  isActive: boolean;
  currentPeriodEnd: string | null;
}

function BillingResultInner() {
  const searchParams = useSearchParams();
  const status = parseStatus(searchParams.get("status"));
  const reference = searchParams.get("ref");

  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [checking, setChecking] = useState(status === "paid");

  useEffect(() => {
    // Only worth asking when the callback claims success — for every other
    // status there is no entitlement to confirm.
    if (status !== "paid") return;

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/billing/subscription");
        const body = await response.json().catch(() => null);
        if (!cancelled && response.ok && body?.data) setSubscription(body.data as SubscriptionView);
      } catch {
        // Expected when the grant has lapsed. The page still reads correctly.
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  const copy = RESULT_COPY[status];
  const tone = TONE_STYLES[copy.tone];
  const Icon = tone.icon;

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[var(--m-bg-primary)] px-4">
      <InteractiveGrid gridSize={40} className="opacity-20" />
      <div className="pointer-events-none absolute left-[25%] top-[25%] size-[50%] rounded-full bg-orange-500/5 blur-[120px]" />

      <div className="z-10 w-full max-w-md rounded-2xl border border-[var(--m-border-glass)]/50 bg-[var(--m-bg-glass)]/80 p-8 text-center backdrop-blur-xl">
        <span
          className={`mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border ${tone.wrap}`}
        >
          {checking ? (
            <Loader2 className={`size-7 animate-spin ${tone.text}`} aria-hidden="true" />
          ) : (
            <Icon className={`size-7 ${tone.text}`} aria-hidden="true" />
          )}
        </span>

        <h1 className="text-lg font-bold text-[var(--m-text-heading)]">{copy.title}</h1>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--m-text-tertiary)]">{copy.body}</p>

        {subscription?.isActive && subscription.currentPeriodEnd && (
          <p className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-400">
            {subscription.planName} active until{" "}
            {new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        )}

        {reference && (
          <p className="mt-4 text-[10px] text-[var(--m-text-muted)]">
            Reference{" "}
            <code className="rounded bg-[var(--m-bg-secondary)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--m-text-secondary)]">
              {reference}
            </code>
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {status === "paid" ? (
            <Link
              href="/login"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-4 text-[11px] font-bold text-white transition-colors hover:bg-orange-400"
            >
              Sign in to your workspace
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <Link
              href="/billing"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-orange-500 px-4 text-[11px] font-bold text-white transition-colors hover:bg-orange-400"
            >
              Try again
            </Link>
          )}

          <Link
            href="/"
            className="inline-flex h-8 items-center justify-center rounded-lg text-[11px] font-semibold text-[var(--m-text-tertiary)] transition-colors hover:text-[var(--m-text-primary)]"
          >
            Back to homepage
          </Link>
        </div>

        {copy.tone === "error" && (
          <p className="mt-4 flex items-start gap-1.5 text-left text-[10px] leading-relaxed text-[var(--m-text-muted)]">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            Never charged twice: if a payment did go through, our records will show it and your workspace will
            activate automatically once the provider confirms.
          </p>
        )}
      </div>
    </div>
  );
}

export default function BillingResultPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--m-bg-primary)]">
          <Loader2 className="size-6 animate-spin text-orange-500" />
        </div>
      }
    >
      <BillingResultInner />
    </Suspense>
  );
}
