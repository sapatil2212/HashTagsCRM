"use client";

/**
 * /super-admin/cms — Content Management System
 *
 * Tabs:
 *  1. Branding   → site name, logos, colours, favicon
 *  2. Pricing    → per-plan price overrides, currency, features, setup fees
 *  3. Contact    → email, phone, address, social links
 *  4. SEO        → title, description, OG image
 *  5. Footer     → tagline, privacy/terms, copyright
 *  6. Advanced   → maintenance mode, analytics ID, live chat, custom head
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ChangeEvent,
} from "react";
import {
  Palette,
  DollarSign,
  Phone,
  Search,
  Globe,
  Wrench,
  Upload,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Image as ImageIcon,
  RefreshCw,
  Zap,
  TrendingUp,
  Crown,
  ChevronDown,
  Info,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanOverride, SiteConfigData } from "@/lib/cms/site-config";
import { PLAN_IDS, PLANS, formatAmount, type PlanId } from "@/lib/billing/plans";
import { useSiteConfig, broadcastConfigUpdate } from "@/context/site-config-context";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab =
  | "branding"
  | "pricing"
  | "contact"
  | "seo"
  | "footer"
  | "advanced";

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "branding",  label: "Branding",   icon: Palette    },
  { id: "pricing",   label: "Pricing",    icon: DollarSign },
  { id: "contact",   label: "Contact",    icon: Phone      },
  { id: "seo",       label: "SEO",        icon: Search     },
  { id: "footer",    label: "Footer",     icon: Globe      },
  { id: "advanced",  label: "Advanced",   icon: Wrench     },
];

const PLAN_META: Record<PlanId, { label: string; icon: React.ElementType; color: string }> = {
  essential: { label: "Essential", icon: Zap,        color: "text-orange-500" },
  growth:    { label: "Growth",    icon: TrendingUp,  color: "text-violet-500" },
  managed:   { label: "Managed",   icon: Crown,       color: "text-amber-500"  },
};

const CURRENCIES = [
  { code: "USD", label: "US Dollar ($)" },
  { code: "EUR", label: "Euro (€)" },
  { code: "GBP", label: "British Pound (£)" },
  { code: "PKR", label: "Pakistani Rupee (₨)" },
  { code: "INR", label: "Indian Rupee (₹)" },
  { code: "AED", label: "UAE Dirham (AED)" },
  { code: "SAR", label: "Saudi Riyal (SAR)" },
  { code: "SGD", label: "Singapore Dollar (S$)" },
  { code: "AUD", label: "Australian Dollar (A$)" },
  { code: "CAD", label: "Canadian Dollar (CA$)" },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white p-5 space-y-4", className)}>
      <div>
        <p className="text-xs font-semibold text-slate-800">{title}</p>
        {description && (
          <p className="text-[11px] text-slate-400 mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

const inputCls =
  "h-9 w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 focus:bg-white transition-all";
const labelCls = "block text-[11px] font-medium text-slate-600 mb-1";
const textareaCls =
  "w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 focus:bg-white transition-all resize-none";

function Field({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <label className={cn(labelCls, "mb-0")}>{label}</label>
        {tooltip && (
          <span title={tooltip} className="cursor-help text-slate-400 hover:text-slate-600">
            <Info className="size-3" />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Logo uploader ─────────────────────────────────────────────────────────────

function LogoUploader({
  label,
  kind,
  currentUrl,
  onUploaded,
}: {
  label: string;
  kind: "logo" | "logoDark" | "favicon" | "ogImage";
  currentUrl: string | null;
  onUploaded: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/super-admin/cms/logo?kind=${kind}`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok) {
        onUploaded(data.url);
        broadcastConfigUpdate();
      } else {
        setError(data.error ?? "Upload failed.");
      }
    } catch {
      setError("Network error during upload.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <label className={labelCls}>{label}</label>
      <div className="flex items-start gap-3">
        {/* Preview */}
        <div className="w-20 h-14 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt={label}
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <ImageIcon className="size-5 text-slate-300" />
          )}
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50 transition-all"
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {uploading ? "Uploading\u2026" : "Upload file"}
            </button>
            {currentUrl && (
              <button
                type="button"
                onClick={() => {
                  onUploaded("");
                  broadcastConfigUpdate();
                }}
                className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-[11px] font-medium text-red-600 hover:bg-red-100 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-400">
            PNG, JPEG, WebP or GIF \u00b7 max 4 MB
          </p>
          {error && <p className="text-[10px] text-red-500">{error}</p>}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-medium">Or direct URL / file path:</label>
            <input
              type="text"
              className={cn(inputCls, "h-8 text-[11px]")}
              value={currentUrl ?? ""}
              onChange={(e) => onUploaded(e.target.value)}
              placeholder="e.g. /images/logo/chatnexgen-logo.png or https://..."
            />
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

// ── Plan price editor ─────────────────────────────────────────────────────────

function PlanEditor({
  planId,
  override,
  currency,
  onChange,
}: {
  planId: PlanId;
  override: PlanOverride;
  currency: string;
  onChange: (v: PlanOverride) => void;
}) {
  const meta = PLAN_META[planId];
  const Icon = meta.icon;
  const basePlan = PLANS[planId];
  const [open, setOpen] = useState(true);

  const set = (key: keyof PlanOverride, val: unknown) =>
    onChange({ ...override, [key]: val });

  const featuresStr = (override.features ?? basePlan.features ?? []).join("\n");
  const setFeatures = (str: string) =>
    set("features", str.split("\n").filter(Boolean));

  const effectiveMonthly = override.monthlyMinor ?? basePlan.pricing.monthly.priceMinor;
  const effectiveAnnual = override.annualMinor ?? basePlan.pricing.annual.priceMinor;
  const effectiveSetup = override.setupFeeMinor ?? basePlan.setupFeeMinor;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <span className={cn("flex items-center gap-1.5 text-xs font-semibold flex-1", meta.color)}>
          <Icon className="size-3.5" />
          {override.name || meta.label} Plan
        </span>
        <span className="text-[11px] font-mono font-medium text-slate-500 mr-2">
          {formatAmount(effectiveMonthly, currency)}/mo
        </span>
        <ChevronDown
          className={cn("size-3.5 text-slate-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3">
          {/* Live Preview Badge */}
          <div className="rounded-lg bg-violet-50/70 border border-violet-100 p-2.5 flex items-center justify-between text-xs">
            <span className="text-violet-700 font-medium text-[11px]">Active Plan Preview:</span>
            <span className="font-semibold text-violet-900">
              {formatAmount(effectiveMonthly, currency)}/mo &middot; {formatAmount(effectiveAnnual, currency)}/yr
              {effectiveSetup > 0 && ` (+${formatAmount(effectiveSetup, currency)} setup)`}
            </span>
          </div>

          {/* Display name */}
          <Field label="Display Name">
            <input
              className={inputCls}
              value={override.name ?? ""}
              onChange={(e) => set("name", e.target.value || undefined)}
              placeholder={meta.label}
            />
          </Field>

          {/* Core message */}
          <Field label="Core Message / Subtitle">
            <input
              className={inputCls}
              value={override.coreMessage ?? ""}
              onChange={(e) => set("coreMessage", e.target.value || undefined)}
              placeholder={basePlan.coreMessage}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            {/* Monthly price */}
            <Field
              label={`Monthly Price (${currency} minor units)`}
              tooltip={`Compiled default: ${basePlan.pricing.monthly.priceMinor} (${formatAmount(basePlan.pricing.monthly.priceMinor, currency)})`}
            >
              <input
                type="number"
                min={0}
                className={inputCls}
                value={override.monthlyMinor ?? ""}
                onChange={(e) =>
                  set("monthlyMinor", e.target.value ? parseInt(e.target.value) : undefined)
                }
                placeholder={String(basePlan.pricing.monthly.priceMinor)}
              />
              <p className="text-[10px] text-slate-400 mt-0.5">
                Default: {basePlan.pricing.monthly.priceMinor} ({formatAmount(basePlan.pricing.monthly.priceMinor, currency)})
              </p>
            </Field>

            {/* Annual price */}
            <Field
              label={`Annual Price (${currency} minor units)`}
              tooltip={`Compiled default: ${basePlan.pricing.annual.priceMinor} (${formatAmount(basePlan.pricing.annual.priceMinor, currency)})`}
            >
              <input
                type="number"
                min={0}
                className={inputCls}
                value={override.annualMinor ?? ""}
                onChange={(e) =>
                  set("annualMinor", e.target.value ? parseInt(e.target.value) : undefined)
                }
                placeholder={String(basePlan.pricing.annual.priceMinor)}
              />
              <p className="text-[10px] text-slate-400 mt-0.5">
                Default: {basePlan.pricing.annual.priceMinor} ({formatAmount(basePlan.pricing.annual.priceMinor, currency)})
              </p>
            </Field>
          </div>

          {/* Setup fee */}
          <Field
            label={`One-time Setup Fee (${currency} minor units, 0 = none)`}
            tooltip={`Compiled default: ${basePlan.setupFeeMinor} (${formatAmount(basePlan.setupFeeMinor, currency)})`}
          >
            <input
              type="number"
              min={0}
              className={inputCls}
              value={override.setupFeeMinor ?? ""}
              onChange={(e) =>
                set("setupFeeMinor", e.target.value ? parseInt(e.target.value) : undefined)
              }
              placeholder={String(basePlan.setupFeeMinor)}
            />
            <p className="text-[10px] text-slate-400 mt-0.5">
              Default: {basePlan.setupFeeMinor} ({formatAmount(basePlan.setupFeeMinor, currency)})
            </p>
          </Field>

          {/* Features */}
          <Field label="Feature Bullets (one per line)">
            <textarea
              rows={4}
              className={textareaCls}
              value={featuresStr}
              onChange={(e) => setFeatures(e.target.value)}
              placeholder={"Feature 1\nFeature 2\nFeature 3"}
            />
          </Field>

          {/* Recommended toggle */}
          <div className="flex items-center justify-between pt-1">
            <label className={cn(labelCls, "mb-0")}>Mark as Recommended</label>
            <button
              type="button"
              onClick={() => set("recommended", !override.recommended)}
              className={cn(
                "transition-colors",
                (override.recommended ?? basePlan.recommended) ? "text-violet-600" : "text-slate-300"
              )}
            >
              {(override.recommended ?? basePlan.recommended) ? (
                <ToggleRight className="size-6" />
              ) : (
                <ToggleLeft className="size-6" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CMSPage() {
  const { refreshConfig } = useSiteConfig();
  const [activeTab, setActiveTab] = useState<Tab>("branding");
  const [config, setConfig] = useState<Partial<SiteConfigData>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [loadError, setLoadError] = useState("");

  // Load config on mount
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/super-admin/cms");
        const data = await res.json();
        if (res.ok) {
          setConfig(data.data ?? {});
        } else {
          setLoadError(data.error ?? "Failed to load config.");
        }
      } catch {
        setLoadError("Network error loading config.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const set = useCallback(
    <K extends keyof SiteConfigData>(key: K, val: SiteConfigData[K]) =>
      setConfig((prev) => ({ ...prev, [key]: val })),
    []
  );

  // Save handler
  const handleSave = async () => {
    setSaving(true);
    setSaveState("idle");
    try {
      const res = await fetch("/api/super-admin/cms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok) {
        setConfig(data.data ?? config);
        setSaveState("saved");
        broadcastConfigUpdate();
        await refreshConfig();
        toast.success("CMS configuration saved successfully! Reflected live across the entire portal.");
        setTimeout(() => setSaveState("idle"), 3000);
      } else {
        setSaveState("error");
        toast.error(data.error || "Failed to save CMS configuration.");
      }
    } catch {
      setSaveState("error");
      toast.error("Network error while saving CMS configuration.");
    } finally {
      setSaving(false);
    }
  };

  // Plan override helpers
  const planOverrides: PlanOverride[] = (config.planOverrides as PlanOverride[]) ?? [];
  const getOverride = (planId: PlanId): PlanOverride => {
    return planOverrides.find((o) => o.planId === planId) ?? { planId };
  };
  const setOverride = (planId: PlanId, override: PlanOverride) => {
    const next = planOverrides.filter((o) => o.planId !== planId);
    set("planOverrides", [...next, override] as SiteConfigData["planOverrides"]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="size-6 text-violet-500 animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 flex items-center gap-3">
        <AlertTriangle className="size-5 text-red-500 shrink-0" />
        <div>
          <p className="text-xs font-semibold text-red-700">Failed to load CMS configuration</p>
          <p className="text-[11px] text-red-500 mt-0.5">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-1.5">
            <Globe className="size-4.5 text-violet-500" />
            CMS &amp; Site Configuration
          </h1>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Manage branding, pricing, contact info, and SEO \u2014 changes reflect live immediately.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {saveState === "saved" && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
              <CheckCircle2 className="size-3.5" /> Saved
            </span>
          )}
          {saveState === "error" && (
            <span className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
              <AlertTriangle className="size-3.5" /> Error saving
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            id="cms-save-btn"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold active:scale-[0.98] transition-all"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {saving ? "Saving\u2026" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              id={`cms-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium rounded-t-lg border-b-2 transition-all",
                active
                  ? "border-violet-600 text-violet-700 bg-violet-50/60"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              )}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab: Branding ── */}
      {activeTab === "branding" && (
        <div className="space-y-4">
          <SectionCard
            title="Platform Identity"
            description="The name and tagline used across the portal, emails, and marketing pages."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Platform Name">
                <input
                  className={inputCls}
                  value={config.siteName ?? ""}
                  onChange={(e) => set("siteName", e.target.value)}
                  placeholder="Hashtags CRM"
                />
              </Field>
              <Field label="Tagline">
                <input
                  className={inputCls}
                  value={config.tagline ?? ""}
                  onChange={(e) => set("tagline", e.target.value)}
                  placeholder="WhatsApp CRM for modern businesses"
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            title="Logos"
            description="Upload your light and dark variant logos. Displayed in the sidebar, login, and marketing pages."
          >
            <div className="space-y-5">
              <LogoUploader
                label="Primary Logo (light backgrounds)"
                kind="logo"
                currentUrl={config.logoUrl ?? null}
                onUploaded={(url) => set("logoUrl", url)}
              />
              <div className="border-t border-slate-100" />
              <LogoUploader
                label="Dark Logo (dark sidebars / dark mode)"
                kind="logoDark"
                currentUrl={config.logoDarkUrl ?? null}
                onUploaded={(url) => set("logoDarkUrl", url)}
              />
              <div className="border-t border-slate-100" />
              <LogoUploader
                label="Favicon (32\u00d732 or 64\u00d764 recommended)"
                kind="favicon"
                currentUrl={config.faviconUrl ?? null}
                onUploaded={(url) => set("faviconUrl", url)}
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Brand Colours"
            description="Primary and accent colours used across buttons, highlights, and badges."
          >
            <div className="grid grid-cols-2 gap-4">
              <Field label="Primary Color">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={config.primaryColor ?? "#7c3aed"}
                    onChange={(e) => set("primaryColor", e.target.value)}
                    className="h-9 w-12 rounded-lg border border-slate-200 cursor-pointer bg-white p-0.5"
                  />
                  <input
                    className={cn(inputCls, "flex-1")}
                    value={config.primaryColor ?? "#7c3aed"}
                    onChange={(e) => set("primaryColor", e.target.value)}
                    placeholder="#7c3aed"
                  />
                </div>
              </Field>
              <Field label="Accent Color">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={config.accentColor ?? "#f97316"}
                    onChange={(e) => set("accentColor", e.target.value)}
                    className="h-9 w-12 rounded-lg border border-slate-200 cursor-pointer bg-white p-0.5"
                  />
                  <input
                    className={cn(inputCls, "flex-1")}
                    value={config.accentColor ?? "#f97316"}
                    onChange={(e) => set("accentColor", e.target.value)}
                    placeholder="#f97316"
                  />
                </div>
              </Field>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Tab: Pricing ── */}
      {activeTab === "pricing" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
            <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-800">Live Pricing Impact</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Changes here update what customers see on the pricing page and what Safepay charges \u2014 immediately on save. Verify amounts before saving.
              </p>
            </div>
          </div>

          <SectionCard
            title="Billing Currency"
            description="The ISO-4217 currency code used for all plan prices. Safepay converts to local currency at checkout."
          >
            <Field label="Currency">
              <select
                className={inputCls}
                value={config.billingCurrency ?? "USD"}
                onChange={(e) => set("billingCurrency", e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </SectionCard>

          <SectionCard
            title="Plan Price Overrides"
            description="Override prices and features for each plan. Leave a field empty to keep the compiled default."
          >
            <div className="space-y-3">
              {PLAN_IDS.map((planId) => (
                <PlanEditor
                  key={planId}
                  planId={planId}
                  override={getOverride(planId)}
                  currency={config.billingCurrency ?? "USD"}
                  onChange={(v) => setOverride(planId, v)}
                />
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
              <RefreshCw className="size-3" />
              <span>
                Prices are in minor units (e.g. 1900 = $19.00). Fields left blank use the compiled defaults.
              </span>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Tab: Contact ── */}
      {activeTab === "contact" && (
        <div className="space-y-4">
          <SectionCard
            title="Contact Details"
            description="Shown in email footers, the marketing site, and the support widget."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Support Email">
                <input
                  type="email"
                  className={inputCls}
                  value={config.contactEmail ?? ""}
                  onChange={(e) => set("contactEmail", e.target.value)}
                  placeholder="support@hashtagscrm.com"
                />
              </Field>
              <Field label="Phone Number">
                <input
                  type="tel"
                  className={inputCls}
                  value={config.contactPhone ?? ""}
                  onChange={(e) => set("contactPhone", e.target.value)}
                  placeholder="+92 300 0000000"
                />
              </Field>
              <Field label="Physical Address" tooltip="Shown in email footers (required by CAN-SPAM)">
                <input
                  className={inputCls}
                  value={config.contactAddress ?? ""}
                  onChange={(e) => set("contactAddress", e.target.value)}
                  placeholder="123 Main St, Lahore, Pakistan"
                />
              </Field>
              <Field label="Support / Help Center URL">
                <input
                  type="url"
                  className={inputCls}
                  value={config.supportUrl ?? ""}
                  onChange={(e) => set("supportUrl", e.target.value)}
                  placeholder="https://help.hashtagscrm.com"
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Social Links">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Twitter / X Profile URL">
                <input
                  type="url"
                  className={inputCls}
                  value={config.twitterUrl ?? ""}
                  onChange={(e) => set("twitterUrl", e.target.value)}
                  placeholder="https://twitter.com/hashtagscrm"
                />
              </Field>
              <Field label="LinkedIn Page URL">
                <input
                  type="url"
                  className={inputCls}
                  value={config.linkedinUrl ?? ""}
                  onChange={(e) => set("linkedinUrl", e.target.value)}
                  placeholder="https://linkedin.com/company/hashtagscrm"
                />
              </Field>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Tab: SEO ── */}
      {activeTab === "seo" && (
        <div className="space-y-4">
          <SectionCard
            title="Search Engine Optimisation"
            description="Meta tags used when the site is indexed. The OG image is shown when links are shared on social media."
          >
            <div className="space-y-3">
              <Field label="Meta Title" tooltip="Keep under 60 characters">
                <input
                  className={inputCls}
                  value={config.metaTitle ?? ""}
                  onChange={(e) => set("metaTitle", e.target.value)}
                  placeholder="Hashtags CRM \u2014 WhatsApp CRM"
                  maxLength={120}
                />
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {(config.metaTitle ?? "").length} / 60 recommended
                </p>
              </Field>

              <Field label="Meta Description" tooltip="Keep under 160 characters">
                <textarea
                  rows={3}
                  className={textareaCls}
                  value={config.metaDescription ?? ""}
                  onChange={(e) => set("metaDescription", e.target.value)}
                  placeholder="Manage WhatsApp conversations, contacts, and automations in one powerful CRM."
                  maxLength={320}
                />
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {(config.metaDescription ?? "").length} / 160 recommended
                </p>
              </Field>

              <LogoUploader
                label="Open Graph / Social Share Image (1200\u00d7630 recommended)"
                kind="ogImage"
                currentUrl={config.ogImageUrl ?? null}
                onUploaded={(url) => set("ogImageUrl", url)}
              />
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Tab: Footer ── */}
      {activeTab === "footer" && (
        <div className="space-y-4">
          <SectionCard
            title="Footer Content"
            description="Text and links rendered in the marketing site and app footer."
          >
            <div className="space-y-3">
              <Field label="Footer Tagline">
                <input
                  className={inputCls}
                  value={config.footerTagline ?? ""}
                  onChange={(e) => set("footerTagline", e.target.value)}
                  placeholder="\u00a9 Hashtags CRM. All rights reserved."
                />
              </Field>
              <Field label="Copyright Text">
                <input
                  className={inputCls}
                  value={config.copyrightText ?? ""}
                  onChange={(e) => set("copyrightText", e.target.value)}
                  placeholder={`\u00a9 ${new Date().getFullYear()} Hashtags Technology. All rights reserved.`}
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Privacy Policy URL">
                  <input
                    type="url"
                    className={inputCls}
                    value={config.privacyPolicyUrl ?? ""}
                    onChange={(e) => set("privacyPolicyUrl", e.target.value)}
                    placeholder="https://hashtagscrm.com/privacy"
                  />
                </Field>
                <Field label="Terms of Service URL">
                  <input
                    type="url"
                    className={inputCls}
                    value={config.termsUrl ?? ""}
                    onChange={(e) => set("termsUrl", e.target.value)}
                    placeholder="https://hashtagscrm.com/terms"
                  />
                </Field>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Tab: Advanced ── */}
      {activeTab === "advanced" && (
        <div className="space-y-4">
          {/* Maintenance mode */}
          <SectionCard
            title="Maintenance Mode"
            description="Displays a maintenance banner to all visitors while you make changes."
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <div>
                  <p className="text-xs font-medium text-slate-700">Enable Maintenance Mode</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Shows a banner on every page. Does not block API access.
                  </p>
                </div>
                <button
                  type="button"
                  id="maintenance-mode-toggle"
                  onClick={() => set("maintenanceMode", !config.maintenanceMode)}
                  className={cn(
                    "transition-colors",
                    config.maintenanceMode ? "text-red-500" : "text-slate-300"
                  )}
                >
                  {config.maintenanceMode ? (
                    <ToggleRight className="size-7" />
                  ) : (
                    <ToggleLeft className="size-7" />
                  )}
                </button>
              </div>

              <Field label="Maintenance Message">
                <input
                  className={inputCls}
                  value={config.maintenanceMessage ?? ""}
                  onChange={(e) => set("maintenanceMessage", e.target.value)}
                  placeholder="We're performing scheduled maintenance. Back soon!"
                />
              </Field>
            </div>
          </SectionCard>

          {/* Analytics */}
          <SectionCard title="Analytics &amp; Tracking">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Google Analytics / GTM ID"
                tooltip={'e.g. "G-XXXXXXXXXX" or "GTM-XXXXXX"'}
              >
                <input
                  className={inputCls}
                  value={config.analyticsId ?? ""}
                  onChange={(e) => set("analyticsId", e.target.value)}
                  placeholder="G-XXXXXXXXXX"
                />
              </Field>
              <Field
                label="Live Chat Widget ID"
                tooltip="Crisp, Intercom, or Tawk.to site/widget ID"
              >
                <input
                  className={inputCls}
                  value={config.liveChatId ?? ""}
                  onChange={(e) => set("liveChatId", e.target.value)}
                  placeholder="crispwebsiteid or tawk.to ID"
                />
              </Field>
            </div>
          </SectionCard>

          {/* Custom head HTML */}
          <SectionCard
            title="Custom Head HTML"
            description="Injected into the <head> on every page. Use for verification tags, custom fonts, or third-party scripts."
          >
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mb-2 flex items-start gap-2">
              <AlertTriangle className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-700">
                Arbitrary HTML is injected as-is. Incorrect markup can break the entire portal.
                Test in a staging environment first.
              </p>
            </div>
            <textarea
              rows={6}
              className={cn(textareaCls, "font-mono text-[11px]")}
              value={config.customHeadHtml ?? ""}
              onChange={(e) => set("customHeadHtml", e.target.value)}
              placeholder={'<!-- e.g. <meta name="google-site-verification" content="..." /> -->'}
            />
          </SectionCard>
        </div>
      )}

      {/* Bottom Save Bar */}
      <div className="sticky bottom-4 z-20 rounded-xl border border-slate-200 bg-white/95 backdrop-blur-md p-3.5 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {saveState === "saved" && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
              <CheckCircle2 className="size-4" /> Changes saved and broadcasted live!
            </span>
          )}
          {saveState === "error" && (
            <span className="flex items-center gap-1.5 text-xs text-red-600 font-semibold bg-red-50 px-2.5 py-1 rounded-md border border-red-200">
              <AlertTriangle className="size-4" /> Failed to save configuration.
            </span>
          )}
          {saveState === "idle" && (
            <span className="text-xs text-slate-500 font-medium">
              Click &quot;Save Changes&quot; to apply all branding, pricing, and contact updates across the entire portal immediately.
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          id="cms-save-bottom-btn"
          className="flex items-center gap-2 px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-[0.98] transition-all shrink-0 cursor-pointer"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Saving Changes…" : "Save Changes"}
        </button>
      </div>

      <div className="h-6" />
    </div>
  );
}
