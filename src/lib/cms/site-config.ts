/**
 * src/lib/cms/site-config.ts
 *
 * The single point of access for CMS / branding / pricing configuration.
 *
 * At runtime the DB row (id=1) is the source of truth.  Every field has a
 * sensible fallback so the application works out-of-the-box with zero DB rows.
 *
 * Server components and API routes call `getSiteConfig()`.
 * The `/api/cms/public` route exposes a safe subset to client code.
 */

import { prisma } from "@/lib/prisma";
import {
  PLANS,
  BILLING_CURRENCY,
  type PlanId,
  type Plan,
  type BillingCycle,
} from "@/lib/billing/plans";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanOverride {
  planId: PlanId;
  name?: string;
  coreMessage?: string;
  /** Monthly price in minor units (e.g. cents) */
  monthlyMinor?: number;
  /** Annual price in minor units */
  annualMinor?: number;
  /** Annual list price (undiscounted) in minor units — defaults to monthlyMinor*12 */
  annualListMinor?: number;
  /** One-time setup fee in minor units */
  setupFeeMinor?: number;
  features?: string[];
  recommended?: boolean;
}

export interface SiteConfigData {
  // Branding
  siteName: string;
  tagline: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;

  // Contact
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  supportUrl: string;
  twitterUrl: string;
  linkedinUrl: string;

  // SEO
  metaTitle: string;
  metaDescription: string;
  ogImageUrl: string | null;

  // Pricing
  planOverrides: PlanOverride[];
  billingCurrency: string;

  // Footer / Legal
  footerTagline: string;
  privacyPolicyUrl: string;
  termsUrl: string;
  copyrightText: string;

  // Maintenance
  maintenanceMode: boolean;
  maintenanceMessage: string;

  // Integrations
  analyticsId: string;
  liveChatId: string;
  customHeadHtml: string;

  updatedAt: Date | null;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: SiteConfigData = {
  siteName: "Hashtags CRM",
  tagline: "WhatsApp CRM for modern businesses",
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  primaryColor: "#7c3aed",
  accentColor: "#f97316",

  contactEmail: "admin@hashtagscrm.com",
  contactPhone: "+92 316 1122339",
  contactAddress: "Pune, Maharashtra, India",
  supportUrl: "https://hashtagscrm.com/contact-us",
  twitterUrl: "https://twitter.com/hashtagscrm",
  linkedinUrl: "https://linkedin.com/company/hashtagscrm",

  metaTitle: "Hashtags CRM — WhatsApp CRM & Automation Platform",
  metaDescription:
    "Manage WhatsApp conversations, contacts, and automations in one powerful CRM.",
  ogImageUrl: null,

  planOverrides: [],
  billingCurrency: BILLING_CURRENCY,

  footerTagline: "© Hashtags CRM. All rights reserved.",
  privacyPolicyUrl: "/privacy-policy",
  termsUrl: "/terms-and-conditions",
  copyrightText: `© ${new Date().getFullYear()} Hashtags Technology. All rights reserved.`,

  maintenanceMode: false,
  maintenanceMessage: "We're performing scheduled maintenance. Back soon!",

  analyticsId: "",
  liveChatId: "",
  customHeadHtml: "",

  updatedAt: null,
};

// ── DB helpers ────────────────────────────────────────────────────────────────

/** Fetch the config row, falling back to defaults for every missing field. */
export async function getSiteConfig(): Promise<SiteConfigData> {
  try {
    const row = await prisma.siteConfig.findUnique({ where: { id: 1 } });
    if (!row) return DEFAULT_CONFIG;

    return {
      siteName:       row.siteName       ?? DEFAULT_CONFIG.siteName,
      tagline:        row.tagline        ?? DEFAULT_CONFIG.tagline,
      logoUrl:        row.logoUrl        ?? null,
      logoDarkUrl:    row.logoDarkUrl    ?? null,
      faviconUrl:     row.faviconUrl     ?? null,
      primaryColor:   row.primaryColor   ?? DEFAULT_CONFIG.primaryColor,
      accentColor:    row.accentColor    ?? DEFAULT_CONFIG.accentColor,

      contactEmail:   row.contactEmail   ?? DEFAULT_CONFIG.contactEmail,
      contactPhone:   row.contactPhone   ?? DEFAULT_CONFIG.contactPhone,
      contactAddress: row.contactAddress ?? DEFAULT_CONFIG.contactAddress,
      supportUrl:     row.supportUrl     ?? DEFAULT_CONFIG.supportUrl,
      twitterUrl:     row.twitterUrl     ?? DEFAULT_CONFIG.twitterUrl,
      linkedinUrl:    row.linkedinUrl    ?? DEFAULT_CONFIG.linkedinUrl,

      metaTitle:       row.metaTitle       ?? DEFAULT_CONFIG.metaTitle,
      metaDescription: row.metaDescription ?? DEFAULT_CONFIG.metaDescription,
      ogImageUrl:      row.ogImageUrl      ?? null,

      planOverrides:   parsePlanOverrides(row.planOverrides),
      billingCurrency: row.billingCurrency ?? DEFAULT_CONFIG.billingCurrency,

      footerTagline:    row.footerTagline    ?? DEFAULT_CONFIG.footerTagline,
      privacyPolicyUrl: row.privacyPolicyUrl ?? DEFAULT_CONFIG.privacyPolicyUrl,
      termsUrl:         row.termsUrl         ?? DEFAULT_CONFIG.termsUrl,
      copyrightText:    row.copyrightText    ?? DEFAULT_CONFIG.copyrightText,

      maintenanceMode:    row.maintenanceMode,
      maintenanceMessage: row.maintenanceMessage ?? DEFAULT_CONFIG.maintenanceMessage,

      analyticsId:    row.analyticsId    ?? DEFAULT_CONFIG.analyticsId,
      liveChatId:     row.liveChatId     ?? DEFAULT_CONFIG.liveChatId,
      customHeadHtml: row.customHeadHtml ?? DEFAULT_CONFIG.customHeadHtml,

      updatedAt: row.updatedAt,
    };
  } catch (err) {
    console.error("[getSiteConfig] DB query failed, falling back to DEFAULT_CONFIG:", err);
    return DEFAULT_CONFIG;
  }
}

/** Upsert the config row (creates id=1 if it doesn't exist yet). */
export async function updateSiteConfig(
  data: Partial<Omit<SiteConfigData, "updatedAt">>
): Promise<SiteConfigData> {
  const { planOverrides, ...rest } = data;

  await prisma.siteConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      ...rest,
      planOverrides: planOverrides ? JSON.parse(JSON.stringify(planOverrides)) : undefined,
    },
    update: {
      ...rest,
      ...(planOverrides !== undefined
        ? { planOverrides: JSON.parse(JSON.stringify(planOverrides)) }
        : {}),
    },
  });

  return getSiteConfig();
}

// ── Plan catalogue merger ─────────────────────────────────────────────────────

/**
 * Merges DB plan overrides on top of the compiled catalogue.
 * Returns a complete Plan object for every plan id, with any overridden
 * fields substituted in.
 *
 * Call this server-side when building a response that includes pricing; client
 * components that receive the merged catalogue don't need to touch `plans.ts`
 * directly.
 */
export function mergeOverrides(
  overrides: PlanOverride[],
  currency: string = BILLING_CURRENCY
): Record<PlanId, Plan> {
  const merged: Record<string, Plan> = { ...PLANS };

  for (const override of overrides) {
    const base = PLANS[override.planId];
    if (!base) continue;

    const monthlyMinor = override.monthlyMinor ?? base.pricing.monthly.priceMinor;
    const annualMinor  = override.annualMinor  ?? base.pricing.annual.priceMinor;
    const annualList   = override.annualListMinor ?? (monthlyMinor * 12);

    merged[override.planId] = {
      ...base,
      name:         override.name        ?? base.name,
      coreMessage:  override.coreMessage ?? base.coreMessage,
      setupFeeMinor: override.setupFeeMinor ?? base.setupFeeMinor,
      features:      override.features   ?? base.features,
      recommended:   override.recommended ?? base.recommended,
      pricing: {
        monthly: { priceMinor: monthlyMinor, listPriceMinor: monthlyMinor },
        annual:  { priceMinor: annualMinor,  listPriceMinor: annualList  },
      },
    };
  }

  return merged as Record<PlanId, Plan>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePlanOverrides(raw: unknown): PlanOverride[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw as PlanOverride[];
}
