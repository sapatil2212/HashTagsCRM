import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, mergeOverrides, type PlanOverride } from "./site-config";
import { quote, PLANS } from "@/lib/billing/plans";

describe("CMS Site Config & Dynamic Pricing", () => {
  it("DEFAULT_CONFIG has correct initial branding and currency", () => {
    expect(DEFAULT_CONFIG.siteName).toBe("Hashtags CRM");
    expect(DEFAULT_CONFIG.billingCurrency).toBe("USD");
    expect(DEFAULT_CONFIG.planOverrides).toEqual([]);
  });

  it("mergeOverrides correctly substitutes prices and features", () => {
    const overrides: PlanOverride[] = [
      {
        planId: "essential",
        monthlyMinor: 2500, // $25
        annualMinor: 25000, // $250
        setupFeeMinor: 500, // $5
        features: ["Custom feature 1", "Custom feature 2"],
        recommended: true,
      },
    ];

    const merged = mergeOverrides(overrides, "USD");

    // essential was overridden
    expect(merged.essential.pricing.monthly.priceMinor).toBe(2500);
    expect(merged.essential.pricing.annual.priceMinor).toBe(25000);
    expect(merged.essential.pricing.annual.listPriceMinor).toBe(30000); // 2500 * 12
    expect(merged.essential.setupFeeMinor).toBe(500);
    expect(merged.essential.features).toEqual(["Custom feature 1", "Custom feature 2"]);
    expect(merged.essential.recommended).toBe(true);

    // growth and managed remain default
    expect(merged.growth.pricing.monthly.priceMinor).toBe(PLANS.growth.pricing.monthly.priceMinor);
    expect(merged.managed.pricing.monthly.priceMinor).toBe(PLANS.managed.pricing.monthly.priceMinor);
  });

  it("quote function respects dynamic catalogue and currency", () => {
    const overrides: PlanOverride[] = [
      {
        planId: "growth",
        monthlyMinor: 5000, // PKR 50.00
        setupFeeMinor: 1000,
      },
    ];

    const customCurrency = "PKR";
    const catalogue = mergeOverrides(overrides, customCurrency);

    const result = quote(
      { planId: "growth", billingCycle: "monthly", setupFeePaidPlanId: null },
      catalogue,
      customCurrency
    );

    expect(result.currency).toBe("PKR");
    expect(result.planAmountMinor).toBe(5000);
    expect(result.setupFeeMinor).toBe(1000);
    expect(result.totalMinor).toBe(6000);
    expect(result.lineItems).toHaveLength(2);
    expect(result.lineItems[0].amountMinor).toBe(5000);
    expect(result.lineItems[1].amountMinor).toBe(1000);
  });
});
