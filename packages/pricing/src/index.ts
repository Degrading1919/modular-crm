import { evaluateConditions, type Condition } from "@modular-crm/config";

export type PricingStage = "base" | "quantity" | "zone" | "add_on" | "promotion" | "bounds";
export type PricingEffect =
  | { type: "set_base_amount"; amountMinor: number }
  | { type: "add_fixed" | "subtract_fixed"; amountMinor: number }
  | { type: "add_percentage" | "subtract_percentage"; basisPoints: number; maxAmountMinor?: number }
  | { type: "per_unit"; amountMinor: number; quantityField?: string; includedUnits?: number }
  | { type: "quantity_tier"; tiers: readonly { minQuantity: number; maxQuantity?: number; amountMinor: number }[] }
  | { type: "set_minimum" | "set_maximum"; amountMinor: number }
  | { type: "mark_quote_required"; reason?: string };

export type PriceRule = Readonly<{
  id: string;
  name: string;
  priority: number;
  active: boolean;
  source: "core" | "industry_pack" | "tenant";
  stage?: PricingStage;
  effectiveFrom?: string;
  effectiveTo?: string;
  conditions?: Condition;
  coupon?: { code: string; usageLimit?: number; uses?: number; perCustomerLimit?: number; customerUses?: number };
  effect: PricingEffect;
}>;

export type PriceContext = Readonly<{
  tenantId: string;
  currency: string;
  at: string;
  serviceId: string;
  quantity?: number;
  customerType?: string;
  frequency?: string;
  zoneId?: string;
  selectedAddOnIds?: readonly string[];
  couponCode?: string;
  fields?: Record<string, unknown>;
  [key: string]: unknown;
}>;

export type PriceOverride = Readonly<{ amountMinor: number; reason: string; actorId: string; at: string }>;
export type AppliedPriceRule = Readonly<{ ruleId: string; name: string; stage: PricingStage | "override"; effect: PricingEffect["type"] | "manual_override"; adjustmentMinor: number; resultingAmountMinor: number }>;
export type PriceResult = Readonly<{
  currency: string;
  baseAmountMinor: number;
  subtotalMinor: number;
  adjustmentMinor: number;
  discountMinor: number;
  taxableBasisMinor: number;
  taxMinor: number;
  totalMinor: number;
  quoteRequired: boolean;
  warnings: readonly string[];
  appliedRules: readonly AppliedPriceRule[];
  override?: PriceOverride;
}>;
export type PriceSnapshot = Readonly<{ pricedAt: string; result: PriceResult }>;

const STAGES: readonly PricingStage[] = ["base", "quantity", "zone", "add_on", "promotion", "bounds"];

function stageFor(rule: PriceRule): PricingStage {
  if (rule.stage) return rule.stage;
  switch (rule.effect.type) {
    case "set_base_amount": return "base";
    case "per_unit": case "quantity_tier": return "quantity";
    case "subtract_fixed": case "subtract_percentage": return "promotion";
    case "set_minimum": case "set_maximum": return "bounds";
    default: return "zone";
  }
}

function assertMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative integer in minor units`);
}

function assertBps(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000) throw new Error("basisPoints must be between 0 and 100000");
}

function roundMinor(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 2) throw new Error("Price exceeds supported range");
  return Math.sign(value) * Math.round(Math.abs(value));
}

function effective(rule: PriceRule, at: string): boolean {
  const time = new Date(at).getTime();
  if (!Number.isFinite(time)) throw new Error("Pricing date must be valid");
  const from = rule.effectiveFrom ? new Date(rule.effectiveFrom).getTime() : -Infinity;
  const to = rule.effectiveTo ? new Date(rule.effectiveTo).getTime() + (/^\d{4}-\d{2}-\d{2}$/.test(rule.effectiveTo) ? 86400000 - 1 : 0) : Infinity;
  if (Number.isNaN(from) || Number.isNaN(to)) throw new Error(`Rule ${rule.id} has an invalid effective date`);
  return time >= from && time <= to;
}

function couponEligible(rule: PriceRule, context: PriceContext): boolean {
  if (!rule.coupon) return true;
  const coupon = rule.coupon;
  if (coupon.code.toLowerCase() !== context.couponCode?.trim().toLowerCase()) return false;
  return (coupon.usageLimit === undefined || (coupon.uses ?? 0) < coupon.usageLimit)
    && (coupon.perCustomerLimit === undefined || (coupon.customerUses ?? 0) < coupon.perCustomerLimit);
}

/** Pure, deterministic pricing. All inputs and outputs use currency minor units. */
export function evaluatePrice(input: {
  context: PriceContext;
  rules: readonly PriceRule[];
  tax?: { rateBps: number; exempt?: boolean };
  override?: PriceOverride;
}): PriceResult {
  const { context } = input;
  if (!context.tenantId || !context.serviceId || !/^[A-Z]{3}$/.test(context.currency)) throw new Error("Pricing context needs tenant, service and uppercase ISO currency");
  const quantity = context.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error("Quantity must be a nonnegative integer");
  const applicable = input.rules.filter((rule) => rule.active && effective(rule, context.at) && couponEligible(rule, context) && evaluateConditions(rule.conditions, { current: context as Record<string, unknown>, now: context.at }));
  applicable.sort((a, b) => STAGES.indexOf(stageFor(a)) - STAGES.indexOf(stageFor(b)) || a.priority - b.priority || a.id.localeCompare(b.id));
  const baseRules = applicable.filter((rule) => rule.effect.type === "set_base_amount");
  const chosenBase = baseRules.at(-1);
  const warnings: string[] = [];
  let quoteRequired = !chosenBase;
  if (!chosenBase) warnings.push("No applicable base price; request a quote.");
  let amount = 0;
  let base = 0;
  let discounts = 0;
  const trace: AppliedPriceRule[] = [];
  const apply = (rule: PriceRule, next: number) => {
    const delta = next - amount;
    if (delta < 0) discounts += -delta;
    amount = next;
    trace.push({ ruleId: rule.id, name: rule.name, stage: stageFor(rule), effect: rule.effect.type, adjustmentMinor: delta, resultingAmountMinor: amount });
  };
  for (const rule of applicable) {
    const effect = rule.effect;
    if (effect.type === "set_base_amount") {
      if (rule !== chosenBase) continue;
      assertMoney(effect.amountMinor, rule.id);
      base = effect.amountMinor;
      apply(rule, base);
    } else if (effect.type === "add_fixed" || effect.type === "subtract_fixed") {
      assertMoney(effect.amountMinor, rule.id);
      apply(rule, Math.max(0, amount + (effect.type === "add_fixed" ? effect.amountMinor : -effect.amountMinor)));
    } else if (effect.type === "add_percentage" || effect.type === "subtract_percentage") {
      assertBps(effect.basisPoints);
      if (effect.maxAmountMinor !== undefined) assertMoney(effect.maxAmountMinor, rule.id);
      const adjustment = Math.min(amount * effect.basisPoints / 10000, effect.maxAmountMinor ?? Infinity);
      apply(rule, Math.max(0, amount + (effect.type === "add_percentage" ? adjustment : -adjustment)));
    } else if (effect.type === "per_unit") {
      assertMoney(effect.amountMinor, rule.id);
      if (effect.includedUnits !== undefined && (!Number.isSafeInteger(effect.includedUnits) || effect.includedUnits < 0)) throw new Error(`Rule ${rule.id} has invalid included units`);
      const units = effect.quantityField ? Number(context.fields?.[effect.quantityField] ?? 0) : quantity;
      if (!Number.isSafeInteger(units) || units < 0) throw new Error(`Rule ${rule.id} requires a nonnegative integer quantity`);
      apply(rule, amount + Math.max(0, units - (effect.includedUnits ?? 0)) * effect.amountMinor);
    } else if (effect.type === "quantity_tier") {
      const tier = effect.tiers.find((candidate) => quantity >= candidate.minQuantity && (candidate.maxQuantity === undefined || quantity <= candidate.maxQuantity));
      if (!tier) { quoteRequired = true; warnings.push(`No quantity tier applies for ${rule.name}.`); continue; }
      assertMoney(tier.amountMinor, rule.id);
      apply(rule, tier.amountMinor);
    } else if (effect.type === "set_minimum") {
      assertMoney(effect.amountMinor, rule.id);
      apply(rule, Math.max(amount, effect.amountMinor));
    } else if (effect.type === "set_maximum") {
      assertMoney(effect.amountMinor, rule.id);
      apply(rule, Math.min(amount, effect.amountMinor));
    } else if (effect.type === "mark_quote_required") {
      quoteRequired = true;
      warnings.push(effect.reason ?? `${rule.name} requires review.`);
      apply(rule, amount);
    }
  }
  if (input.override) {
    assertMoney(input.override.amountMinor, "override amount");
    if (!input.override.reason.trim() || !input.override.actorId.trim() || !Number.isFinite(new Date(input.override.at).getTime())) throw new Error("Override requires reason, actor and timestamp");
    const delta = input.override.amountMinor - amount;
    if (delta < 0) discounts += -delta;
    amount = input.override.amountMinor;
    trace.push({ ruleId: "manual-override", name: input.override.reason, stage: "override", effect: "manual_override", adjustmentMinor: delta, resultingAmountMinor: amount });
  }
  const subtotalMinor = roundMinor(amount);
  const taxableBasisMinor = Math.max(0, subtotalMinor);
  const rate = input.tax?.exempt ? 0 : input.tax?.rateBps ?? 0;
  assertBps(rate);
  const taxMinor = roundMinor(taxableBasisMinor * rate / 10000);
  return Object.freeze({ currency: context.currency, baseAmountMinor: base, subtotalMinor, adjustmentMinor: subtotalMinor - base, discountMinor: roundMinor(discounts), taxableBasisMinor, taxMinor, totalMinor: subtotalMinor + taxMinor, quoteRequired, warnings: Object.freeze(warnings), appliedRules: Object.freeze(trace.map((item) => Object.freeze(item))), ...(input.override ? { override: Object.freeze({ ...input.override }) } : {}) });
}

/** Persist this snapshot with the estimate, job or invoice; never recalculate issued history. */
export function snapshotPriceResult(result: PriceResult, pricedAt: string): PriceSnapshot {
  if (!Number.isFinite(new Date(pricedAt).getTime())) throw new Error("Snapshot timestamp must be valid");
  const copy = JSON.parse(JSON.stringify(result)) as PriceResult;
  Object.freeze(copy.warnings);
  copy.appliedRules.forEach(Object.freeze);
  Object.freeze(copy.appliedRules);
  if (copy.override) Object.freeze(copy.override);
  return Object.freeze({ pricedAt, result: Object.freeze(copy) });
}
