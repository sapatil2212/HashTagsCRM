"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty,
  ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList, ComboboxTrigger,
} from "@/components/ui/combobox";
import {
  ArrowLeft, CheckCircle, Eye, EyeOff, CreditCard,
  Loader2, PartyPopper, ShieldCheck,
} from "lucide-react";
import { InteractiveGrid } from "@/components/marketing/interactive-grid";
import { motion, AnimatePresence } from "framer-motion";
import {
  DEFAULT_PLAN_ID, PLAN_LIST, cycleSuffix, formatAmount, getPlan, isBillingCycle, normalizePlanId,
  type BillingCycle, type PlanId,
} from "@/lib/billing/plans";
import { BillingCycleToggle, PlanCards } from "@/components/billing/plan-cards";
import { useCheckout } from "@/components/billing/use-checkout";

// ─── Business Categories ──────────────────────────────────────────────────────
const BUSINESS_CATEGORIES = [
  "Beauty & Personal Care",
  "Health & Wellness",
  "Trades & Home Services",
  "Professional Services",
  "Automotive Services",
  "Medical & Allied Health",
  "Education & Training",
  "Hospitality",
  "Pet Services",
  "Other",
];

/**
 * Plans come from `@/lib/billing/plans`, not from a list declared here.
 *
 * This file used to own its own `PLANS` array — Starter $9 / Growth $15 first
 * month / Managed $25 pilot month — which disagreed with the marketing pricing
 * page, with `profile-form`'s labels, and with `Tenant.plan`'s vocabulary. Once
 * a real gateway is charging cards, the number shown at signup has to be the
 * number the card is debited, so there can only be one list.
 */

/**
 * `done` is now only reached when checkout could not be started at all — a
 * gateway with no credentials, or a signup whose tenant was never provisioned.
 * The normal path leaves this page entirely for Safepay's hosted checkout and
 * returns to `/billing/result`.
 */
type Step = "form" | "otp" | "payment" | "done";

function SignupPageInner() {
  // The pricing page links here as `/signup?plan=growth&cycle=annual`, so a
  // customer who already chose on the marketing site does not have to choose
  // again. Both params are validated against the catalogue — an unknown value
  // falls back to the default rather than putting an invalid plan into state.
  const searchParams = useSearchParams();
  const requestedPlan = normalizePlanId(searchParams.get("plan"));
  const requestedCycleParam = searchParams.get("cycle");
  const requestedCycle: BillingCycle = isBillingCycle(requestedCycleParam) ? requestedCycleParam : "monthly";

  const [fullName, setFullName]                     = useState("");
  const [email, setEmail]                           = useState("");
  const [mobileNumber, setMobileNumber]             = useState("");
  const [businessCategory, setBusinessCategory]     = useState("");
  const [password, setPassword]                     = useState("");
  const [confirmPassword, setConfirmPassword]       = useState("");
  const [showPassword, setShowPassword]             = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError]                           = useState<string | null>(null);
  const [loading, setLoading]                       = useState(false);

  // Flow steps: "form" -> "otp" -> "payment" -> "done"
  const [step, setStep]                             = useState<Step>("form");
  const [otp, setOtp]                               = useState("");
  const [verifyLoading, setVerifyLoading]           = useState(false);

  const [selectedPlanId, setSelectedPlanId]         = useState<PlanId>(requestedPlan ?? DEFAULT_PLAN_ID);
  const [billingCycle, setBillingCycle]             = useState<BillingCycle>(requestedCycle);
  /**
   * False when the verify step reported that no checkout can be opened for this
   * account — almost always a tenant that failed to provision. The payment step
   * then explains the manual path instead of offering a button that cannot work.
   */
  const [canCheckout, setCanCheckout]               = useState(true);

  const checkout = useCheckout();
  const supabase = createClient();

  const selectedPlan = getPlan(selectedPlanId);
  const setupFeeDue = selectedPlan.setupFeeMinor;
  const dueTodayMinor = selectedPlan.pricing[billingCycle].priceMinor + setupFeeDue;

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (password.length < 6)          { setError("Password must be at least 6 characters"); return; }

    setLoading(true);

    const { error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          business_category: businessCategory,
          phone_number: mobileNumber,
          selected_plan: selectedPlanId,
        },
      },
    });

    setLoading(false);

    if (signupError) {
      setError(signupError.message);
      return;
    }

    setStep("otp");
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerifyLoading(true);

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "signup"
    });

    setVerifyLoading(false);

    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    // The user id is deliberately not kept. Nothing on the client needs it any
    // more: checkout is authorised by the httpOnly grant cookie below, not by a
    // user id in a request body — which is exactly how the old payment-proof
    // endpoint was forgeable.
    //
    // Verifying the OTP also sets a short-lived, httpOnly checkout grant cookie,
    // which is what lets the next step open a payment session without a session
    // token. `canCheckout` is false only when the account has no tenant to bill.
    if (data && typeof data === "object" && "canCheckout" in data) {
      setCanCheckout(Boolean((data as { canCheckout?: unknown }).canCheckout));
    }

    setStep("payment");
  };

  /**
   * Hands off to Safepay. On success the browser leaves this page entirely and
   * comes back to `/billing/result`, so there is no "success" state to render
   * here — which is the point: settlement is confirmed by a signed callback, not
   * by the customer telling us they paid.
   */
  const handlePay = async () => {
    if (!canCheckout) {
      setStep("done");
      return;
    }
    setError(null);
    await checkout.start({ planId: selectedPlanId, billingCycle });
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-[var(--m-bg-primary)] py-12 px-4 overflow-y-auto select-none">
      <InteractiveGrid gridSize={40} className="opacity-20" />
      <div className="absolute top-[20%] left-[20%] w-[50%] h-[50%] rounded-full bg-orange-500/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[20%] w-[50%] h-[50%] rounded-full bg-amber-500/5 blur-[120px] pointer-events-none" />

      {/* Back Home */}
      <Link
        href="/"
        className="absolute top-6 left-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--m-text-tertiary)] hover:text-[var(--m-text-primary)] transition-colors bg-[var(--m-bg-secondary)]/60 border border-[var(--m-border-glass)] px-3 py-1.5 rounded-lg backdrop-blur z-20"
      >
        <ArrowLeft className="size-3.5" /> Back Home
      </Link>

      <AnimatePresence mode="wait">
        {/* ─── STEP 1: Signup Form ────────────────────────────────────────── */}
        {step === "form" && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-2xl z-10"
          >
            <Card className="border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-glass)]/70 backdrop-blur-xl p-6 md:p-8 shadow-none">
              <CardHeader className="items-center text-center p-0 pb-6">
                <CardTitle className="text-xl font-bold tracking-tight text-[var(--m-text-heading)]">
                  Create Account
                </CardTitle>
                <CardDescription className="text-xs text-[var(--m-text-tertiary)] mt-1">
                  Get started with HashTags CRM for WhatsApp
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <form onSubmit={handleSignupSubmit} className="flex flex-col gap-4">
                  {error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
                      {error}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
                    {/* Full Name */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="fullName" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Full Name</Label>
                      <Input id="fullName" type="text" placeholder="Enter your name" value={fullName} onChange={(e) => setFullName(e.target.value)} required
                        className="h-9 px-3 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-orange-500/70 focus-visible:ring-orange-500/10 transition-all duration-200" />
                    </div>

                    {/* Email */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="email" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Email Address</Label>
                      <Input id="email" type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} required
                        className="h-9 px-3 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-orange-500/70 focus-visible:ring-orange-500/10 transition-all duration-200" />
                    </div>

                    {/* Mobile */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="mobileNumber" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Mobile Number</Label>
                      <Input id="mobileNumber" type="tel" placeholder="Enter mobile number" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} required
                        className="h-9 px-3 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-orange-500/70 focus-visible:ring-orange-500/10 transition-all duration-200" />
                    </div>

                    {/* Business Category */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="businessCategory" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Business Category</Label>
                      <Combobox
                        items={BUSINESS_CATEGORIES}
                        value={businessCategory || null}
                        onValueChange={(value) => setBusinessCategory((value as string) ?? "")}
                      >
                        <ComboboxInputGroup>
                          <ComboboxInput
                            id="businessCategory"
                            placeholder="Search business category"
                            required
                            className="h-9 px-3 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-orange-500/70 focus-visible:ring-orange-500/10"
                          />
                          {businessCategory && <ComboboxClear />}
                          <ComboboxTrigger />
                        </ComboboxInputGroup>
                        <ComboboxContent className="border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-secondary)] text-[11px]">
                          <ComboboxEmpty>No category found.</ComboboxEmpty>
                          <ComboboxList>
                            {(item: string) => (
                              <ComboboxItem key={item} value={item} className="text-[11px] text-[var(--m-text-primary)]">
                                {item}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    </div>

                    {/* Pricing Plan Field */}
                    <div className="flex flex-col gap-1.2 sm:col-span-2">
                      <Label htmlFor="selectedPlan" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Select Plan</Label>
                      <Combobox
                        items={[...PLAN_LIST]}
                        value={selectedPlan}
                        itemToStringLabel={(plan) =>
                          `${plan.name} — ${formatAmount(plan.pricing[billingCycle].priceMinor)}${cycleSuffix(billingCycle)}${
                            plan.setupFeeMinor > 0 ? ` + ${formatAmount(plan.setupFeeMinor)} setup` : ""
                          }`
                        }
                        isItemEqualToValue={(item, value) => item.id === value.id}
                        onValueChange={(plan) => {
                          if (plan) setSelectedPlanId(plan.id);
                        }}
                      >
                        <ComboboxInputGroup>
                          <ComboboxInput
                            id="selectedPlan"
                            placeholder="Search plan"
                            required
                            className="h-9 px-3 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-orange-500/70 focus-visible:ring-orange-500/10"
                          />
                          <ComboboxTrigger />
                        </ComboboxInputGroup>
                        <ComboboxContent className="border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-secondary)] text-[11px]">
                          <ComboboxEmpty>No plan found.</ComboboxEmpty>
                          <ComboboxList>
                            {(plan: (typeof PLAN_LIST)[number]) => (
                              <ComboboxItem key={plan.id} value={plan} className="text-[11px] text-[var(--m-text-primary)]">
                                {plan.name} — {formatAmount(plan.pricing[billingCycle].priceMinor)}
                                {cycleSuffix(billingCycle)}
                                {plan.setupFeeMinor > 0 && ` + ${formatAmount(plan.setupFeeMinor)} setup`}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      <p className="text-[10px] text-[var(--m-text-muted)]">
                        {selectedPlan.positioning} — {selectedPlan.coreMessage} You can change this before paying.
                      </p>
                    </div>

                    {/* Password */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="password" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Password</Label>
                      <div className="relative">
                        <Input id="password" type={showPassword ? "text" : "password"} placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required
                          className="h-9 pl-3 pr-9 w-full border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-orange-500/70 focus-visible:ring-orange-500/10 transition-all duration-200" />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-2 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer" aria-label="Toggle password">
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Confirm Password */}
                    <div className="flex flex-col gap-1.2">
                      <Label htmlFor="confirmPassword" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Confirm Password</Label>
                      <div className="relative">
                        <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} placeholder="Confirm your password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
                          className="h-9 pl-3 pr-9 w-full border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)]/50 focus-visible:border-orange-500/70 focus-visible:ring-orange-500/10 transition-all duration-200" />
                        <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-2 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer" aria-label="Toggle confirm password">
                          {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <Button type="submit" disabled={loading}
                    className="mt-4 h-9 w-full bg-orange-500 text-white hover:bg-orange-400 hover:scale-[1.01] active:scale-[0.99] font-bold text-xs transition-all duration-200 border border-orange-400/20 shadow-md shadow-orange-500/20 cursor-pointer">
                    {loading ? "Creating account..." : "Create Account & Verify OTP →"}
                  </Button>
                </form>

                <p className="mt-4.5 text-center text-[11px] text-[var(--m-text-muted)]">
                  Already have an account?{" "}
                  <Link href="/login" className="text-orange-500 hover:text-orange-400 font-bold transition-colors">Sign In</Link>
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ─── STEP 2: OTP Verification ───────────────────────────────────── */}
        {step === "otp" && (
          <motion.div
            key="otp"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm z-10"
          >
            <Card className="border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-glass)]/70 backdrop-blur-xl p-6 md:p-8 shadow-none">
              <CardHeader className="items-center text-center p-0 pb-4 relative">
                <button
                  type="button"
                  onClick={() => setStep("form")}
                  className="absolute left-0 top-0 text-[10px] font-semibold text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)] transition-colors flex items-center gap-1"
                >
                  <ArrowLeft className="size-3" /> Back
                </button>
                <CardTitle className="text-lg font-bold text-[var(--m-text-heading)]">Enter OTP Code</CardTitle>
                <CardDescription className="text-[11px] text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
                  We&apos;ve sent a 6-digit OTP code to <span className="text-[var(--m-text-primary)] font-semibold">{email}</span>.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 pt-3">
                <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3.5">
                  {error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
                      {error}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="otp" className="text-[11px] font-semibold text-[var(--m-text-secondary)] text-center">
                      6-Digit OTP Code
                    </Label>
                    <Input
                      id="otp"
                      type="text"
                      placeholder="••••••"
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      required
                      className="h-10 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-center text-md font-bold tracking-[0.2em] text-[var(--m-text-primary)] focus-visible:border-orange-500/70 focus-visible:ring-orange-500/10 transition-all duration-200"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={verifyLoading}
                    className="h-9 w-full bg-orange-500 text-white hover:bg-orange-400 hover:scale-[1.01] active:scale-[0.99] font-bold text-xs transition-all duration-200 border border-orange-400/20 shadow-md shadow-orange-500/20 cursor-pointer"
                  >
                    {verifyLoading ? "Verifying..." : "Verify & Proceed to Payment"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ─── STEP 3: Pay with Safepay ─────────────────────────────────────── */}
        {step === "payment" && (
          <motion.div
            key="payment"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-3xl z-10"
          >
            <Card className="border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-glass)]/70 backdrop-blur-xl p-6 md:p-8 shadow-none flex flex-col gap-5">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                  <CheckCircle className="size-5 text-orange-400" aria-hidden="true" />
                </div>
                <h2 className="text-base font-bold text-[var(--m-text-heading)]">Email verified — one step left</h2>
                <p className="text-[11px] text-[var(--m-text-tertiary)] leading-relaxed max-w-md">
                  Confirm your plan and pay securely. Your workspace unlocks the moment the payment clears —
                  no waiting for a manual review.
                </p>
              </div>

              <div className="flex justify-center">
                <BillingCycleToggle
                  value={billingCycle}
                  onChange={setBillingCycle}
                  disabled={checkout.isRedirecting}
                />
              </div>

              <PlanCards
                billingCycle={billingCycle}
                selectedPlanId={selectedPlanId}
                onSelect={setSelectedPlanId}
                disabled={checkout.isRedirecting}
              />

              <div className="rounded-xl border border-[var(--m-border-glass)] bg-[var(--m-bg-secondary)]/50 p-4 flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[11px] text-[var(--m-text-secondary)]">
                    {selectedPlan.name} — {billingCycle === "annual" ? "12 months" : "1 month"}
                  </span>
                  <span className="text-[11px] font-semibold text-[var(--m-text-primary)]">
                    {formatAmount(selectedPlan.pricing[billingCycle].priceMinor)}
                  </span>
                </div>
                {setupFeeDue > 0 && (
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[11px] text-[var(--m-text-secondary)]">
                      {selectedPlan.name} onboarding (one-time)
                    </span>
                    <span className="text-[11px] font-semibold text-[var(--m-text-primary)]">
                      {formatAmount(setupFeeDue)}
                    </span>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-4 border-t border-[var(--m-border-glass)]/60 pt-2">
                  <span className="text-[11px] font-bold text-[var(--m-text-heading)]">Due today</span>
                  <span className="text-base font-bold text-[var(--m-text-heading)]">
                    {formatAmount(dueTodayMinor)}
                  </span>
                </div>
              </div>

              {(error || checkout.error) && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400 text-center leading-relaxed"
                >
                  {error ?? checkout.error}
                </div>
              )}

              {!canCheckout && (
                <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-[11px] text-orange-400 text-center leading-relaxed">
                  Online payment is unavailable for this account. Continue and our team will activate you
                  manually.
                </div>
              )}

              <button
                type="button"
                disabled={checkout.isRedirecting}
                onClick={handlePay}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-[11px] font-bold shadow-md shadow-orange-500/20 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
              >
                {checkout.isRedirecting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Opening secure checkout…
                  </>
                ) : (
                  <>
                    <CreditCard className="size-3.5" aria-hidden="true" />
                    {canCheckout ? `Pay ${formatAmount(dueTodayMinor)} with Safepay` : "Continue"}
                  </>
                )}
              </button>

              <p className="flex items-center justify-center gap-1.5 text-[10px] text-[var(--m-text-muted)]">
                <ShieldCheck className="size-3" aria-hidden="true" />
                Card details are entered on Safepay and never reach our servers.
              </p>
            </Card>
          </motion.div>
        )}

        {/* ─── STEP 4: Success Screen ────────────────────────────────────────── */}
        {step === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm z-10"
          >
            <Card className="border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-glass)]/70 backdrop-blur-xl p-8 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                <PartyPopper className="size-8 text-orange-400" />
              </div>

              <div>
                <h2 className="text-xl font-bold text-[var(--m-text-heading)]">Registration complete 🎉</h2>
                <p className="text-[11px] text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
                  <span className="text-[var(--m-text-primary)] font-semibold">
                    Your account needs to be activated manually.
                  </span>{" "}
                  We could not open an online payment for this workspace, so our team will be in touch by
                  email to finish setting you up.
                </p>
              </div>

              <div className="w-full rounded-xl border border-orange-500/20 bg-orange-500/8 px-4 py-3 text-[10px] text-orange-300/80 leading-relaxed">
                Manual activations are handled within{" "}
                <span className="font-bold text-orange-400">24–48 hours</span>.<br />
                You will not be able to sign in until your workspace is active.
              </div>

              <Link href="/login" className="w-full">
                <button className="w-full py-2.5 rounded-xl border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-secondary)] hover:bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)] text-[11px] font-bold transition-all cursor-pointer">
                  Back to Sign In
                </button>
              </Link>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * `useSearchParams` suspends during prerendering, so the page needs a boundary
 * or the whole route opts out of static generation with a build-time error.
 */
export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--m-bg-primary)]">
          <Loader2 className="size-6 animate-spin text-orange-500" />
        </div>
      }
    >
      <SignupPageInner />
    </Suspense>
  );
}
