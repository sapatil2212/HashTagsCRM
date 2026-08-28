"use client";

/**
 * Starting a Safepay checkout, from anywhere in the UI.
 *
 * Extracted because three places need it — the signup wizard, `/billing`, and
 * Settings → Billing — and the failure handling is the part that must not be
 * reimplemented three times. In particular:
 *
 *   - **A full page navigation, not `router.push`.** Safepay's checkout is on
 *     its own domain. `router.push` would try to resolve it as an app route.
 *   - **`isRedirecting` never clears.** Once the browser is leaving, flipping the
 *     button back to "Pay" would invite a second click and a second payment
 *     session in the moment before navigation commits.
 *   - **`402` and `501` mean different things.** An unconfigured gateway is an
 *     operator problem the customer can do nothing about, and telling them to
 *     "try again" would be a lie.
 */

import { useCallback, useState } from "react";

import type { BillingCycle, PlanId } from "@/lib/billing/plans";

export interface CheckoutQuoteLine {
  kind: "plan" | "setup_fee";
  label: string;
  amountMinor: number;
}

export interface CheckoutSession {
  reference: string;
  checkoutUrl: string;
  quote: {
    planId: PlanId;
    billingCycle: BillingCycle;
    currency: string;
    planAmountMinor: number;
    setupFeeMinor: number;
    totalMinor: number;
    lineItems: CheckoutQuoteLine[];
  };
  expiresAt: string;
  environment: "sandbox" | "production";
}

interface ApiEnvelope<T> {
  success: boolean;
  message: string | null;
  data: T | null;
  error: { code: string; details?: unknown } | null;
}

export interface UseCheckoutResult {
  /** True from the click until the browser leaves the page. */
  isRedirecting: boolean;
  error: string | null;
  clearError: () => void;
  start: (input: { planId: PlanId; billingCycle: BillingCycle }) => Promise<void>;
}

export function useCheckout(): UseCheckoutResult {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (input: { planId: PlanId; billingCycle: BillingCycle }) => {
    setError(null);
    setIsRedirecting(true);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      const body = (await response.json()) as ApiEnvelope<CheckoutSession>;

      if (!response.ok || !body.data) {
        setIsRedirecting(false);
        setError(describeFailure(response.status, body));
        return;
      }

      // Deliberately leaves `isRedirecting` true: navigation is in flight, and
      // re-enabling the button here is how you get two payment sessions.
      window.location.href = body.data.checkoutUrl;
    } catch {
      setIsRedirecting(false);
      setError("Could not reach the payment service. Check your connection and try again.");
    }
  }, []);

  return { isRedirecting, error, clearError: () => setError(null), start };
}

function describeFailure(status: number, body: ApiEnvelope<unknown>): string {
  // The API's messages are authored by us and safe to show. Falling back to a
  // status-specific line rather than a generic one, because "something went
  // wrong" tells a customer nothing about whether to retry.
  if (body.message && body.error?.code !== "INTERNAL") return body.message;

  switch (status) {
    case 401:
      return "Your session expired. Sign in again to continue.";
    case 429:
      return "Too many attempts. Wait a moment and try again.";
    case 501:
      return "Online payments are not switched on yet. Please contact support to activate your workspace.";
    case 502:
      return "The payment provider did not respond. Please try again in a moment.";
    default:
      return "Could not start the payment. Please try again.";
  }
}
