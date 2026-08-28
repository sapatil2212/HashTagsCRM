import { describe, expect, it } from "vitest";

import {
  BILLING_CURRENCY,
  PLANS,
  PLAN_IDS,
  PLAN_LIST,
  addBillingPeriod,
  annualSavingMinor,
  formatAmount,
  getPlanPriceMinor,
  normalizePlanId,
  quote,
  resolveBillingPeriod,
  resolveSetupFeeMinor,
  toMajorUnits,
} from "./plans";

describe("the plan catalogue", () => {
  it("prices the three published tiers exactly as advertised", () => {
    // These are the numbers on the pricing page. If this test fails, either the
    // page is now lying to customers or the gateway is charging the wrong amount.
    expect(getPlanPriceMinor("essential", "monthly")).toBe(1_900);
    expect(getPlanPriceMinor("essential", "annual")).toBe(19_000);
    expect(getPlanPriceMinor("growth", "monthly")).toBe(3_900);
    expect(getPlanPriceMinor("growth", "annual")).toBe(39_000);
    expect(getPlanPriceMinor("managed", "monthly")).toBe(9_900);
    expect(getPlanPriceMinor("managed", "annual")).toBe(99_000);
  });

  it("charges a one-time setup fee on Growth and Managed only", () => {
    expect(PLANS.essential.setupFeeMinor).toBe(0);
    expect(PLANS.growth.setupFeeMinor).toBe(3_900);
    expect(PLANS.managed.setupFeeMinor).toBe(9_900);
  });

  it("prices annual at ten months of the monthly rate", () => {
    for (const plan of PLAN_LIST) {
      expect(plan.pricing.annual.priceMinor).toBe(plan.pricing.monthly.priceMinor * 10);
      expect(plan.pricing.annual.listPriceMinor).toBe(plan.pricing.monthly.priceMinor * 12);
      expect(annualSavingMinor(plan.id)).toBe(plan.pricing.monthly.priceMinor * 2);
    }
  });

  it("recommends exactly one plan", () => {
    // The UI badges the recommended plan; two would render two badges, none
    // would leave the picker with no default emphasis.
    expect(PLAN_LIST.filter((plan) => plan.recommended)).toHaveLength(1);
  });

  it("keeps every amount an integer number of minor units", () => {
    for (const plan of PLAN_LIST) {
      for (const cycle of ["monthly", "annual"] as const) {
        expect(Number.isInteger(plan.pricing[cycle].priceMinor)).toBe(true);
      }
      expect(Number.isInteger(plan.setupFeeMinor)).toBe(true);
    }
  });
});

describe("normalizePlanId", () => {
  it("passes current ids through", () => {
    for (const id of PLAN_IDS) expect(normalizePlanId(id)).toBe(id);
  });

  it("translates the plan ids earlier releases wrote", () => {
    expect(normalizePlanId("starter")).toBe("essential");
    expect(normalizePlanId("basic")).toBe("essential");
    expect(normalizePlanId("professional")).toBe("growth");
    expect(normalizePlanId("pro")).toBe("growth");
    expect(normalizePlanId("enterprise")).toBe("managed");
  });

  it("is case and whitespace insensitive", () => {
    expect(normalizePlanId("  Growth ")).toBe("growth");
    expect(normalizePlanId("STARTER")).toBe("essential");
  });

  it("reports no plan rather than inventing a paid tier", () => {
    // `Tenant.plan` defaults to "free". Mapping that to a real tier would grant
    // a paid plan to every unsubscribed tenant.
    expect(normalizePlanId("free")).toBeNull();
    expect(normalizePlanId("")).toBeNull();
    expect(normalizePlanId(null)).toBeNull();
    expect(normalizePlanId(undefined)).toBeNull();
    expect(normalizePlanId("nonsense")).toBeNull();
  });
});

describe("resolveSetupFeeMinor", () => {
  it("charges the fee when nothing has been settled", () => {
    expect(resolveSetupFeeMinor("growth", null)).toBe(3_900);
  });

  it("waives the fee on a renewal of the same tier", () => {
    expect(resolveSetupFeeMinor("growth", "growth")).toBe(0);
  });

  it("charges the new tier's fee when moving between tiers", () => {
    // Guided Setup and Done-for-You are different onboarding work, so an upgrade
    // owes the new tier's fee in full.
    expect(resolveSetupFeeMinor("managed", "growth")).toBe(9_900);
    expect(resolveSetupFeeMinor("growth", "managed")).toBe(3_900);
  });

  it("never charges a fee for a tier that has none", () => {
    expect(resolveSetupFeeMinor("essential", null)).toBe(0);
    expect(resolveSetupFeeMinor("essential", "managed")).toBe(0);
  });

  it("honours a legacy plan id recorded against the settled fee", () => {
    expect(resolveSetupFeeMinor("growth", "professional")).toBe(0);
  });
});

describe("quote", () => {
  it("totals the plan and the setup fee", () => {
    const result = quote({ planId: "growth", billingCycle: "monthly", setupFeePaidPlanId: null });
    expect(result.planAmountMinor).toBe(3_900);
    expect(result.setupFeeMinor).toBe(3_900);
    expect(result.totalMinor).toBe(7_800);
    expect(result.currency).toBe(BILLING_CURRENCY);
  });

  it("omits the setup-fee line entirely when none is owed", () => {
    const result = quote({ planId: "growth", billingCycle: "annual", setupFeePaidPlanId: "growth" });
    expect(result.totalMinor).toBe(39_000);
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0].kind).toBe("plan");
  });

  it("always totals to the sum of its line items", () => {
    // The invoice the customer sees and the amount their card is charged are
    // computed here together, so they cannot drift.
    for (const planId of PLAN_IDS) {
      for (const billingCycle of ["monthly", "annual"] as const) {
        const result = quote({ planId, billingCycle, setupFeePaidPlanId: null });
        const summed = result.lineItems.reduce((total, line) => total + line.amountMinor, 0);
        expect(summed).toBe(result.totalMinor);
      }
    }
  });
});

describe("addBillingPeriod", () => {
  it("advances one month", () => {
    expect(addBillingPeriod(new Date("2026-03-15T10:30:00.000Z"), "monthly").toISOString()).toBe(
      "2026-04-15T10:30:00.000Z",
    );
  });

  it("advances one year", () => {
    expect(addBillingPeriod(new Date("2026-03-15T10:30:00.000Z"), "annual").toISOString()).toBe(
      "2027-03-15T10:30:00.000Z",
    );
  });

  it("clamps to the end of a shorter month instead of rolling over", () => {
    // `setMonth` would produce 3 March here, silently handing the subscriber two
    // extra days and permanently shifting their renewal date.
    expect(addBillingPeriod(new Date("2026-01-31T00:00:00.000Z"), "monthly").toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(addBillingPeriod(new Date("2026-05-31T00:00:00.000Z"), "monthly").toISOString()).toBe(
      "2026-06-30T00:00:00.000Z",
    );
  });

  it("handles a leap year", () => {
    expect(addBillingPeriod(new Date("2028-01-31T00:00:00.000Z"), "monthly").toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
    // 29 February plus a year has no counterpart, so it clamps to the 28th.
    expect(addBillingPeriod(new Date("2028-02-29T00:00:00.000Z"), "annual").toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });

  it("rolls the year over in December", () => {
    expect(addBillingPeriod(new Date("2026-12-15T00:00:00.000Z"), "monthly").toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  it("works entirely in UTC", () => {
    // A renewal boundary that moved with the server's timezone would be the
    // date-handling bug this codebase already fixed once, with money attached.
    const from = new Date("2026-06-30T23:30:00.000Z");
    expect(addBillingPeriod(from, "monthly").getUTCDate()).toBe(30);
    expect(addBillingPeriod(from, "monthly").getUTCHours()).toBe(23);
  });
});

describe("resolveBillingPeriod", () => {
  it("starts a fresh period when there is nothing to extend", () => {
    const paidAt = new Date("2026-04-10T00:00:00.000Z");
    const period = resolveBillingPeriod({ paidAt, cycle: "monthly", currentPeriodEnd: null });
    expect(period.start.toISOString()).toBe(paidAt.toISOString());
    expect(period.end.toISOString()).toBe("2026-05-10T00:00:00.000Z");
  });

  it("extends from the existing period end so paying early costs nothing", () => {
    const period = resolveBillingPeriod({
      paidAt: new Date("2026-04-10T00:00:00.000Z"),
      cycle: "monthly",
      currentPeriodEnd: new Date("2026-04-25T00:00:00.000Z"),
    });
    expect(period.start.toISOString()).toBe("2026-04-25T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-05-25T00:00:00.000Z");
  });

  it("starts fresh when the previous period already lapsed", () => {
    const paidAt = new Date("2026-04-10T00:00:00.000Z");
    const period = resolveBillingPeriod({
      paidAt,
      cycle: "annual",
      currentPeriodEnd: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(period.start.toISOString()).toBe(paidAt.toISOString());
    expect(period.end.toISOString()).toBe("2027-04-10T00:00:00.000Z");
  });
});

describe("amount formatting", () => {
  it("converts minor units to the major-unit decimal Safepay expects", () => {
    expect(toMajorUnits(1_900)).toBe(19);
    expect(toMajorUnits(7_800)).toBe(78);
    expect(toMajorUnits(1_999)).toBe(19.99);
  });

  it("renders whole amounts without decimals, matching the pricing page", () => {
    expect(formatAmount(1_900)).toBe("$19");
    expect(formatAmount(19_000)).toBe("$190");
    expect(formatAmount(9_900)).toBe("$99");
  });

  it("keeps cents when there are any", () => {
    expect(formatAmount(1_999)).toBe("$19.99");
  });
});
