/**
 * GET /api/cms/public
 *
 * Public (unauthenticated) endpoint that returns the site branding config
 * needed by the frontend — name, logo URLs, colours, contact info, etc.
 *
 * Pricing overrides are intentionally included so the billing page can always
 * show the currently-configured prices without a separate authenticated call.
 *
 * Sensitive fields (customHeadHtml, analyticsId, etc.) are excluded.
 */

import { NextResponse } from "next/server";
import { getSiteConfig } from "@/lib/cms/site-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const config = await getSiteConfig();

  return NextResponse.json(
    {
      ok: true,
      data: {
        siteName:      config.siteName,
        tagline:       config.tagline,
        logoUrl:       config.logoUrl,
        logoDarkUrl:   config.logoDarkUrl,
        faviconUrl:    config.faviconUrl,
        primaryColor:  config.primaryColor,
        accentColor:   config.accentColor,

        contactEmail:   config.contactEmail,
        contactPhone:   config.contactPhone,
        contactAddress: config.contactAddress,
        supportUrl:     config.supportUrl,
        twitterUrl:     config.twitterUrl,
        linkedinUrl:    config.linkedinUrl,

        metaTitle:       config.metaTitle,
        metaDescription: config.metaDescription,
        ogImageUrl:      config.ogImageUrl,

        planOverrides:   config.planOverrides,
        billingCurrency: config.billingCurrency,

        footerTagline:    config.footerTagline,
        privacyPolicyUrl: config.privacyPolicyUrl,
        termsUrl:         config.termsUrl,
        copyrightText:    config.copyrightText,

        maintenanceMode:    config.maintenanceMode,
        maintenanceMessage: config.maintenanceMessage,

        updatedAt: config.updatedAt,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
