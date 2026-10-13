/**
 * GET  /api/super-admin/cms  — fetch full site config
 * PUT  /api/super-admin/cms  — update site config fields
 *
 * Both endpoints are protected behind the super-admin session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySuperAdminToken } from "@/lib/auth";
import { getSiteConfig, updateSiteConfig } from "@/lib/cms/site-config";

const SESSION_COOKIE = "super_admin_session";

async function requireSuperAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return !!verifySuperAdminToken(token);
}

export async function GET() {
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await getSiteConfig();
  return NextResponse.json({ ok: true, data: config });
}

export async function PUT(req: NextRequest) {
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Strip unknown / dangerous keys — only allow the documented fields.
  const allowed = [
    "siteName", "tagline", "logoUrl", "logoDarkUrl", "faviconUrl",
    "primaryColor", "accentColor",
    "contactEmail", "contactPhone", "contactAddress",
    "supportUrl", "twitterUrl", "linkedinUrl",
    "metaTitle", "metaDescription", "ogImageUrl",
    "planOverrides", "billingCurrency",
    "footerTagline", "privacyPolicyUrl", "termsUrl", "copyrightText",
    "maintenanceMode", "maintenanceMessage",
    "analyticsId", "liveChatId", "customHeadHtml",
  ] as const;

  const sanitised: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) sanitised[key] = body[key];
  }

  try {
    const updated = await updateSiteConfig(sanitised as Parameters<typeof updateSiteConfig>[0]);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    console.error("[cms] update error", err);
    return NextResponse.json({ error: "Failed to save configuration." }, { status: 500 });
  }
}
