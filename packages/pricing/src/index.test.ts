import { describe, expect, it } from "vitest";
import { evaluatePrice, snapshotPriceResult, type PriceRule } from "./index.ts";

const context = { tenantId: "t1", currency: "USD", at: "2026-09-23T00:00:00Z", serviceId: "cleanup", quantity: 2, frequency: "weekly", zoneId: "outer", selectedAddOnIds: ["deodorizer"], couponCode: "WELCOME", fields: { dogs: 2 } };
const rule = (id: string, stage: PriceRule["stage"], effect: PriceRule["effect"], extra: Partial<PriceRule> = {}): PriceRule => ({ id, name: id, priority: 1, active: true, source: "tenant", stage, effect, ...extra });

describe("price rules", () => {
  it("selects the highest priority base, composes adjustments, limits coupons and separates tax", () => {
    const rules: PriceRule[] = [
      rule("old-base", "base", { type: "set_base_amount", amountMinor: 1000 }, { priority: 1 }),
      rule("new-base", "base", { type: "set_base_amount", amountMinor: 1500 }, { priority: 2 }),
      rule("dogs", "quantity", { type: "per_unit", amountMinor: 250, quantityField: "dogs", includedUnits: 1 }),
      rule("zone", "zone", { type: "add_fixed", amountMinor: 300 }, { conditions: { field: "zoneId", operator: "equals", value: "outer" } }),
      rule("addon", "add_on", { type: "add_fixed", amountMinor: 200 }, { conditions: { field: "selectedAddOnIds", operator: "contains", value: "deodorizer" } }),
      rule("coupon", "promotion", { type: "subtract_percentage", basisPoints: 1000, maxAmountMinor: 200 }, { coupon: { code: "WELCOME", usageLimit: 10, uses: 2 } }),
      rule("minimum", "bounds", { type: "set_minimum", amountMinor: 1900 }),
    ];
    const result = evaluatePrice({ context, rules, tax: { rateBps: 700 } });
    expect(result.baseAmountMinor).toBe(1500);
    expect(result.subtotalMinor).toBe(2050);
    expect(result.taxMinor).toBe(144);
    expect(result.totalMinor).toBe(2194);
    expect(result.appliedRules.map((item) => item.ruleId)).not.toContain("old-base");
    expect(evaluatePrice({ context, rules: rules.map((r) => r.id === "coupon" ? { ...r, coupon: { code: "WELCOME", usageLimit: 2, uses: 2 } } : r) }).subtotalMinor).toBe(2250);
  });
  it("uses effective dates, quantity tiers, maximums and quote gates", () => {
    const rules = [
      rule("base", "base", { type: "set_base_amount", amountMinor: 1000 }),
      rule("future", "zone", { type: "add_fixed", amountMinor: 500 }, { effectiveFrom: "2026-10-01" }),
      rule("tier", "quantity", { type: "quantity_tier", tiers: [{ minQuantity: 1, maxQuantity: 1, amountMinor: 1000 }, { minQuantity: 2, amountMinor: 1800 }] }),
      rule("max", "bounds", { type: "set_maximum", amountMinor: 1700 }),
      rule("review", "bounds", { type: "mark_quote_required", reason: "Large property needs review" }),
    ];
    const result = evaluatePrice({ context, rules });
    expect(result.totalMinor).toBe(1700);
    expect(result.quoteRequired).toBe(true);
    expect(result.warnings).toContain("Large property needs review");
    expect(evaluatePrice({ context: { ...context, at: "2026-09-30T23:00:00Z" }, rules: [rule("base", "base", { type: "set_base_amount", amountMinor: 1000 }, { effectiveTo: "2026-09-30" })] }).quoteRequired).toBe(false);
  });
  it("requires documented override and freezes a historical snapshot", () => {
    const result = evaluatePrice({ context, rules: [rule("base", "base", { type: "set_base_amount", amountMinor: 1000 })], override: { amountMinor: 900, reason: "Manager approved", actorId: "owner-1", at: context.at } });
    const snapshot = snapshotPriceResult(result, context.at);
    expect(snapshot.result.totalMinor).toBe(900);
    expect(Object.isFrozen(snapshot.result.appliedRules)).toBe(true);
    expect(() => evaluatePrice({ context, rules: [], override: { amountMinor: 900, reason: "", actorId: "owner-1", at: context.at } })).toThrow();
  });
});
