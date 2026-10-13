"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Search, MoreVertical, Trash2, CheckCircle, XCircle,
  X, Loader2, ChevronUp, ChevronDown, RefreshCw, Plus,
  Wifi, WifiOff, ShieldCheck, ShieldOff, Eye, EyeOff,
  Edit2, MessageSquare, Radio, Zap, Crown, LogIn, Sliders, Sparkles,
  CreditCard, Calendar, IndianRupee, Banknote, ArrowUpRight, Clock,
  DollarSign, FileText, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  email: string;
  fullName: string;
  businessName: string;
  businessType: string;
  phoneNumber: string;
  role: string;
  isVerified: boolean;
  plan: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantActive: boolean;
  waStatus: string;
  waConnected: boolean;
  contacts: number;
  conversations: number;
  broadcasts: number;
  automations: number;
  betaFeatures?: string[];
  subscriptionExpiresAt: string | null;
  selectedPlan: string | null;
  createdAt: string;
  updatedAt: string;
}

type SortKey = "fullName" | "email" | "plan" | "contacts" | "conversations" | "createdAt";
type FilterStatus = "all" | "verified" | "unverified" | "wa_connected";
type FilterPlan = "all" | "free" | "starter" | "essential" | "pro" | "growth" | "enterprise" | "managed";

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

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtFull(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function toInputDate(d: string | null): string {
  if (!d) return "";
  try {
    const date = new Date(d);
    return date.toISOString().split("T")[0];
  } catch {
    return "";
  }
}

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  const diff = new Date(d).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function normalizeUserPlan(plan: string | null | undefined): string {
  if (!plan) return "free";
  const p = plan.toLowerCase().trim();
  if (p === "pro" || p === "growth" || p === "professional") return "pro";
  if (p === "starter" || p === "essential" || p === "basic") return "starter";
  if (p === "enterprise" || p === "managed") return "enterprise";
  return "free";
}

function Avatar({ name, email }: { name: string; email: string }) {
  return (
    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-200/40 flex items-center justify-center text-violet-600 text-xs font-bold shrink-0">
      {(name || email).charAt(0).toUpperCase()}
    </div>
  );
}

// ─── Add / Edit User Modal ───────────────────────────────────────────────────
function UserModal({
  user,
  onSave,
  onClose,
}: {
  user?: User | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const isEdit = !!user;
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [showPass, setShowPass] = useState(false);

  // Initial plan normalization
  const initialPlan = normalizeUserPlan(user?.plan);
  const initialExpiry = user?.subscriptionExpiresAt;
  const initialFromDate = (() => {
    if (!initialExpiry) return new Date().toISOString().split("T")[0];
    const exp = new Date(initialExpiry);
    return exp > new Date() ? exp.toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
  })();

  const [form, setForm] = useState({
    email:        user?.email        ?? "",
    password:     "",
    fullName:     user?.fullName     ?? "",
    businessName: user?.businessName ?? "",
    businessType: user?.businessType ?? "",
    phoneNumber:  user?.phoneNumber  ?? "",
    plan:         initialPlan,
    role:         user?.role         ?? "user",
    isVerified:   user?.isVerified   ?? true,
  });

  // Manual payment & subscription extension state
  const [enableSubExtend, setEnableSubExtend] = useState(false);
  const [subAction, setSubAction] = useState<"collect_payment" | "extend" | "change_plan">("collect_payment");
  const [subForm, setSubForm] = useState({
    billingCycle: "monthly" as "monthly" | "annual",
    extensionMonths: 1,
    paymentMode: "cash" as "cash" | "bank_transfer" | "online" | "upi" | "cheque" | "free_grant",
    paymentAmount: "",
    paymentReference: "",
    paymentNotes: "",
    fromDate: initialFromDate,
    toDate: (() => {
      const d = new Date(initialFromDate);
      d.setMonth(d.getMonth() + 1);
      return d.toISOString().split("T")[0];
    })(),
  });

  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));
  const setSub = (k: string, v: string | number) => setSubForm((p) => ({ ...p, [k]: v }));

  const handleSelectMonths = (m: number) => {
    setSubForm((p) => {
      const from = p.fromDate ? new Date(p.fromDate) : new Date();
      const to = new Date(from);
      to.setMonth(to.getMonth() + m);
      return {
        ...p,
        extensionMonths: m,
        toDate: to.toISOString().split("T")[0],
      };
    });
  };

  const handleFromDateChange = (val: string) => {
    setSubForm((p) => {
      const from = val ? new Date(val) : new Date();
      const to = new Date(from);
      to.setMonth(to.getMonth() + (p.extensionMonths || 1));
      return {
        ...p,
        fromDate: val,
        toDate: to.toISOString().split("T")[0],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      let res: Response;
      if (isEdit) {
        const body: Record<string, any> = {
          id: user!.id,
          fullName: form.fullName,
          businessName: form.businessName,
          businessType: form.businessType,
          phoneNumber: form.phoneNumber,
          role: form.role,
          plan: form.plan,
          isVerified: form.isVerified,
        };

        // If manual extension / payment collection is enabled
        if (enableSubExtend) {
          body.subscriptionAction = subAction;
          body.subscriptionUpdate = {
            plan: form.plan,
            billingCycle: subForm.billingCycle,
            extensionMonths: subForm.extensionMonths,
            paymentMode: subForm.paymentMode,
            paymentAmount: subForm.paymentAmount ? parseFloat(subForm.paymentAmount) : 0,
            paymentReference: subForm.paymentReference,
            paymentNotes: subForm.paymentNotes,
            fromDate: subForm.fromDate,
            toDate: subForm.toDate,
          };
        }

        res = await fetch("/api/super-admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/super-admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
      } else {
        onSave();
        onClose();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 transition-all";
  const labelCls = "block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1";
  const selectCls = cn(inputCls, "cursor-pointer bg-white");

  const currentExpiry = user?.subscriptionExpiresAt;
  const expiryDays = daysUntil(currentExpiry ?? null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-slate-900/15 backdrop-blur-[2.5px]" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-xl rounded-xl border border-slate-200/80 bg-white/95 backdrop-blur-xl overflow-hidden shadow-xl shadow-slate-900/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              {isEdit ? <Edit2 className="size-3.5 text-violet-500" /> : <Plus className="size-3.5 text-violet-500" />}
              {isEdit ? "Edit User" : "Add New User"}
            </h2>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {isEdit ? `Manage account details, plan, and manual payment for ${user.fullName || user.email}` : "Create a new user account with workspace and permissions"}
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
            <X className="size-3.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 max-h-[78vh] overflow-y-auto">
          {/* User Details */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Full Name *</label>
              <input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required placeholder="Demo User" className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Email Address *</label>
              <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required disabled={isEdit} placeholder="demo@gmail.com" className={cn(inputCls, isEdit && "opacity-60 cursor-not-allowed bg-slate-50")} />
            </div>
            {!isEdit && (
              <div className="col-span-2">
                <label className={labelCls}>Password *</label>
                <div className="relative">
                  <input type={showPass ? "text" : "password"} value={form.password} onChange={(e) => set("password", e.target.value)} required placeholder="••••••••" className={cn(inputCls, "pr-8")} />
                  <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                    {showPass ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className={labelCls}>Business Name</label>
              <input value={form.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="Acme Inc." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone Number</label>
              <input value={form.phoneNumber} onChange={(e) => set("phoneNumber", e.target.value)} placeholder="+1 555 0000" className={inputCls} />
            </div>
          </div>

          {/* Subscription & Access */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/30 p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Crown className="size-3.5 text-amber-500" /> Subscription & Access
              </p>
              {isEdit && currentExpiry && (
                <span className={cn(
                  "text-[10px] font-medium px-2 py-0.5 rounded border",
                  expiryDays !== null && expiryDays <= 7 ? "bg-red-50 border-red-200 text-red-600" :
                  expiryDays !== null && expiryDays <= 30 ? "bg-amber-50 border-amber-200 text-amber-600" :
                  "bg-emerald-50 border-emerald-200 text-emerald-600"
                )}>
                  Expires: {fmt(currentExpiry)} ({expiryDays !== null && expiryDays > 0 ? `${expiryDays}d left` : "Expired"})
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Plan</label>
                <select value={form.plan} onChange={(e) => set("plan", e.target.value)} className={selectCls}>
                  <option value="pro">Pro ($39/mo)</option>
                  <option value="starter">Starter ($19/mo)</option>
                  <option value="enterprise">Enterprise ($99/mo)</option>
                  <option value="free">Free</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Role</label>
                <select value={form.role} onChange={(e) => set("role", e.target.value)} className={selectCls}>
                  <option value="user">User</option>
                  <option value="tenant_admin">Admin (Tenant Owner)</option>
                  <option value="staff">Staff / Agent</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
            </div>

            {/* Dashboard Access toggle */}
            <div className="flex items-center justify-between pt-1">
              <div>
                <p className="text-xs font-medium text-slate-700">Dashboard Access</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Allow this user to log in and use their dashboard</p>
              </div>
              <button
                type="button"
                onClick={() => set("isVerified", !form.isVerified)}
                className={cn("relative w-9 h-5 rounded-full transition-colors duration-200", form.isVerified ? "bg-violet-600" : "bg-slate-300")}
              >
                <span className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200", form.isVerified ? "translate-x-4" : "translate-x-0")} />
              </button>
            </div>

            {/* Manual Payment Collection & Plan Extension (Edit mode) */}
            {isEdit && (
              <div className="mt-3 pt-3 border-t border-slate-200/80">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Banknote className="size-3.5 text-emerald-600" />
                    <div>
                      <p className="text-xs font-semibold text-slate-700">Collect Manual Payment / Extend Plan</p>
                      <p className="text-[10px] text-slate-400">Collect cash, bank transfer, UPI, or adjust validity dates</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnableSubExtend(!enableSubExtend)}
                    className={cn(
                      "px-2.5 py-1 rounded text-[10px] font-semibold border transition-all",
                      enableSubExtend
                        ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    {enableSubExtend ? "Enabled ✓" : "+ Add Payment / Extend"}
                  </button>
                </div>

                {enableSubExtend && (
                  <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/30 p-3 space-y-3">
                    {/* Action types */}
                    <div>
                      <label className={labelCls}>Action Type</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { key: "collect_payment", label: "Collect Payment", icon: Banknote },
                          { key: "extend", label: "Extend Validity", icon: Calendar },
                          { key: "change_plan", label: "Change Plan", icon: ArrowUpRight },
                        ].map((a) => (
                          <button
                            key={a.key}
                            type="button"
                            onClick={() => setSubAction(a.key as typeof subAction)}
                            className={cn(
                              "flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border text-[10px] font-semibold transition-all",
                              subAction === a.key
                                ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            )}
                          >
                            <a.icon className="size-3" />
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mode of Payment */}
                    <div>
                      <label className={labelCls}>Mode of Payment</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { key: "cash", label: "Cash", icon: Banknote },
                          { key: "bank_transfer", label: "Bank Transfer", icon: CreditCard },
                          { key: "online", label: "Online", icon: DollarSign },
                          { key: "upi", label: "UPI", icon: IndianRupee },
                          { key: "cheque", label: "Cheque", icon: FileText },
                          { key: "free_grant", label: "Free Grant", icon: Sparkles },
                        ].map((pm) => (
                          <button
                            key={pm.key}
                            type="button"
                            onClick={() => setSub("paymentMode", pm.key)}
                            className={cn(
                              "flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-medium transition-all",
                              subForm.paymentMode === pm.key
                                ? "border-violet-400 bg-violet-50 text-violet-700 ring-1 ring-violet-300"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            )}
                          >
                            <pm.icon className="size-3 shrink-0" />
                            <span className="truncate">{pm.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Amount & Reference */}
                    {subForm.paymentMode !== "free_grant" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelCls}>Amount Collected</label>
                          <div className="relative">
                            <input
                              type="number"
                              step="0.01"
                              value={subForm.paymentAmount}
                              onChange={(e) => setSub("paymentAmount", e.target.value)}
                              placeholder={form.plan === "pro" ? "39.00" : form.plan === "enterprise" ? "99.00" : "19.00"}
                              className={inputCls}
                            />
                          </div>
                        </div>
                        <div>
                          <label className={labelCls}>Reference / Receipt #</label>
                          <input
                            value={subForm.paymentReference}
                            onChange={(e) => setSub("paymentReference", e.target.value)}
                            placeholder="e.g. CASH-1024 / UPI-987"
                            className={inputCls}
                          />
                        </div>
                      </div>
                    )}

                    {/* Quick duration presets */}
                    <div>
                      <label className={labelCls}>Extend Validity Duration</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[
                          { m: 1, label: "+1 Month" },
                          { m: 3, label: "+3 Months" },
                          { m: 6, label: "+6 Months" },
                          { m: 12, label: "+1 Year" },
                        ].map(({ m, label }) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => handleSelectMonths(m)}
                            className={cn(
                              "py-1.5 rounded-lg border text-[10px] font-medium transition-all text-center",
                              subForm.extensionMonths === m
                                ? "border-violet-400 bg-violet-100/60 text-violet-800 font-semibold"
                                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Dates From and To */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>From Date</label>
                        <input
                          type="date"
                          value={subForm.fromDate}
                          onChange={(e) => handleFromDateChange(e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>To Date</label>
                        <input
                          type="date"
                          value={subForm.toDate}
                          onChange={(e) => setSub("toDate", e.target.value)}
                          className={inputCls}
                        />
                      </div>
                    </div>

                    {/* Payment Notes */}
                    <div>
                      <label className={labelCls}>Payment / Extension Notes</label>
                      <textarea
                        value={subForm.paymentNotes}
                        onChange={(e) => setSub("paymentNotes", e.target.value)}
                        placeholder="e.g. Cash collected at office, Receipt #104..."
                        rows={2}
                        className={cn(inputCls, "resize-none")}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
              <p className="text-[11px] text-red-600">{error}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] transition-all">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 shadow-sm">
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : (isEdit ? <CheckCircle className="size-3.5" /> : <Plus className="size-3.5" />)}
              {loading ? "Saving..." : (isEdit ? "Save Changes" : "Create User")}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Feature Flags Modal ───────────────────────────────────────────────────
const AVAILABLE_FEATURES = [
  { id: "ai_healthcare", name: "AI Healthcare & Clinic Automation", desc: "Automated patient triage, booking agent, and clinic logs" },
  { id: "deals_pipeline", name: "CRM Deals & Pipelines", desc: "Visual Kanban pipeline and lead value tracking" },
  { id: "flow_builder", name: "Visual Flow Builder", desc: "Interactive WhatsApp bot flow designer" },
  { id: "broadcast_campaigns", name: "WhatsApp Campaigns", desc: "Bulk outbound messaging and scheduled broadcasts" },
  { id: "multi_agent", name: "Multi-Agent Routing", desc: "Advanced round-robin and teammate conversation assignment" },
];

function FeatureFlagsModal({
  user,
  onSave,
  onClose,
}: {
  user: User;
  onSave: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(user.betaFeatures || []);
  const [loading, setLoading] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/super-admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: user.id,
          betaFeatures: selected,
        }),
      });
      onSave();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-slate-900/15 backdrop-blur-[2.5px]" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-md bg-white/85 backdrop-blur-xl rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-xl shadow-slate-900/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <Sparkles className="size-4 text-violet-500" /> Feature Flags
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Toggle workspace features for {user.fullName || user.email}</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-2">
          {AVAILABLE_FEATURES.map((f) => {
            const active = selected.includes(f.id);
            return (
              <div
                key={f.id}
                onClick={() => toggle(f.id)}
                className={cn(
                  "p-2.5 rounded-lg border cursor-pointer transition-all flex items-start gap-2.5 select-none",
                  active ? "bg-violet-50/40 border-violet-200" : "bg-slate-50/30 border-slate-200 hover:border-slate-300"
                )}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => {}}
                  className="mt-0.5 accent-violet-600 rounded"
                />
                <div>
                  <p className="text-[11px] font-medium text-slate-700">{f.name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{f.desc}</p>
                </div>
              </div>
            );
          })}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-slate-200 bg-white text-[11px] font-medium text-slate-500 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5"
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : "Save Feature Flags"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SuperAdminUsersPage() {
  const [users,    setUsers]    = useState<User[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");
  const [statusF,  setStatusF]  = useState<FilterStatus>("all");
  const [planF,    setPlanF]    = useState<FilterPlan>("all");
  const [sortKey,  setSortKey]  = useState<SortKey>("createdAt");
  const [sortDir,  setSortDir]  = useState<"asc" | "desc">("desc");
  const [detail,   setDetail]   = useState<User | null>(null);
  const [delId,    setDelId]    = useState<string | null>(null);
  const [editUser, setEditUser] = useState<User | null | "new">(null);
  const [flagsUser, setFlagsUser] = useState<User | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos,  setMenuPos]  = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [toggling, setToggling] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleImpersonate = async (u: User) => {
    setImpersonating(u.id);
    try {
      const res = await fetch("/api/super-admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id }),
      });
      const data = await res.json();
      if (data.ok) {
        window.location.href = data.redirectUrl || "/inbox";
      } else {
        alert(data.error || "Failed to impersonate tenant");
      }
    } catch (err) {
      alert("Network error while trying to log in as tenant");
    } finally {
      setImpersonating(null);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetch("/api/super-admin/users")
      .then((r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then((d) => setUsers(d.users ?? []))
      .catch((err) => {
        console.error("[Users Load Error]", err);
        setLoadError(err.message || "Failed to load users");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let r = users.filter((u) => {
      const q = search.toLowerCase();
      const matchQ = !q || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.businessName.toLowerCase().includes(q);
      const matchS =
        statusF === "all"         ? true :
        statusF === "verified"    ? u.isVerified :
        statusF === "unverified"  ? !u.isVerified :
        statusF === "wa_connected"? u.waConnected : true;
      const matchP = planF === "all" ? true : (
        u.plan?.toLowerCase() === planF ||
        normalizeUserPlan(u.plan) === planF ||
        PLAN_DISPLAY[u.plan]?.toLowerCase() === planF
      );
      return matchQ && matchS && matchP;
    });
    return [...r].sort((a, b) => {
      const av = a[sortKey] ?? "", bv = b[sortKey] ?? "";
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [users, search, statusF, planF, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const SI = ({ k }: { k: SortKey }) =>
    sortKey === k ? (sortDir === "asc" ? <ChevronUp className="size-2.5" /> : <ChevronDown className="size-2.5" />) : null;

  const toggleAccess = async (u: User) => {
    setToggling(u.id);
    try {
      await fetch("/api/super-admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id, isVerified: !u.isVerified }),
      });
      setUsers((p) => p.map((x) => x.id === u.id ? { ...x, isVerified: !u.isVerified } : x));
      if (detail?.id === u.id) setDetail((prev) => prev ? { ...prev, isVerified: !u.isVerified } : null);
    } catch (err) {
      console.error("Toggle access failed:", err);
    }
    setToggling(null);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/super-admin/users?id=${id}`, { method: "DELETE" });
    setUsers((p) => p.filter((u) => u.id !== id));
    setDelId(null);
    if (detail?.id === id) setDetail(null);
  };

  // Stats
  const stats = useMemo(() => ({
    total: users.length,
    verified: users.filter((u) => u.isVerified).length,
    waConnected: users.filter((u) => u.waConnected).length,
    expiringSoon: users.filter((u) => {
      const d = daysUntil(u.subscriptionExpiresAt);
      return d !== null && d >= 0 && d <= 7;
    }).length,
  }), [users]);

  return (
    <div className="space-y-4">
      {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-1.5">
              <Users className="size-4.5 text-violet-500" /> Users
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-[11px] text-slate-400">{stats.total} registered</span>
              <span className="text-[11px] text-emerald-500 font-medium">{stats.verified} verified</span>
              <span className="text-[11px] text-blue-500 font-medium">{stats.waConnected} WA</span>
              {stats.expiringSoon > 0 && (
                <span className="text-[11px] text-amber-500 font-medium flex items-center gap-0.5">
                  <Clock className="size-3" /> {stats.expiringSoon} expiring
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={load} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-800 hover:bg-slate-50 text-[11px] font-medium active:scale-[0.97] transition-all">
              <RefreshCw className="size-3" /> Refresh
            </button>
            <button
              onClick={() => setEditUser("new")}
              className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold active:scale-[0.98] transition-all shadow-sm"
            >
              <Plus className="size-3" /> Add User
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email, or business..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 transition-all" />
          </div>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value as FilterStatus)}
            className="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:border-violet-500 transition-all">
            <option value="all">All Status</option>
            <option value="verified">Verified</option>
            <option value="unverified">Unverified</option>
            <option value="wa_connected">WA Connected</option>
          </select>
          <select value={planF} onChange={(e) => setPlanF(e.target.value as FilterPlan)}
            className="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:border-violet-500 transition-all">
            <option value="all">All Plans</option>
            <option value="free">Free</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-5 text-violet-500 animate-spin" />
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <XCircle className="size-5 text-red-400" />
              <p className="text-xs text-red-500">{loadError}</p>
              <button onClick={load} className="text-[11px] text-violet-500 hover:text-violet-700 font-medium">Retry</button>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-visible">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/30">
                    {([
                      ["fullName",      "User",          true],
                      ["email",         "Email",         true],
                      ["plan",          "Plan",          true],
                      ["status",        "Access",        false],
                      ["wa",            "WhatsApp",      false],
                      ["contacts",      "Contacts",      true],
                      ["conversations", "Convos",        true],
                      ["createdAt",     "Joined",        true],
                    ] as [SortKey | string, string, boolean][]).map(([k, label, sortable]) => (
                      <th key={k} className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                        {sortable
                          ? <button onClick={() => toggleSort(k as SortKey)} className="flex items-center gap-0.5 hover:text-slate-600 transition-colors">{label}<SI k={k as SortKey} /></button>
                          : label}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-12 text-center text-xs text-slate-400">
                          No users found.
                        </td>
                      </tr>
                    ) : filtered.map((u, i) => (
                      <motion.tr key={u.id}
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        transition={{ delay: i * 0.015 }}
                        className={cn("border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors cursor-pointer", !u.isVerified && "opacity-60")}
                        onClick={() => setDetail(u)}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <Avatar name={u.fullName} email={u.email} />
                            <div>
                              <p className="font-medium text-slate-700 text-xs">{u.fullName || "—"}</p>
                              {u.businessName && <p className="text-[10px] text-slate-400">{u.businessName}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 max-w-[140px] truncate">{u.email}</td>
                        <td className="px-3 py-2.5">
                          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", PLAN_COLOR[u.plan] ?? PLAN_COLOR.free)}>
                            {(PLAN_DISPLAY[u.plan] ?? u.plan).toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {u.isVerified
                            ? <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-100 text-emerald-600"><CheckCircle className="size-2.5" />Active</span>
                            : <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-red-50 border-red-100 text-red-500"><XCircle className="size-2.5" />Blocked</span>
                          }
                        </td>
                        <td className="px-3 py-2.5">
                          {u.waConnected
                            ? <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-100 text-emerald-600"><Wifi className="size-2.5" />On</span>
                            : <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-slate-50 border-slate-100 text-slate-400"><WifiOff className="size-2.5" />Off</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 font-mono tabular-nums">{u.contacts}</td>
                        <td className="px-3 py-2.5 text-slate-500 font-mono tabular-nums">{u.conversations}</td>
                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{fmt(u.createdAt)}</td>
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                              setOpenMenu(openMenu === u.id ? null : u.id);
                            }}
                            className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                          >
                            <MoreVertical className="size-3.5" />
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
          <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/20 flex items-center justify-between text-[10px] text-slate-400">
            <span>Showing {filtered.length} of {users.length} users</span>
            <button onClick={() => { setSearch(""); setStatusF("all"); setPlanF("all"); }} className="flex items-center gap-0.5 hover:text-slate-600 transition-colors">
              <RefreshCw className="size-2.5" /> Reset filters
            </button>
          </div>
        </div>

        {/* Dropdown context menu */}
        {openMenu && typeof document !== "undefined" && createPortal(
          <>
            <div className="fixed inset-0 z-[99]" onClick={() => setOpenMenu(null)} />
            <AnimatePresence>
              {(() => {
                const u = filtered.find((x) => x.id === openMenu);
                if (!u) return null;
                return (
                  <motion.div key="menu"
                    initial={{ opacity: 0, scale: 0.96, y: -2 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
                    style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 100 }}
                    className="w-40 rounded-lg border border-slate-200 bg-white overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button onClick={() => { handleImpersonate(u); setOpenMenu(null); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[11px] font-medium text-violet-600 hover:bg-violet-50 transition-all first:rounded-t-lg">
                      {impersonating === u.id ? <Loader2 className="size-3 animate-spin" /> : <LogIn className="size-3" />}
                      Log In as Tenant
                    </button>
                    <button onClick={() => { setFlagsUser(u); setOpenMenu(null); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-all">
                      <Sliders className="size-3 text-violet-500" /> Feature Flags
                    </button>
                    <button onClick={() => { setEditUser(u); setOpenMenu(null); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-all">
                      <Edit2 className="size-3" /> Edit User
                    </button>
                    <button onClick={() => { toggleAccess(u); setOpenMenu(null); }}
                      className={cn("flex items-center gap-2 w-full px-3 py-2 text-[11px] font-medium transition-all",
                        u.isVerified ? "text-amber-600 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50")}>
                      {toggling === u.id ? <Loader2 className="size-3 animate-spin" /> : u.isVerified ? <ShieldOff className="size-3" /> : <ShieldCheck className="size-3" />}
                      {u.isVerified ? "Block Access" : "Grant Access"}
                    </button>
                    <button onClick={() => { setDelId(u.id); setOpenMenu(null); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[11px] font-medium text-red-500 hover:bg-red-50 transition-all last:rounded-b-lg">
                      <Trash2 className="size-3" /> Delete
                    </button>
                  </motion.div>
                );
              })()}
            </AnimatePresence>
          </>,
          document.body
        )}

        {/* Detail drawer */}
        <AnimatePresence>
          {detail && (
            <div className="fixed inset-0 z-50 flex justify-end">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-900/15 backdrop-blur-[2.5px]" onClick={() => setDetail(null)} />
              <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                className="relative w-full max-w-sm h-full overflow-y-auto bg-white/90 backdrop-blur-xl border-l border-slate-200/80 flex flex-col shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Drawer header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/30 sticky top-0 z-10">
                  <h3 className="text-sm font-semibold text-slate-700">User Profile</h3>
                  <button onClick={() => setDetail(null)} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                    <X className="size-3.5" />
                  </button>
                </div>

                <div className="p-4 space-y-4 flex-1">
                  {/* Avatar + name */}
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-200/40 flex items-center justify-center text-violet-600 text-lg font-bold">
                      {(detail.fullName || detail.email).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-800">{detail.fullName || "—"}</h4>
                      <p className="text-[11px] text-slate-400">{detail.email}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded border", PLAN_COLOR[detail.plan] ?? PLAN_COLOR.free)}>
                          {(PLAN_DISPLAY[detail.plan] ?? detail.plan).toUpperCase()}
                        </span>
                        <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded border",
                          detail.isVerified ? "bg-emerald-50 border-emerald-100 text-emerald-600" : "bg-red-50 border-red-100 text-red-500"
                        )}>
                          {detail.isVerified ? "Active" : "Blocked"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: "Contacts",    value: detail.contacts,      icon: Users },
                      { label: "Convos",      value: detail.conversations, icon: MessageSquare },
                      { label: "Broadcasts",  value: detail.broadcasts,    icon: Radio },
                      { label: "Automations", value: detail.automations,   icon: Zap },
                    ].map((m) => (
                      <div key={m.label} className="rounded-lg border border-slate-100 bg-slate-50/30 p-2 text-center">
                        <p className="text-[8px] text-slate-400 font-semibold uppercase tracking-wide">{m.label}</p>
                        <p className="text-sm font-semibold text-slate-700 mt-0.5">{m.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Subscription status */}
                  {detail.subscriptionExpiresAt && (
                    <div className="rounded-lg border border-slate-100 bg-slate-50/30 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Subscription</p>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">Expires</span>
                          <span className={cn("font-medium",
                            (() => { const d = daysUntil(detail.subscriptionExpiresAt); return d !== null && d <= 7 ? "text-red-500" : d !== null && d <= 30 ? "text-amber-500" : "text-slate-700"; })()
                          )}>
                            {fmtFull(detail.subscriptionExpiresAt)}
                          </span>
                        </div>
                        {(() => {
                          const d = daysUntil(detail.subscriptionExpiresAt);
                          if (d === null) return null;
                          return (
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-400">Remaining</span>
                              <span className={cn("font-medium", d <= 0 ? "text-red-500" : d <= 7 ? "text-amber-500" : "text-emerald-600")}>
                                {d > 0 ? `${d} days` : "Expired"}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Account info */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Account</p>
                    {[
                      { label: "Business",   value: detail.businessName || "—" },
                      { label: "Role",       value: detail.role },
                      { label: "Access",     value: detail.isVerified ? "✓ Granted" : "✗ Blocked" },
                      { label: "Joined",     value: fmt(detail.createdAt) },
                      { label: "Updated",    value: fmt(detail.updatedAt) },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">{r.label}</span>
                        <span className="font-medium text-slate-700">{r.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* WhatsApp info */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">WhatsApp</p>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Status</span>
                      <span className={cn("font-medium", detail.waConnected ? "text-emerald-600" : "text-slate-400")}>
                        {detail.waStatus}
                      </span>
                    </div>
                  </div>

                  {/* Tenant / Subscription */}
                  {detail.tenantName && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Workspace</p>
                      {[
                        { label: "Tenant",  value: detail.tenantName },
                        { label: "Plan",    value: (PLAN_DISPLAY[detail.plan] ?? detail.plan).toUpperCase() },
                        { label: "Active",  value: detail.tenantActive ? "Yes" : "No" },
                      ].map((r) => (
                        <div key={r.label} className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">{r.label}</span>
                          <span className="font-medium text-slate-700">{r.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="space-y-1.5 pt-2">
                    <button onClick={() => handleImpersonate(detail)} disabled={impersonating === detail.id}
                      className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
                      {impersonating === detail.id ? <Loader2 className="size-3 animate-spin" /> : <LogIn className="size-3" />}
                      Log In as Tenant
                    </button>
                    <button onClick={() => { setEditUser(detail); setDetail(null); }}
                      className="w-full py-2 rounded-lg bg-violet-50 hover:bg-violet-100 border border-violet-100 text-violet-600 text-[11px] font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
                      <Edit2 className="size-3" /> Edit User & Subscription
                    </button>
                    <button onClick={() => setFlagsUser(detail)}
                      className="w-full py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-[11px] font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
                      <Sliders className="size-3 text-violet-500" /> Feature Flags
                    </button>
                    <button onClick={() => toggleAccess(detail)} disabled={toggling === detail.id}
                      className={cn("w-full py-2 rounded-lg border text-[11px] font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1.5",
                        detail.isVerified
                          ? "bg-amber-50 border-amber-100 text-amber-600 hover:bg-amber-100"
                          : "bg-emerald-50 border-emerald-100 text-emerald-600 hover:bg-emerald-100"
                      )}>
                      {toggling === detail.id ? <Loader2 className="size-3 animate-spin" /> : detail.isVerified ? <ShieldOff className="size-3" /> : <ShieldCheck className="size-3" />}
                      {detail.isVerified ? "Block Dashboard Access" : "Grant Dashboard Access"}
                    </button>
                    <button onClick={() => { setDelId(detail.id); setDetail(null); }}
                      className="w-full py-2 rounded-lg bg-red-50 hover:bg-red-100 border border-red-100 text-red-500 text-[11px] font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
                      <Trash2 className="size-3" /> Delete User
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {/* Delete confirm */}
          {delId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-900/15 backdrop-blur-[2.5px]" onClick={() => setDelId(null)} />
              <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                className="relative w-full max-w-xs rounded-xl border border-slate-200/80 bg-white/85 backdrop-blur-xl p-5 space-y-3 shadow-xl shadow-slate-900/10"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto">
                  <Trash2 className="size-5 text-red-500" />
                </div>
                <div className="text-center">
                  <h3 className="text-sm font-semibold text-slate-800">Delete User?</h3>
                  <p className="text-[11px] text-slate-400 mt-1">Permanently removes this user and all their data. This cannot be undone.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setDelId(null)} className="flex-1 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-500 hover:bg-slate-50 active:scale-[0.98] transition-all">Cancel</button>
                  <button onClick={() => handleDelete(delId)} className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-medium active:scale-[0.98] transition-all">Delete</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Feature Flags Modal */}
        <AnimatePresence>
          {flagsUser && (
            <FeatureFlagsModal
              user={flagsUser}
              onSave={() => {
                setFlagsUser(null);
                load();
              }}
              onClose={() => setFlagsUser(null)}
            />
          )}
        </AnimatePresence>

        {/* Add/Edit User Modal */}
        <AnimatePresence>
          {editUser !== null && (
            <UserModal
              user={editUser === "new" ? null : editUser}
              onSave={load}
              onClose={() => setEditUser(null)}
            />
          )}
        </AnimatePresence>
    </div>
  );
}
