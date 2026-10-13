/**
 * GET /api/billing/plans
 *
 * Returns the active plan catalogue merged with any super-admin CMS overrides,
 * along with the configured billing currency.
 */

import { NextResponse } from "next/server";
import { getSiteConfig, mergeOverrides } from "@/lib/cms/site-config";
import { BILLING_CURRENCY } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const config = await getSiteConfig();
  const currency = config.billingCurrency || BILLING_CURRENCY;
  const merged = mergeOverrides(config.planOverrides, currency);

  return NextResponse.json(
    {
      ok: true,
      currency,
      plans: Object.values(merged),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
