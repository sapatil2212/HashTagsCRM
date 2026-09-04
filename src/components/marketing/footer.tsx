"use client";

import React from "react";
import Link from "next/link";
import { useMarketingTheme } from "@/components/marketing/marketing-theme-provider";

export function Footer() {
  const { resolvedTheme } = useMarketingTheme();
  const isLight = resolvedTheme === "light";

  const productLinks = [
    { name: "Features", href: "/features" },
    { name: "Pricing", href: "/pricing" },
    { name: "AI Automation", href: "/ai-automation" },
    { name: "Use Cases", href: "/" },
  ];

  const quickLinks = [
    { name: "About Us", href: "/about-us" },
    { name: "Contact Us", href: "/contact-us" },
    { name: "Privacy Policy", href: "/privacy-policy" },
    { name: "Terms & Conditions", href: "/terms-and-conditions" },
    { name: "Refund Policy", href: "/refund-policy" },
  ];

  return (
    <footer className="relative w-full border-t border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] py-16 px-4 md:px-6 overflow-hidden">
      {/* Background radial highlight */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[150px] rounded-full bg-orange-500/10 blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-6 gap-10 md:gap-8 relative z-10">
        {/* Brand Column */}
        <div className="col-span-1 md:col-span-2 space-y-4">
          <Link href="/" className="inline-block">
            <img
              src={isLight ? "/images/logo/chatnexgen-logo-light.png" : "/images/logo/chatnexgen-logo.png"}
              alt="Hashtags CRM Logo"
              className="h-11 md:h-12 w-auto object-contain"
            />
          </Link>
          <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed max-w-sm">
            Hashtags CRM is a premium AI-powered WhatsApp CRM and customer support automation platform. Automate business communication, configure smart chatbots, organize leads, and sync calendar reminders using the official WhatsApp Business API.
          </p>

        </div>

        {/* Product Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">Solutions</h6>
          <ul className="space-y-2.5">
            {productLinks.map((link) => (
              <li key={link.name}>
                <Link href={link.href} className="text-xs text-[var(--m-text-muted)] hover:text-[var(--m-text-heading)] transition-colors">
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Legal & Quick Links Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">Quick Links</h6>
          <ul className="space-y-2.5">
            {quickLinks.map((link) => (
              <li key={link.name}>
                <Link href={link.href} className="text-xs text-[var(--m-text-muted)] hover:text-[var(--m-text-heading)] transition-colors">
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Contact Us Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">Contact Us</h6>
          <ul className="space-y-2.5 text-xs text-[var(--m-text-muted)]">
            <li>Hashtags CRM Technologies</li>
            <li>Phone: +92 316 1122339</li>
            <li className="pt-1">
              <a href="mailto:admin@hashtagscrm.com" className="text-orange-400 hover:underline">
                admin@hashtagscrm.com
              </a>
            </li>
          </ul>
        </div>

        {/* Trust signals Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">Trust Signals</h6>
          <ul className="space-y-2 text-[10px] text-[var(--m-text-muted)] font-semibold">
            <li className="text-orange-400">✓ Secure Platform</li>
            <li className="text-orange-400">✓ Data Encryption</li>
            <li className="text-orange-400">✓ Meta-Compliant</li>
            <li className="text-orange-400">✓ Role-Based Access</li>
            <li className="text-orange-400">✓ Business Support</li>
          </ul>
        </div>
      </div>

      {/* Meta API disclaimer & Copyright footer */}
      <div className="max-w-6xl mx-auto mt-12 pt-8 border-t border-[var(--m-border-primary)]/50 space-y-6 relative z-10 flex flex-col items-center">
        <p className="text-[10px] leading-relaxed text-[var(--m-text-muted)] max-w-3xl mx-auto text-center">
          &quot;Hashtags CRM uses WhatsApp Business API solutions in accordance with Meta and WhatsApp Business policies. Businesses are responsible for obtaining user consent before initiating communication.&quot;
        </p>

        {/* Minimal Footer Style bar (Option 3) */}
        <div
          className={`w-full max-w-4xl mx-auto rounded-2xl border px-6 py-3.5 sm:py-3 shadow-lg backdrop-blur-md flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 transition-all duration-300 ${
            isLight
              ? "bg-slate-100/90 border-slate-200/80 shadow-slate-200/40 text-slate-600"
              : "bg-[#0e121a]/95 border-slate-800/80 shadow-black/50 text-slate-300"
          }`}
        >
          <img
            src={isLight ? "/images/logo/hashtags-tech-light.png" : "/images/logo/hashtags-tech-dark.png"}
            alt="Hashtags Technology"
            className="h-7 sm:h-8 w-auto object-contain shrink-0"
          />
          <p className={`text-xs sm:text-[13px] font-normal text-center sm:text-left leading-normal ${
            isLight ? "text-slate-600" : "text-slate-300"
          }`}>
            © 2026 Hashtags CRM Technologies™ | A Product of{" "}
            <span className="text-[#ff4359] font-medium">Hashtags Technologies</span> | All Rights Reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
