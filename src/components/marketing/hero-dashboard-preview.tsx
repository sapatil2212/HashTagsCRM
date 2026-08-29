"use client";

/**
 * A faithful, static replica of the real /dashboard route for the marketing
 * hero — replaces the flat hero-dashboard.png screenshot.
 *
 * Why a replica instead of the real component tree: the actual dashboard is
 * auth-gated and data-driven (five parallel queries via AuthProvider), so it
 * cannot render on a public marketing page. This mirrors its structure and
 * class names instead.
 *
 * Light/dark comes for free. The real dashboard styles itself with semantic
 * tokens (bg-card, border-border, text-foreground, bg-sidebar, bg-muted), and
 * globals.css already remaps those under html[data-mtheme="light"] for the
 * marketing theme toggle. So the same class names are reused verbatim here
 * rather than re-deriving colors from the --m-* palette.
 *
 * The exceptions are inline SVG paint values. The real charts hardcode
 * `stroke="rgb(30 41 59)"` and `fill-white`, which the light-mode CSS cannot
 * reach (it only remaps class-based bg/border/text utilities, not `fill-*`
 * utilities or SVG presentation attributes). Those are swapped for
 * var(--border) / var(--m-text-heading) / var(--m-text-muted) below so the
 * charts stay legible in both modes. Axis labels use --m-text-tertiary rather
 * than --m-text-muted: muted resolves to #94a3b8 in light mode, which is too
 * faint on white for 10px text.
 *
 * Everything is inert: no links, no buttons, no hooks beyond the theme read,
 * and no Date/toLocaleString calls (which would risk SSR/client hydration
 * mismatches on locale or timezone). The wrapper is role="img" so assistive
 * tech announces it as a single labelled graphic, exactly as the <img> it
 * replaces did, and descendants are pruned from the accessibility tree.
 */

import {
  Activity,
  ArrowUp,
  Bot,
  Briefcase,
  Calendar,
  DollarSign,
  GitBranch,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  MessageSquare,
  Send,
  Settings,
  Sun,
  UserPlus,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useMarketingTheme } from "./marketing-theme-provider";

/* ------------------------------------------------------------------ *
 * Demo data. Deliberately cross-consistent: the donut stages sum to
 * $48.2k across 23 deals, which is exactly what the "Open Deals Value"
 * metric card reports. Inconsistent numbers are what make a fake
 * dashboard read as fake.
 * ------------------------------------------------------------------ */

const NAV_PRIMARY: { label: string; icon: ComponentType<{ className?: string }>; active?: boolean; dot?: boolean }[] = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Inbox", icon: MessageSquare, dot: true },
  { label: "Campaigns", icon: Megaphone },
  { label: "Contacts", icon: Users },
  { label: "Pipelines", icon: GitBranch },
  { label: "Automations", icon: Zap },
  { label: "Flows", icon: Workflow },
  { label: "Templates", icon: LayoutTemplate },
];

const NAV_AI: { label: string; icon: ComponentType<{ className?: string }> }[] = [
  { label: "Dashboard", icon: Activity },
  { label: "Bookings", icon: Calendar },
  { label: "AI Agents & Staff", icon: Bot },
];

/** Static axis labels — no Date formatting, to keep SSR and client identical. */
const DAYS = ["Apr 8", "Apr 9", "Apr 10", "Apr 11", "Apr 12", "Apr 13", "Apr 14"];
const INCOMING = [42, 58, 51, 74, 63, 88, 79];
const OUTGOING = [55, 71, 66, 92, 81, 96, 90];
/** Matches niceCeil(96) in the real chart, so the gridlines land where they do in-app. */
const MAX_Y = 100;
const Y_TICKS = [0, 25, 50, 75, 100];

const STAGES = [
  { id: "new", name: "New Lead", color: "#f97316", dealCount: 8, totalValue: 15600 },
  { id: "qualified", name: "Qualified", color: "#14b8a6", dealCount: 6, totalValue: 12800 },
  { id: "proposal", name: "Proposal", color: "#8b5cf6", dealCount: 5, totalValue: 11400 },
  { id: "negotiation", name: "Negotiation", color: "#f59e0b", dealCount: 4, totalValue: 8400 },
];
const PIPELINE_TOTAL = STAGES.reduce((sum, s) => sum + s.totalValue, 0); // 48_200

export function HeroDashboardPreview() {
  const { resolvedTheme } = useMarketingTheme();
  const logo =
    resolvedTheme === "light"
      ? "/images/logo/chatnexgen-logo-light.png"
      : "/images/logo/chatnexgen-logo.png";

  return (
    <div
      role="img"
      aria-label="The Hashtags CRM dashboard, showing active conversations, new contacts, open deals value and messages sent today, alongside a conversations-over-time chart and a pipeline value breakdown by stage."
      className="relative flex h-[430px] select-none overflow-hidden bg-background text-foreground sm:h-[520px] lg:h-[620px]"
    >
      {/* ---------------- Sidebar (lg+ only, mirroring the real app's
           responsive behaviour where it collapses to a drawer) ------- */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="" className="h-8 w-auto object-contain" />
        </div>

        <nav className="flex-1 overflow-hidden px-3 py-4">
          <ul className="flex flex-col gap-1">
            {NAV_PRIMARY.map((item) => (
              <li key={item.label}>
                <div
                  className={
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium " +
                    (item.active
                      ? "bg-primary/10 text-primary"
                      : "text-sidebar-foreground/75")
                  }
                >
                  <item.icon className="h-4 w-4" />
                  <span className="flex-1">{item.label}</span>
                  {item.dot && (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="my-4 border-t border-sidebar-border" />

          <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            AI Booking &amp; Agent
          </div>
          <ul className="flex flex-col gap-1">
            {NAV_AI.map((item) => (
              <li key={item.label}>
                <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/75">
                  <item.icon className="h-4 w-4" />
                  <span className="flex-1">{item.label}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className="my-4 border-t border-sidebar-border" />
          <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/75">
            <Settings className="h-4 w-4" />
            <span className="flex-1">Settings</span>
          </div>
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-3">
          <div className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
              A
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">Ananya Sharma</p>
              <p className="truncate text-xs text-sidebar-foreground/60">ananya@brightleaf.in</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ---------------- Main column ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
          <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">Dashboard</h1>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
              <Sun className="h-4 w-4" />
            </span>
            <span className="flex items-center gap-2 rounded-md py-1 pl-1 pr-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                A
              </span>
              <span className="hidden text-sm font-medium text-foreground sm:inline">Ananya Sharma</span>
            </span>
          </div>
        </header>

        {/* Scroll body */}
        <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
          <div className="mx-auto w-full max-w-screen-xl space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Live analytics across conversations, contacts, deals, broadcasts, and automations.
              </p>
            </div>

            {/* Metric cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricCard
                title="Active Conversations"
                value="128"
                icon={MessageSquare}
                delta="+12 new today vs yesterday"
              />
              <MetricCard
                title="New Contacts Today"
                value="34"
                icon={UserPlus}
                delta="+8 vs yesterday"
              />
              <MetricCard
                title="Open Deals Value"
                value="$48,200"
                icon={DollarSign}
                subtitle="23 open deals"
              />
              <MetricCard
                title="Messages Sent Today"
                value="1,284"
                icon={Send}
                delta="+212 vs yesterday"
              />
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <QuickAction label="New Contact" icon={UserPlus} tint="text-primary" />
              <QuickAction label="New Deal" icon={Briefcase} tint="text-teal-400" />
              <QuickAction label="New Automation" icon={Zap} tint="text-primary" />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <div className="h-full lg:col-span-3">
                <ConversationsChart />
              </div>
              <div className="h-full lg:col-span-2">
                <PipelineDonut />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom fade — implies the page continues below the hero crop. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
        style={{ background: "linear-gradient(to bottom, transparent, var(--background))" }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces, mirroring src/components/dashboard/* markup
 * ------------------------------------------------------------------ */

function MetricCard({
  title,
  value,
  icon: Icon,
  delta,
  subtitle,
}: {
  title: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  delta?: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-[28px] font-bold leading-none tabular-nums text-foreground">{value}</p>
      {delta ? (
        <div className="mt-2 flex items-center gap-1 text-sm text-primary">
          <ArrowUp className="h-4 w-4" />
          <span className="tabular-nums">{delta}</span>
        </div>
      ) : subtitle ? (
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  );
}

function QuickAction({
  label,
  icon: Icon,
  tint,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  tint: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-muted ${tint}`}>
        <Icon className="h-4 w-4" />
      </div>
      <span className="text-sm font-medium text-foreground">{label}</span>
    </div>
  );
}

/* ---------------- Conversations line chart ---------------- */

const VB_W = 760;
const VB_H = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };

function ConversationsChart() {
  const chartW = VB_W - PAD.left - PAD.right;
  const chartH = VB_H - PAD.top - PAD.bottom;
  const stepX = chartW / (DAYS.length - 1);
  const xFor = (i: number) => PAD.left + i * stepX;
  const yFor = (v: number) => PAD.top + chartH - (v / MAX_Y) * chartH;
  const pathFor = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(v)}`).join(" ");

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Conversations Over Time</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Daily message volume by direction</p>
        </div>
        <div className="hidden items-center gap-1 rounded-lg bg-muted p-1 sm:flex">
          <span className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-foreground">7 days</span>
          <span className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground">30 days</span>
          <span className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground">90 days</span>
        </div>
      </header>

      <div className="p-5">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-[240px] w-full">
          {Y_TICKS.map((t) => {
            const y = yFor(t);
            return (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={VB_W - PAD.right}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-border"
                  strokeDasharray="3 3"
                />
                <text
                  x={PAD.left - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="var(--m-text-tertiary)"
                  className="text-[10px]"
                >
                  {t}
                </text>
              </g>
            );
          })}

          {DAYS.map((d, i) => (
            <text
              key={d}
              x={xFor(i)}
              y={VB_H - 8}
              textAnchor="middle"
              fill="var(--m-text-tertiary)"
              className="text-[10px]"
            >
              {d}
            </text>
          ))}

          <path
            d={pathFor(OUTGOING)}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={pathFor(INCOMING)}
            fill="none"
            stroke="#14b8a6"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <footer className="flex items-center gap-4 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#14b8a6" }} />
          Incoming
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--primary)" }} />
          Outgoing
        </span>
      </footer>
    </section>
  );
}

/* ---------------- Pipeline donut ---------------- */

function PipelineDonut() {
  const size = 200;
  const r = 80;
  const ringWidth = 18;
  const c = size / 2;

  // Same min-share flooring the real donut uses so thin stages stay visible.
  const minFrac = 0.02;
  const floored = STAGES.map((s) => Math.max(s.totalValue / PIPELINE_TOTAL, minFrac));
  const floorSum = floored.reduce((a, b) => a + b, 0);
  const shares = floored.map((x) => x / floorSum);
  const offsets: number[] = [0];
  for (let i = 0; i < shares.length; i++) offsets.push(offsets[i] + shares[i]);

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h3 className="text-sm font-semibold text-foreground">Pipeline Value</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Open deals by stage</p>
      </header>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-center">
          <svg viewBox={`0 0 ${size} ${size}`} className="h-48 w-48">
            {/* Track: var(--border), not the real component's hardcoded
                rgb(30 41 59), which would stay dark in light mode. */}
            <circle cx={c} cy={c} r={r} fill="none" stroke="var(--border)" strokeWidth={ringWidth} />
            {STAGES.map((s, i) => (
              <path
                key={s.id}
                d={arcPath(c, c, r, offsets[i] * Math.PI * 2 - Math.PI / 2, offsets[i + 1] * Math.PI * 2 - Math.PI / 2)}
                fill="none"
                stroke={s.color}
                strokeWidth={ringWidth}
                strokeLinecap="butt"
              />
            ))}
            <text x={c} y={c - 6} textAnchor="middle" fill="var(--m-text-tertiary)" className="text-[11px]">
              Total
            </text>
            <text
              x={c}
              y={c + 14}
              textAnchor="middle"
              fill="var(--m-text-heading)"
              className="text-[18px] font-semibold tabular-nums"
            >
              {formatCurrencyShort(PIPELINE_TOTAL)}
            </text>
          </svg>
        </div>

        <ul className="mt-5 space-y-2">
          {STAGES.map((s) => (
            <li key={s.id} className="flex items-center gap-3 text-xs">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              <span className="flex-1 truncate text-foreground">{s.name}</span>
              <span className="tabular-nums text-muted-foreground">{s.dealCount} deals</span>
              <span className="w-20 text-right tabular-nums text-foreground">
                {formatCurrencyShort(s.totalValue)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function arcPath(cx: number, cy: number, r: number, startRad: number, endRad: number): string {
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = endRad - startRad > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function formatCurrencyShort(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}
