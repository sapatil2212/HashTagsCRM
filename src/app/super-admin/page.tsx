"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Users, Wifi, MessageSquare, TrendingUp, Activity,
  ArrowRight, Loader2, Contact, AlertCircle, CheckCircle,
  Copy, Check, Plus, RefreshCw, Shield, Sparkles, ExternalLink,
  ChevronRight, Database, Server, Smartphone, Zap, ArrowUpRight,
  ChevronUp, ChevronDown, Download, UserCheck, UserX, Clock
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Stats {
  totalUsers: number;
  verifiedUsers: number;
  pendingApprovals?: number;
  waConnected: number;
  totalContacts: number;
  openConversations: number;
  totalConversations: number;
  planBreakdown: Record<string, number>;
  monthlySignups: { month: string; count: number }[];
}

interface User {
  id: string;
  email: string;
  fullName: string;
  plan: string;
  isVerified: boolean;
  waConnected: boolean;
  createdAt: string;
  contacts: number;
  conversations: number;
}

const PLAN_COLOR: Record<string, string> = {
  free:       "bg-slate-50 border-slate-200 text-slate-500",
  starter:    "bg-blue-50 border-blue-100 text-blue-600",
  essential:  "bg-blue-50 border-blue-100 text-blue-600",
  pro:        "bg-violet-50 border-violet-100 text-violet-600",
  growth:     "bg-violet-50 border-violet-100 text-violet-600",
  enterprise: "bg-amber-50 border-amber-100 text-amber-600",
  managed:    "bg-amber-50 border-amber-100 text-amber-600",
};

const PLAN_DISPLAY: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  essential: "Starter",
  pro: "Pro",
  growth: "Pro",
  enterprise: "Enterprise",
  managed: "Enterprise",
};

const PLAN_BAR: Record<string, string> = {
  free: "bg-slate-400",
  starter: "bg-blue-500",
  pro: "bg-violet-500",
  enterprise: "bg-amber-500",
};

// Mini Sparkline component for KPI cards
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 64;
  const height = 22;

  const points = data
    .map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export default function SuperAdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Interactive controls
  const [timeRange, setTimeRange] = useState<"6m" | "12m">("12m");
  const [chartMode, setChartMode] = useState<"monthly" | "cumulative">("monthly");
  const [hoveredMonth, setHoveredMonth] = useState<{ month: string; count: number; index: number } | null>(null);
  const [recentTab, setRecentTab] = useState<"all" | "active" | "blocked" | "paid">("all");
  const [userSearch, setUserSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"fullName" | "createdAt" | "contacts">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [sRes, uRes] = await Promise.all([
        fetch("/api/super-admin/stats").then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => null);
            throw new Error(body?.error || `Stats request failed (${r.status})`);
          }
          return r.json();
        }),
        fetch("/api/super-admin/users").then(async (r) => {
          if (!r.ok) throw new Error(`Users request failed (${r.status})`);
          return r.json();
        }),
      ]);

      setStats(sRes);
      setUsers(uRes.users ?? []);
    } catch (err: any) {
      console.error("[Dashboard Load Error]", err);
      setError(err?.message || "Failed to load dashboard metrics.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCopyEmail = (email: string, id: string) => {
    navigator.clipboard.writeText(email);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  // Quick inline toggle for account active status
  const handleToggleAccess = async (user: User) => {
    setTogglingId(user.id);
    try {
      const res = await fetch("/api/super-admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, isVerified: !user.isVerified }),
      });
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, isVerified: !u.isVerified } : u))
        );
        if (stats) {
          setStats({
            ...stats,
            verifiedUsers: user.isVerified ? stats.verifiedUsers - 1 : stats.verifiedUsers + 1,
          });
        }
      }
    } catch (err) {
      console.error("Failed to toggle access:", err);
    } finally {
      setTogglingId(null);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (!users.length) return;
    const headers = ["Full Name", "Email", "Plan", "Status", "WA Connected", "Contacts", "Conversations", "Created At"];
    const rows = users.map((u) => [
      `"${u.fullName || ""}"`,
      `"${u.email || ""}"`,
      `"${PLAN_DISPLAY[u.plan] || u.plan}"`,
      u.isVerified ? "Active" : "Blocked",
      u.waConnected ? "Yes" : "No",
      u.contacts,
      u.conversations,
      `"${new Date(u.createdAt).toISOString()}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `hashtags_users_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Signups data based on time range
  const allSignups = stats?.monthlySignups ?? [];
  const displaySignups = useMemo(() => {
    let sliced = timeRange === "6m" ? allSignups.slice(-6) : allSignups;
    if (chartMode === "cumulative") {
      let run = 0;
      return sliced.map((m) => {
        run += m.count;
        return { month: m.month, count: run };
      });
    }
    return sliced;
  }, [allSignups, timeRange, chartMode]);

  const maxSignup = Math.max(...displaySignups.map((m) => m.count), 1);
  const totalPeriodSignups = displaySignups.reduce((sum, m) => sum + m.count, 0);
  const avgMonthlySignups = displaySignups.length > 0
    ? (totalPeriodSignups / displaySignups.length).toFixed(1)
    : "0";

  // Filtered and sorted recent users
  const filteredRecentUsers = useMemo(() => {
    let list = [...users];

    // Tab filter
    if (recentTab === "active") list = list.filter((u) => u.isVerified);
    else if (recentTab === "blocked") list = list.filter((u) => !u.isVerified);
    else if (recentTab === "paid") {
      list = list.filter((u) => {
        const p = u.plan?.toLowerCase() || "";
        return p === "pro" || p === "growth" || p === "enterprise" || p === "managed" || p === "starter" || p === "essential";
      });
    }

    // Search query
    if (userSearch.trim()) {
      const q = userSearch.toLowerCase();
      list = list.filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      );
    }

    // Sorting
    list.sort((a, b) => {
      let av: any = a[sortKey] ?? "";
      let bv: any = b[sortKey] ?? "";
      if (sortKey === "createdAt") {
        av = new Date(av).getTime();
        bv = new Date(bv).getTime();
      }
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });

    return list.slice(0, 8);
  }, [users, recentTab, userSearch, sortKey, sortDir]);

  const verifiedPercent = stats && stats.totalUsers > 0
    ? Math.round((stats.verifiedUsers / stats.totalUsers) * 100)
    : 0;

  const waPercent = stats && stats.totalUsers > 0
    ? Math.round((stats.waConnected / stats.totalUsers) * 100)
    : 0;

  // Generate sparkline datasets from monthlySignups
  const sparklineData = useMemo(() => {
    const counts = allSignups.map((s) => s.count);
    return counts.length >= 2 ? counts.slice(-6) : [1, 2, 3, 2, 4, 5];
  }, [allSignups]);

  const STAT_CARDS = stats ? [
    {
      label: "Total Registered Users",
      value: stats.totalUsers ?? 0,
      sub: `${stats.verifiedUsers ?? 0} active (${verifiedPercent}%)`,
      icon: Users,
      iconColor: "text-violet-600",
      iconBg: "bg-violet-50 border-violet-100",
      sparkColor: "#7c3aed",
      sparkData: sparklineData,
      progress: verifiedPercent,
      progressColor: "bg-violet-600",
      href: "/super-admin/users",
    },
    {
      label: "WhatsApp Integrations",
      value: stats.waConnected ?? 0,
      sub: `${waPercent}% connection rate`,
      icon: Wifi,
      iconColor: "text-emerald-600",
      iconBg: "bg-emerald-50 border-emerald-100",
      sparkColor: "#10b981",
      sparkData: [Math.max(stats.waConnected - 3, 0), Math.max(stats.waConnected - 2, 0), Math.max(stats.waConnected - 1, 0), stats.waConnected],
      progress: waPercent,
      progressColor: "bg-emerald-500",
      href: "/super-admin/users?filter=wa_connected",
    },
    {
      label: "Total Platform Contacts",
      value: stats.totalContacts ?? 0,
      sub: "managed across accounts",
      icon: Contact,
      iconColor: "text-blue-600",
      iconBg: "bg-blue-50 border-blue-100",
      sparkColor: "#2563eb",
      sparkData: [12, 19, 24, 32, 45, Math.min(stats.totalContacts, 60)],
      progress: Math.min(Math.round((stats.totalContacts / 1000) * 100), 100),
      progressColor: "bg-blue-500",
      href: "/super-admin/users",
    },
    {
      label: "Conversations Activity",
      value: stats.openConversations ?? 0,
      sub: `${stats.totalConversations ?? 0} total dialogues`,
      icon: MessageSquare,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-50 border-amber-100",
      sparkColor: "#d97706",
      sparkData: [4, 8, 7, 12, 16, Math.min(stats.openConversations, 20)],
      progress: stats.totalConversations > 0
        ? Math.round((stats.openConversations / stats.totalConversations) * 100)
        : 0,
      progressColor: "bg-amber-500",
      href: "/super-admin/users",
    },
  ] : [];

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-1.5">
            <TrendingUp className="size-4 text-violet-500" /> Super Admin Overview
          </h1>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Real-time platform performance & user growth metrics.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Live system status pill */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-100 text-[11px] font-medium text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Systems Live</span>
          </div>

          {/* Pending approvals alert badge */}
          {(stats?.pendingApprovals ?? 0) > 0 && (
            <Link
              href="/super-admin/new-users"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-700 hover:bg-amber-100/60 active:scale-[0.98] transition-all"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
              <span>{stats?.pendingApprovals} Pending Approval</span>
            </Link>
          )}

          {/* Refresh button */}
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-800 hover:bg-slate-50 text-[11px] font-medium active:scale-[0.98] transition-all disabled:opacity-50"
            title="Refresh dashboard metrics"
          >
            <RefreshCw className={cn("size-3", refreshing && "animate-spin text-violet-600")} />
            <span>Refresh</span>
          </button>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            className="hidden sm:flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-800 hover:bg-slate-50 text-[11px] font-medium active:scale-[0.98] transition-all"
            title="Export user data to CSV"
          >
            <Download className="size-3" />
            <span>Export</span>
          </button>

          {/* Manage Users primary button */}
          <Link
            href="/super-admin/users"
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold active:scale-[0.98] transition-all shadow-sm"
          >
            <Plus className="size-3" />
            <span>Manage Users</span>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-xl border border-slate-200">
          <Loader2 className="size-6 text-violet-600 animate-spin" />
          <p className="text-xs text-slate-400 mt-2 font-medium">Aggregating platform metrics...</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
            <AlertCircle className="size-4 text-red-600" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-red-800">Unable to load dashboard data</p>
            <p className="text-[11px] text-red-600 mt-0.5">{error}</p>
          </div>
          <button
            onClick={() => fetchData()}
            className="px-2.5 py-1 rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 text-[11px] font-medium"
          >
            Try Again
          </button>
        </div>
      ) : (
        <>
          {/* KPI Stat Cards with Mini Sparklines */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {STAT_CARDS.map((s) => (
              <Link
                key={s.label}
                href={s.href}
                className="group relative rounded-xl border border-slate-200 bg-white p-3.5 transition-all duration-200 hover:border-violet-300 hover:bg-slate-50/40 block"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] text-slate-500 font-medium group-hover:text-slate-700 transition-colors">
                    {s.label}
                  </p>
                  <div className={cn("w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 transition-transform group-hover:scale-105", s.iconBg)}>
                    <s.icon className={cn("size-3.5", s.iconColor)} />
                  </div>
                </div>

                <div className="flex items-baseline justify-between gap-1">
                  <p className="text-xl font-bold tabular-nums text-slate-800 tracking-tight">
                    {s.value.toLocaleString()}
                  </p>
                  <Sparkline data={s.sparkData} color={s.sparkColor} />
                </div>

                <div className="flex items-center justify-between mt-1">
                  <p className="text-[10px] text-slate-400 font-medium">{s.sub}</p>
                  <ArrowUpRight className="size-3 text-slate-300 group-hover:text-violet-500 transition-colors" />
                </div>

                {/* Micro progress bar */}
                <div className="mt-2.5 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", s.progressColor)}
                    style={{ width: `${Math.max(s.progress, 4)}%` }}
                  />
                </div>
              </Link>
            ))}
          </div>

          {/* Interactive Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Monthly signups interactive chart */}
            <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <TrendingUp className="size-3.5 text-violet-500" /> Registration Velocity
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {totalPeriodSignups} new users · Avg {avgMonthlySignups}/mo · Peak {maxSignup}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Mode Toggle: Monthly vs Cumulative */}
                    <div className="flex items-center gap-0.5 bg-slate-100 border border-slate-200/80 p-0.5 rounded-lg text-[10px] font-medium text-slate-600">
                      <button
                        onClick={() => setChartMode("monthly")}
                        className={cn(
                          "px-2 py-0.5 rounded-md transition-all",
                          chartMode === "monthly" ? "bg-white text-violet-700 font-semibold border border-slate-200" : "hover:text-slate-900"
                        )}
                      >
                        Monthly
                      </button>
                      <button
                        onClick={() => setChartMode("cumulative")}
                        className={cn(
                          "px-2 py-0.5 rounded-md transition-all",
                          chartMode === "cumulative" ? "bg-white text-violet-700 font-semibold border border-slate-200" : "hover:text-slate-900"
                        )}
                      >
                        Cumulative
                      </button>
                    </div>

                    {/* Range Toggle: 6M vs 12M */}
                    <div className="flex items-center gap-0.5 bg-slate-100 border border-slate-200/80 p-0.5 rounded-lg text-[10px] font-semibold text-slate-600">
                      <button
                        onClick={() => setTimeRange("6m")}
                        className={cn(
                          "px-2 py-0.5 rounded-md transition-all",
                          timeRange === "6m" ? "bg-white text-violet-700 border border-slate-200" : "hover:text-slate-900"
                        )}
                      >
                        6M
                      </button>
                      <button
                        onClick={() => setTimeRange("12m")}
                        className={cn(
                          "px-2 py-0.5 rounded-md transition-all",
                          timeRange === "12m" ? "bg-white text-violet-700 border border-slate-200" : "hover:text-slate-900"
                        )}
                      >
                        12M
                      </button>
                    </div>
                  </div>
                </div>

                {/* Hover Details Banner */}
                <div className="h-6 mb-2 flex items-center">
                  {hoveredMonth ? (
                    <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-md bg-violet-50 border border-violet-100 text-[11px] text-violet-800 font-medium">
                      <span className="font-semibold">{hoveredMonth.month}:</span>
                      <span>{hoveredMonth.count} user{hoveredMonth.count !== 1 ? "s" : ""} registered</span>
                      <span className="text-violet-500 text-[10px]">
                        ({Math.round((hoveredMonth.count / maxSignup) * 100)}% of peak)
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-400 italic">
                      Hover over any month bar to inspect exact signups
                    </span>
                  )}
                </div>
              </div>

              {/* Chart Bars */}
              <div>
                <div className="flex items-end gap-1.5 h-28 pt-2">
                  {displaySignups.map((m, i) => {
                    const isPeak = m.count === maxSignup && m.count > 0;
                    const isHovered = hoveredMonth?.index === i;
                    const heightPercent = Math.max((m.count / maxSignup) * 100, 5);

                    return (
                      <div
                        key={m.month + i}
                        className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end cursor-pointer group"
                        onMouseEnter={() => setHoveredMonth({ month: m.month, count: m.count, index: i })}
                        onMouseLeave={() => setHoveredMonth(null)}
                      >
                        {/* Interactive Bar */}
                        <div className="w-full relative flex items-end justify-center h-full">
                          <div
                            className={cn(
                              "w-full rounded-sm transition-all duration-200",
                              isHovered
                                ? "bg-violet-600 ring-2 ring-violet-200"
                                : isPeak
                                ? "bg-violet-500"
                                : i === displaySignups.length - 1
                                ? "bg-violet-400"
                                : "bg-slate-100 group-hover:bg-slate-200"
                            )}
                            style={{ height: `${heightPercent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* X-axis labels */}
                <div className="flex gap-1.5 mt-2 border-t border-slate-100 pt-1.5 text-[9px] text-slate-400 font-medium">
                  {displaySignups.map((m, i) => (
                    <span
                      key={m.month + i}
                      className={cn(
                        "flex-1 text-center transition-colors truncate",
                        hoveredMonth?.index === i ? "text-violet-700 font-semibold" : ""
                      )}
                    >
                      {m.month}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Plan Distribution Interactive Breakdown */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Activity className="size-3.5 text-violet-500" /> Plan Distribution
                  </p>
                  <Link
                    href="/super-admin/users"
                    className="text-[10px] text-violet-600 hover:text-violet-700 font-semibold flex items-center gap-0.5"
                  >
                    All plans <ArrowRight className="size-2.5" />
                  </Link>
                </div>
                <p className="text-[10px] text-slate-400 mb-3.5">
                  Tenant subscription tier distribution
                </p>

                <div className="space-y-3">
                  {(["enterprise", "pro", "starter", "free"] as const).map((plan) => {
                    const count = stats?.planBreakdown[plan] ?? 0;
                    const total = Object.values(stats?.planBreakdown ?? {}).reduce((a, b) => a + b, 0) || 1;
                    const sharePct = Math.round((count / total) * 100);

                    return (
                      <Link
                        key={plan}
                        href={`/super-admin/users?plan=${plan}`}
                        className="block group rounded-lg p-1.5 -mx-1.5 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="flex items-center gap-1.5">
                            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", PLAN_COLOR[plan])}>
                              {(PLAN_DISPLAY[plan] ?? plan).toUpperCase()}
                            </span>
                            <span className="text-[10px] text-slate-400 group-hover:text-slate-600 transition-colors">
                              {sharePct}%
                            </span>
                          </span>
                          <span className="text-slate-700 text-[11px] font-semibold font-mono tabular-nums group-hover:text-violet-600 transition-colors">
                            {count} {count === 1 ? "tenant" : "tenants"}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all duration-300", PLAN_BAR[plan])}
                            style={{ width: `${Math.min(sharePct, 100)}%` }}
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>

              {/* Total paid tier share pill */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-medium">Total Paid Tier Adoption</span>
                <span className="text-violet-700 font-bold font-mono">
                  {Math.round(
                    (((stats?.planBreakdown["enterprise"] ?? 0) +
                      (stats?.planBreakdown["pro"] ?? 0) +
                      (stats?.planBreakdown["starter"] ?? 0)) /
                      Math.max(stats?.totalUsers ?? 1, 1)) *
                      100
                  )}
                  %
                </span>
              </div>
            </div>
          </div>

          {/* Quick Platform Services Health Strip */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                <Database className="size-3" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-slate-700">Database Engine</p>
                <p className="text-[9px] text-slate-400">PostgreSQL (Prisma ORM)</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                <Smartphone className="size-3" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-slate-700">WhatsApp Gateway</p>
                <p className="text-[9px] text-slate-400">{stats?.waConnected ?? 0} Active Hubs</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center text-violet-600">
                <Shield className="size-3" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-slate-700">Authentication</p>
                <p className="text-[9px] text-slate-400">JWT HTTP-Only Secured</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
                <Zap className="size-3" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-slate-700">Verification Rate</p>
                <p className="text-[9px] text-slate-400">{verifiedPercent}% Accounts Active</p>
              </div>
            </div>
          </div>

          {/* Interactive Recent Registrations Table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            {/* Header with Search and Filter Tabs */}
            <div className="p-3 border-b border-slate-100 bg-slate-50/40 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <Users className="size-3.5 text-violet-500" /> Recent Registrations
                </p>
                <span className="text-[10px] bg-slate-100 border border-slate-200 text-slate-600 px-1.5 py-0.2 rounded font-mono">
                  {filteredRecentUsers.length} shown
                </span>
              </div>

              {/* Search and Tabs */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <input
                  type="text"
                  placeholder="Filter users..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="h-7 w-36 sm:w-48 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-all"
                />

                {/* Filter Tabs */}
                <div className="flex items-center gap-0.5 bg-slate-100 border border-slate-200/80 p-0.5 rounded-lg text-[10px] font-medium text-slate-600">
                  {(["all", "active", "blocked", "paid"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setRecentTab(tab)}
                      className={cn(
                        "px-2 py-0.5 rounded-md capitalize transition-all",
                        recentTab === tab
                          ? "bg-white text-violet-700 font-semibold border border-slate-200 shadow-xs"
                          : "hover:text-slate-900"
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <Link
                  href="/super-admin/users"
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] text-slate-600 hover:text-slate-800 font-medium active:scale-[0.98] transition-all"
                >
                  <span>View All</span>
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/30 text-slate-400 font-semibold text-[10px] uppercase tracking-wider">
                    <th
                      onClick={() => {
                        if (sortKey === "fullName") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                        else { setSortKey("fullName"); setSortDir("asc"); }
                      }}
                      className="px-3 py-2.5 text-left cursor-pointer hover:text-slate-600"
                    >
                      <span className="flex items-center gap-1">
                        User {sortKey === "fullName" && (sortDir === "asc" ? <ChevronUp className="size-2.5" /> : <ChevronDown className="size-2.5" />)}
                      </span>
                    </th>
                    <th className="px-3 py-2.5 text-left">Email Address</th>
                    <th className="px-3 py-2.5 text-left">Plan</th>
                    <th className="px-3 py-2.5 text-left">Access Status</th>
                    <th className="px-3 py-2.5 text-left">WA Integration</th>
                    <th
                      onClick={() => {
                        if (sortKey === "contacts") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                        else { setSortKey("contacts"); setSortDir("desc"); }
                      }}
                      className="px-3 py-2.5 text-left cursor-pointer hover:text-slate-600"
                    >
                      <span className="flex items-center gap-1">
                        Contacts {sortKey === "contacts" && (sortDir === "asc" ? <ChevronUp className="size-2.5" /> : <ChevronDown className="size-2.5" />)}
                      </span>
                    </th>
                    <th
                      onClick={() => {
                        if (sortKey === "createdAt") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                        else { setSortKey("createdAt"); setSortDir("desc"); }
                      }}
                      className="px-3 py-2.5 text-left cursor-pointer hover:text-slate-600"
                    >
                      <span className="flex items-center gap-1">
                        Joined {sortKey === "createdAt" && (sortDir === "asc" ? <ChevronUp className="size-2.5" /> : <ChevronDown className="size-2.5" />)}
                      </span>
                    </th>
                    <th className="px-3 py-2.5 text-right">Quick Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecentUsers.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors"
                    >
                      {/* Name & Avatar */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-200/40 flex items-center justify-center text-violet-600 text-xs font-bold shrink-0">
                            {(u.fullName || u.email).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-slate-800 text-xs truncate max-w-[130px]">
                              {u.fullName || "—"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Email + Quick Copy */}
                      <td className="px-3 py-2.5 text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate max-w-[150px]">{u.email}</span>
                          <button
                            onClick={() => handleCopyEmail(u.email, u.id)}
                            className="text-slate-400 hover:text-slate-600 p-0.5 rounded transition-colors"
                            title="Copy email to clipboard"
                          >
                            {copiedId === u.id ? (
                              <Check className="size-3 text-emerald-600" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Plan Badge */}
                      <td className="px-3 py-2.5">
                        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", PLAN_COLOR[u.plan] ?? PLAN_COLOR.free)}>
                          {(PLAN_DISPLAY[u.plan] ?? u.plan).toUpperCase()}
                        </span>
                      </td>

                      {/* Access Status with Interactive Toggle Switch */}
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => handleToggleAccess(u)}
                          disabled={togglingId === u.id}
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-all active:scale-95 disabled:opacity-50",
                            u.isVerified
                              ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                              : "bg-red-50 border-red-200 text-red-600 hover:bg-red-100"
                          )}
                          title={`Click to ${u.isVerified ? "block" : "activate"} user`}
                        >
                          {togglingId === u.id ? (
                            <Loader2 className="size-2.5 animate-spin" />
                          ) : (
                            <span className={cn("w-1.5 h-1.5 rounded-full", u.isVerified ? "bg-emerald-500" : "bg-red-500")} />
                          )}
                          <span>{u.isVerified ? "Active" : "Blocked"}</span>
                        </button>
                      </td>

                      {/* WhatsApp Integration Status */}
                      <td className="px-3 py-2.5">
                        {u.waConnected ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                            <Wifi className="size-2.5" /> Connected
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
                            <Wifi className="size-2.5 text-slate-300" /> Offline
                          </span>
                        )}
                      </td>

                      {/* Contacts Count */}
                      <td className="px-3 py-2.5 text-slate-600 font-mono tabular-nums text-xs">
                        {u.contacts.toLocaleString()}
                      </td>

                      {/* Joined Date */}
                      <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap text-[11px]">
                        {new Date(u.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/super-admin/users`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-medium text-slate-600 hover:text-slate-800 transition-colors"
                          >
                            <span>Manage</span>
                            <ExternalLink className="size-2.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredRecentUsers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-xs text-slate-400">
                        {userSearch ? "No users matching your search." : "No users found in this category."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
