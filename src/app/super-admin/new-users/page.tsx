"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus, Search, Trash2, CheckCircle,
  Loader2, RefreshCw, AlertCircle, FileText, ArrowRight,
  ExternalLink, MailCheck, ShieldAlert
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getPlan, normalizePlanId, type PlanId } from "@/lib/billing/plans";

interface User {
  id: string;
  email: string;
  fullName: string;
  businessName: string;
  businessType: string;
  phoneNumber: string;
  role: string;
  isVerified: boolean;
  isEmailVerified: boolean;
  subscriptionExpiresAt: string | null;
  selectedPlan: string;
  paymentProofAttached: boolean;
  paymentProofUrl: string | null;
  createdAt: string;
}

/**
 * Badge styling per plan, keyed on the catalogue's ids.
 *
 * These were keyed on `starter | growth | managed`, so once the tiers were
 * renamed an Essential signup fell through to the default and rendered with
 * Growth's colours and the raw id as its label. Both the key set and the label
 * now come from `@/lib/billing/plans`, and `normalizePlanId` maps the legacy ids
 * still present on older `User.selectedPlan` rows.
 */
const PLAN_BADGES: Record<PlanId, { bg: string; text: string; border: string }> = {
  essential: { bg: "bg-blue-50",   text: "text-blue-600",   border: "border-blue-100" },
  growth:    { bg: "bg-violet-50", text: "text-violet-600", border: "border-violet-100" },
  managed:   { bg: "bg-amber-50",  text: "text-amber-600",  border: "border-amber-100" },
};

const NO_PLAN_BADGE = { bg: "bg-slate-50", text: "text-slate-500", border: "border-slate-200" };

export default function NewUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/users");
      if (!res.ok) throw new Error("Failed to load users list.");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Filter only unverified users who have completed email verification (OTP verified)
  const pendingUsers = useMemo(() => {
    return users.filter(
      (u) =>
        u.isEmailVerified &&
        !u.isVerified &&
        (u.fullName.toLowerCase().includes(q.toLowerCase()) ||
          u.email.toLowerCase().includes(q.toLowerCase()) ||
          u.businessName?.toLowerCase().includes(q.toLowerCase()))
    );
  }, [users, q]);

  const handleApprove = async (id: string) => {
    setApprovingId(id);
    try {
      const res = await fetch("/api/super-admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isVerified: true }),
      });
      if (!res.ok) throw new Error("Could not approve user.");
      await fetchUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm("Are you sure you want to reject and delete this registration?")) return;
    setRejectingId(id);
    try {
      const res = await fetch(`/api/super-admin/users?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Could not reject user.");
      await fetchUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRejectingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-1.5">
            <UserPlus className="size-4.5 text-violet-500" /> New User Approvals
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Review payments and grant workspace access to new registrants.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 text-[11px] font-medium active:scale-[0.97] transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, email, or business..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/20 transition-all"
          />
        </div>

        <div className="text-[11px] text-amber-600 font-medium px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 flex items-center gap-1 self-start sm:self-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span>{pendingUsers.length} Pending Approval</span>
        </div>
      </div>

      {/* Content */}
      {loading && users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-slate-200">
          <Loader2 className="size-6 text-violet-500 animate-spin" />
          <p className="text-xs text-slate-400 mt-2 font-medium">Loading applications...</p>
        </div>
      ) : pendingUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border border-slate-200 text-center px-4">
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 mb-3">
            <MailCheck className="size-5 text-slate-400" />
          </div>
          <h3 className="text-xs font-semibold text-slate-800">All caught up!</h3>
          <p className="text-[11px] text-slate-400 mt-1 max-w-xs leading-relaxed">
            No new registration applications are currently pending approval.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden bg-white rounded-xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/30 text-slate-400 font-semibold text-[10px] uppercase tracking-wider">
                  <th className="px-3 py-2.5 text-left">Customer</th>
                  <th className="px-3 py-2.5 text-left">Business Info</th>
                  <th className="px-3 py-2.5 text-left">Selected Plan</th>
                  <th className="px-3 py-2.5 text-left">WhatsApp</th>
                  <th className="px-3 py-2.5 text-left">Registered</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                <AnimatePresence>
                  {pendingUsers.map((u) => {
                    const planId = normalizePlanId(u.selectedPlan);
                    const badge = planId ? PLAN_BADGES[planId] : NO_PLAN_BADGE;
                    const planLabel = planId ? (planId === "growth" ? "Pro" : planId === "essential" ? "Starter" : "Enterprise") : "No plan";
                    return (
                      <motion.tr
                        key={u.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="hover:bg-slate-50/50 transition-colors"
                      >
                        {/* Name / Email */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-200/40 flex items-center justify-center text-violet-600 text-xs font-bold shrink-0">
                              {u.fullName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-slate-700 text-xs">{u.fullName}</p>
                              <p className="text-[10px] text-slate-400">{u.email}</p>
                            </div>
                          </div>
                        </td>

                        {/* Business */}
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-slate-700 text-xs">{u.businessName || "—"}</p>
                          <p className="text-[10px] text-slate-400">{u.businessType || "—"}</p>
                        </td>

                        {/* Selected Plan */}
                        <td className="px-3 py-2.5">
                          <span className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border",
                            badge.bg, badge.text, badge.border
                          )}>
                            {planLabel.toUpperCase()}
                          </span>
                        </td>

                        {/* Contact Link */}
                        <td className="px-3 py-2.5">
                          <a
                            href={`https://wa.me/${u.phoneNumber}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-medium text-xs"
                          >
                            {u.phoneNumber || "—"}
                            {u.phoneNumber && <ExternalLink className="size-2.5" />}
                          </a>
                        </td>

                        {/* Registered At */}
                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap text-xs">
                          {new Date(u.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </td>

                        {/* Action Buttons */}
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Approve */}
                            <button
                              onClick={() => handleApprove(u.id)}
                              disabled={approvingId !== null || rejectingId !== null}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold active:scale-[0.98] transition-all disabled:opacity-50"
                            >
                              {approvingId === u.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <CheckCircle className="size-3" />
                              )}
                              Approve
                            </button>

                            {/* Reject */}
                            <button
                              onClick={() => handleReject(u.id)}
                              disabled={approvingId !== null || rejectingId !== null}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 active:scale-[0.98] transition-all disabled:opacity-50"
                              title="Reject & Delete"
                            >
                              {rejectingId === u.id ? (
                                <Loader2 className="size-3 animate-spin text-red-500" />
                              ) : (
                                <Trash2 className="size-3" />
                              )}
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
