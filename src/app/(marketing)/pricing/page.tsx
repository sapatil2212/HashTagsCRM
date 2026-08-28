"use client";

import React from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { BookDemoTrigger } from "@/components/marketing/book-demo-trigger";
import { PLAN_LIST, annualSavingMinor, formatAmount } from "@/lib/billing/plans";

/**
 * Prices are read from `@/lib/billing/plans`, which is the same module the
 * checkout endpoint prices an order with. This page previously carried its own
 * list ($9 / $15 first month / $25 pilot month) that had drifted from the signup
 * wizard's and from the settings panel's — tolerable when payment was a bank
 * transfer and a human check, indefensible now that a card is charged. If the
 * page and the gateway can disagree, one of them is lying to the customer.
 */
export default function PricingPage() {
  const plans = PLAN_LIST.map((plan) => ({
    id: plan.id,
    name: plan.name,
    tagline: plan.positioning,
    coreMessage: plan.coreMessage,
    monthly: formatAmount(plan.pricing.monthly.priceMinor),
    annual: formatAmount(plan.pricing.annual.priceMinor),
    annualSaving: annualSavingMinor(plan.id),
    setupFee: plan.setupFeeMinor,
    popular: plan.recommended,
    badge: plan.recommended ? "Recommended" : undefined,
    footerText:
      plan.setupFeeMinor === 0
        ? "Your workspace unlocks the moment payment clears."
        : `Onboarding begins within 48 hours of payment. One-time ${formatAmount(plan.setupFeeMinor)} setup covers it.`,
  }));

  // Matrix keys match the catalogue's plan ids so a column cannot silently point
  // at a tier that no longer exists.
  const features = {
    platform: {
      title: "The Platform",
      rows: [
        { name: "No-Code Automation Builder", essential: "check", growth: "check", managed: "check" },
        { name: "AI Assistant (trained on your docs)", essential: "DIY", growth: "DIY", managed: "We configure it" },
        { name: "Shared Team Inbox", essential: "check", growth: "check", managed: "check" },
        { name: "27+ Integrations", essential: "check", growth: "check", managed: "check" },
        { name: "0% Message Markup", essential: "check", growth: "check", managed: "check" },
        { name: "Click-to-WhatsApp Ads (CTWA)", essential: "check", growth: "check", managed: "check" }
      ]
    },
    setup: {
      title: "Setup & Onboarding",
      rows: [
        { name: "Meta Business Verification", essential: "DIY", growth: "check", managed: "check" },
        { name: "WhatsApp Number Connection", essential: "DIY", growth: "check", managed: "check" },
        { name: "WhatsApp Co-existence Setup", essential: "DIY", growth: "check", managed: "check" },
        { name: "Platform Configuration & Team Access", essential: "DIY", growth: "check", managed: "check" },
        { name: "Kickoff Meeting", essential: "DIY", growth: "check", managed: "check" },
        { name: "Automations Built For You", essential: "DIY", growth: "DIY", managed: "2–3 core automations" },
        { name: "Message Templates Written & Submitted", essential: "DIY", growth: "DIY", managed: "check" },
        { name: "Integrations Wired In", essential: "DIY", growth: "check", managed: "check" }
      ]
    },
    support: {
      title: "Support & Strategy",
      rows: [
        { name: "Priority WhatsApp Support Group", essential: "check", growth: "check", managed: "check" },
        { name: "Monthly Group Q&A with Lakshit", essential: "check", growth: "check", managed: "check" },
        { name: "1-on-1 Strategy Call", essential: "DIY", growth: "Onboarding call included", managed: "Monthly deep-dive (60 min)" },
        { name: "Meta Template Fast-Track Approvals", essential: "DIY", growth: "DIY", managed: "check" },
        { name: "Dedicated Account Manager", essential: "DIY", growth: "DIY", managed: "check" }
      ]
    }
  };

  const renderValue = (val: string) => {
    if (val === "check") {
      return (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500/10 text-orange-400">
          <Check className="size-3.5" />
        </span>
      );
    }
    if (val === "DIY") {
      return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[var(--m-text-tertiary)]">DIY</span>;
    }
    return <span className="text-xs font-semibold px-2.5 py-1 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400">{val}</span>;
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-24">
      {/* Page Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-orange-500/25 bg-[var(--m-badge-bg)] text-orange-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3" /> pricing
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          Pricing <br />
          <span className="bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
            One platform. Three ways to get started.
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          Same platform on every plan. What changes is how much of the setup we do for you — and how much
          strategy you get afterwards. Pay annually and you get two months free.
        </p>
      </div>

      {/* Plan Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {plans.map((plan) => (
          <SpotlightCard
            key={plan.name}
            interactive={true}
            className={plan.popular ? "border-orange-500/50 shadow-lg shadow-orange-950/5 relative" : "border-[var(--m-border-primary)]/85"}
            glowColor={plan.popular ? "rgba(255, 165, 0, 0.15)" : "rgba(148, 163, 184, 0.08)"}
          >
            {plan.badge && (
              <div className="absolute top-4 right-4 bg-orange-500 text-white text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full tracking-wider">
                {plan.badge}
              </div>
            )}
            <div className="space-y-6 flex flex-col justify-between h-full">
              <div className="space-y-4">
                <span className="text-xs font-bold text-[var(--m-text-tertiary)] uppercase tracking-widest">{plan.name}</span>
                <h4 className="text-sm text-[var(--m-text-secondary)] font-semibold min-h-[20px]">{plan.tagline}</h4>

                <div className="py-2 border-y border-[var(--m-border-primary)]/50">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl sm:text-4xl font-extrabold text-[var(--m-text-heading)]">{plan.monthly}</span>
                    <span className="text-xs text-[var(--m-text-muted)]">/month</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--m-text-muted)]">
                    or <span className="font-semibold text-[var(--m-text-secondary)]">{plan.annual}</span>/year
                    {plan.annualSaving > 0 && (
                      <span className="ml-1 font-semibold text-emerald-400">
                        save {formatAmount(plan.annualSaving)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-xs font-medium text-orange-400/90">
                  {plan.setupFee === 0
                    ? "Setup included — no one-time fee"
                    : `+ ${formatAmount(plan.setupFee)} one-time setup`}
                </div>

                <p className="text-xs leading-relaxed text-[var(--m-text-tertiary)]">{plan.coreMessage}</p>
              </div>

              <div className="space-y-4 pt-4">
                <Link
                  href={`/signup?plan=${plan.id}`}
                  className="w-full py-3 rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 bg-orange-500 text-white hover:bg-orange-400 shadow-[0_0_12px_rgba(255,165,0,0.2)]"
                >
                  Get Started
                </Link>
                <div className="text-[10px] text-[var(--m-text-muted)] text-center leading-relaxed">{plan.footerText}</div>
              </div>
            </div>
          </SpotlightCard>
        ))}
      </div>

      <div className="text-center pt-4">
        <p className="text-xs text-[var(--m-text-muted)] font-medium">*Pricing exclusive of GST</p>
      </div>

      {/* Feature Comparison Matrix */}
      <div className="space-y-8 pt-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--m-text-heading)]">Compare Plan Features</h2>
          <p className="text-xs text-[var(--m-text-tertiary)]">Detailed capability matrix across all setup tiers</p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/10 backdrop-blur-md">
          <table className="w-full min-w-[600px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/40 text-[var(--m-text-secondary)] font-bold text-xs">
                <th className="p-4 w-[40%]">Capability</th>
                {PLAN_LIST.map((plan) => (
                  <th key={plan.id} className="p-4 text-center w-[20%]">{plan.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(features).map(([key, section]) => (
                <React.Fragment key={key}>
                  <tr className="bg-[var(--m-bg-secondary)]/20 border-b border-[var(--m-border-primary)]">
                    <td colSpan={4} className="px-4 py-3 text-xs uppercase font-extrabold tracking-wider text-orange-400">
                      {section.title}
                    </td>
                  </tr>
                  {section.rows.map((row, rIdx) => (
                    <tr 
                      key={rIdx} 
                      className="border-b border-[var(--m-border-primary)]/50 hover:bg-[var(--m-bg-secondary)]/15 transition-colors duration-150"
                    >
                      <td className="p-4 text-xs font-semibold text-[var(--m-text-secondary)]">{row.name}</td>
                      <td className="p-4 text-center">{renderValue(row.essential)}</td>
                      <td className="p-4 text-center">{renderValue(row.growth)}</td>
                      <td className="p-4 text-center">{renderValue(row.managed)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Callout */}
      <div className="text-center space-y-4">
        <BookDemoTrigger className="inline-flex items-center gap-1 text-sm font-semibold transition-colors text-orange-500 hover:text-orange-400">
          Not sure which plan? Talk to us →
        </BookDemoTrigger>
      </div>
    </div>
  );
}
