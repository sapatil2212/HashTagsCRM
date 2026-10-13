"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Settings, Shield, Bell, Key, Server, Globe, CheckCircle, ArrowRight, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSiteConfig, broadcastConfigUpdate } from "@/context/site-config-context";

const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 focus:bg-white transition-all";
const labelCls = "block text-[11px] font-medium text-slate-600 mb-1";

export default function SuperAdminSettingsPage() {
  const { config, refreshConfig } = useSiteConfig();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifyNewUser,   setNotifyNewUser]   = useState(true);
  const [notifyChurn,     setNotifyChurn]     = useState(true);
  const [notifyTrial,     setNotifyTrial]     = useState(false);
  const [agencyName,      setAgencyName]      = useState(config.siteName || "Hashtags CRM");
  const [supportEmail,    setSupportEmail]    = useState(config.contactEmail || "admin@hashtagscrm.com");
  const [siteUrl,         setSiteUrl]         = useState(process.env.NEXT_PUBLIC_SITE_URL ?? "https://crm.example.com");

  useEffect(() => {
    if (config.siteName) setAgencyName(config.siteName);
    if (config.contactEmail) setSupportEmail(config.contactEmail);
  }, [config.siteName, config.contactEmail]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/cms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteName: agencyName.trim(),
          contactEmail: supportEmail.trim(),
        }),
      });
      if (res.ok) {
        broadcastConfigUpdate();
        await refreshConfig();
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-1.5">
          <Settings className="size-4.5 text-violet-500" /> Settings
        </h1>
        <p className="mt-0.5 text-[11px] text-slate-400">Configure super admin portal preferences and branding.</p>
      </div>

      {/* Quick Link to CMS */}
      <div className="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-purple-50 p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-600 text-white flex items-center justify-center shrink-0">
            <Palette className="size-4.5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-violet-950">Full CMS &amp; Branding Studio</p>
            <p className="text-[11px] text-violet-700 mt-0.5">
              Change logos, plan prices, currency, contact cards, SEO tags, and maintenance mode.
            </p>
          </div>
        </div>
        <Link
          href="/super-admin/cms"
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold shrink-0 transition-colors shadow-xs"
        >
          Open CMS Studio <ArrowRight className="size-3" />
        </Link>
      </div>

      {/* Credentials card */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
          <Key className="size-3.5 text-violet-500" /> Super Admin Credentials
        </p>
        <div className="rounded-lg bg-slate-50/50 border border-slate-200 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium text-[11px]">Username / Email</span>
            <code className="text-violet-600 font-mono text-[11px] bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded">
              {process.env.NEXT_PUBLIC_SITE_URL ? "Set via env" : "SUPER_ADMIN_USERNAME"}
            </code>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium text-[11px]">Password</span>
            <code className="text-violet-600 font-mono text-[11px] bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded">
              SUPER_ADMIN_PASSWORD
            </code>
          </div>
          <p className="text-[10px] text-slate-400 pt-2 border-t border-slate-200 mt-2">
            Credentials are set via environment variables. Edit your <code className="text-violet-600 font-mono font-semibold">.env.local</code> file to change them — no code changes needed.
          </p>
        </div>
      </div>

      {/* Agency details */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
          <Shield className="size-3.5 text-violet-500" /> Platform &amp; Agency Details
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Platform / Agency Name</label>
            <input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} className={inputCls} placeholder="Hashtags CRM" />
          </div>
          <div>
            <label className={labelCls}>Support Email</label>
            <input type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} className={inputCls} placeholder="admin@hashtagscrm.com" />
          </div>
        </div>
      </div>

      {/* Platform */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
          <Globe className="size-3.5 text-violet-500" /> Platform
        </p>
        <div>
          <label className={labelCls}>Site URL</label>
          <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://yourcrm.com" className={inputCls} />
          <p className="text-[10px] text-slate-400 mt-1">Set via <code className="text-violet-600 font-mono">NEXT_PUBLIC_SITE_URL</code> env var for permanent changes.</p>
        </div>
      </div>

      {/* Notifications */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
          <Bell className="size-3.5 text-violet-500" /> Notifications
        </p>
        <div className="space-y-2.5">
          {[
            { label: "New user signup",    sub: "Get notified when a new user registers",       val: notifyNewUser, set: setNotifyNewUser },
            { label: "Client churn alert", sub: "Alert when a client account becomes inactive", val: notifyChurn,   set: setNotifyChurn   },
            { label: "Trial expiry",       sub: "Alert 2 days before a trial expires",          val: notifyTrial,   set: setNotifyTrial   },
          ].map((n) => (
            <div key={n.label} className="flex items-center justify-between py-1">
              <div>
                <p className="text-xs font-medium text-slate-700">{n.label}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{n.sub}</p>
              </div>
              <button
                type="button"
                onClick={() => n.set(!n.val)}
                className={cn(
                  "relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0",
                  n.val ? "bg-violet-600" : "bg-slate-300"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200",
                  n.val ? "translate-x-4" : "translate-x-0"
                )} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* System info */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
        <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
          <Server className="size-3.5 text-violet-500" /> System Info
        </p>
        <div className="space-y-1.5">
          {[
            { label: "Auth Cookie",    value: "super_admin_session" },
            { label: "Session TTL",    value: "8 hours" },
            { label: "Route Prefix",   value: "/super-admin" },
            { label: "API Prefix",     value: "/api/super-admin" },
          ].map((r) => (
            <div key={r.label} className="flex items-center justify-between text-xs py-0.5">
              <span className="text-slate-500 text-[11px] font-medium">{r.label}</span>
              <code className="text-violet-600 font-mono text-[11px] bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded">{r.value}</code>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-1 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-[11px] font-semibold active:scale-[0.98] transition-all"
        >
          <CheckCircle className="size-3" />
          {saving ? "Saving..." : saved ? "Saved Settings ✓" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
