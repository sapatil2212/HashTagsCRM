"use client";

import React from "react";
import { HeroDashboardPreview } from "./hero-dashboard-preview";

export function ReferenceDashboard() {
  return (
    <div className="relative w-full max-w-5xl mx-auto mt-0 px-4 md:px-0">
      {/* Background Glow Effect behind Dashboard */}
      <div
        className="absolute -top-12 left-1/2 -translate-x-1/2 w-[85%] h-[280px] rounded-full pointer-events-none z-0 animate-pulse bg-[var(--m-glow-emerald)] blur-[100px]"
        style={{ animationDuration: "8s" }}
      />

      {/* The Dashboard Container. Holds a live replica of the real /dashboard
          route rather than a flat screenshot, so it tracks the product and
          follows the marketing light/dark toggle. */}
      <div
        className="relative z-10 w-full rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-surface)] shadow-[var(--m-shadow-card)] backdrop-blur-xl transition-all duration-300 overflow-hidden flex flex-col"
      >
        <HeroDashboardPreview />
      </div>
    </div>
  );
}
