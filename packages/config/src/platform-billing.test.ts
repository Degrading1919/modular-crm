import { describe, expect, it } from "vitest";
import { LOCAL_BILLING_PLANS, readPlatformBillingConfig } from "./platform-billing.ts";
const stripe = { PLATFORM_BILLING_PROVIDER: "stripe", PLATFORM_STRIPE_SECRET_KEY: "sk_test_platform", PLATFORM_STRIPE_WEBHOOK_SECRET: "whsec_platform", PLATFORM_STRIPE_MODE: "test",
  PLATFORM_BILLING_PLANS_JSON: JSON.stringify([{ key: "standard", name: "Standard", seats: 5, capabilities: ["*"], prices: { USD: { monthly: 2500, monthlyPriceId: "price_month", yearly: 25000, yearlyPriceId: "price_year" } } }]) };
describe("operator-owned platform billing configuration", () => {
  it("permits only explicitly priced loopback production smoke mocks", () => {
    const smoke = { NODE_ENV: "production", LOCAL_SMOKE_TEST: "true", PLATFORM_BILLING_PROVIDER: "mock",
      APP_BASE_URL: "http://localhost:3000", PUBLIC_BASE_URL: "http://127.0.0.1:3000", BETTER_AUTH_URL: "http://[::1]:3000",
      PLATFORM_BILLING_PLANS_JSON: JSON.stringify([{ key: "smoke", name: "Smoke", seats: 10, capabilities: ["*"], prices: { USD: { monthly: 100 } } }]) };
    expect(readPlatformBillingConfig(smoke).provider).toBe("mock");
    for (const key of ["APP_BASE_URL", "PUBLIC_BASE_URL", "BETTER_AUTH_URL"]) {
      expect(() => readPlatformBillingConfig({ ...smoke, [key]: "https://example.com" })).toThrow(/PROVIDER/);
      expect(() => readPlatformBillingConfig({ ...smoke, [key]: "http://user:password@localhost" })).toThrow(/PROVIDER/);
    }
    expect(() => readPlatformBillingConfig({ ...smoke, PLATFORM_BILLING_PLANS_JSON: undefined })).toThrow(/PLANS_JSON/);
    expect(() => readPlatformBillingConfig({ ...smoke, PLATFORM_BILLING_PLANS_JSON: JSON.stringify(LOCAL_BILLING_PLANS) })).toThrow(/PLANS_JSON/);
  });
  it("has clearly labeled local examples and a no-card 14-day trial / 7-day grace", () => {
    expect(readPlatformBillingConfig({})).toMatchObject({ provider: "mock", plans: LOCAL_BILLING_PLANS, trialDays: 14, graceDays: 7 });
    expect(LOCAL_BILLING_PLANS.every(plan => plan.placeholder)).toBe(true);
  });
  it("requires deliberate production prices and rejects local examples", () => {
    expect(() => readPlatformBillingConfig({ NODE_ENV: "production" })).toThrow(/PLANS_JSON/);
    expect(() => readPlatformBillingConfig({ ...stripe, NODE_ENV: "production" })).not.toThrow();
    expect(() => readPlatformBillingConfig({ ...stripe, NODE_ENV: "production", PLATFORM_BILLING_PLANS_JSON: JSON.stringify(LOCAL_BILLING_PLANS) })).toThrow();
    expect(() => readPlatformBillingConfig({ NODE_ENV: "production", PLATFORM_BILLING_PROVIDER: "mock" })).toThrow(/PROVIDER/);
  });
  it.each(["PLATFORM_STRIPE_SECRET_KEY", "PLATFORM_STRIPE_WEBHOOK_SECRET", "PLATFORM_STRIPE_MODE"])("requires %s and never exposes values", key => {
    expect(() => readPlatformBillingConfig({ ...stripe, [key]: "private-invalid-value" })).toThrow(/configuration/);
    try { readPlatformBillingConfig({ ...stripe, [key]: "private-invalid-value" }); } catch (error) { expect(String(error)).not.toContain("private-invalid-value"); }
  });
  it("cannot reuse customer-payment credentials or use live credentials locally", () => {
    expect(() => readPlatformBillingConfig({ ...stripe, PAYMENTS_STRIPE_SECRET_KEY: stripe.PLATFORM_STRIPE_SECRET_KEY })).toThrow(/separate/);
    expect(() => readPlatformBillingConfig({ ...stripe, PAYMENTS_STRIPE_WEBHOOK_SECRET: stripe.PLATFORM_STRIPE_WEBHOOK_SECRET })).toThrow(/separate/);
    expect(() => readPlatformBillingConfig({ ...stripe, PLATFORM_STRIPE_MODE: "live", PLATFORM_STRIPE_SECRET_KEY: "sk_live_platform" })).toThrow();
  });
  it.each(["0", "-1", "366", "invalid", "1.5"])("rejects invalid grace/trial duration %s", value => {
    expect(() => readPlatformBillingConfig({ PLATFORM_BILLING_GRACE_DAYS: value })).toThrow();
    expect(() => readPlatformBillingConfig({ PLATFORM_BILLING_TRIAL_DAYS: value })).toThrow();
  });
  it("rejects missing and duplicate price identities", () => {
    expect(() => readPlatformBillingConfig({ ...stripe, PLATFORM_BILLING_PLANS_JSON: stripe.PLATFORM_BILLING_PLANS_JSON.replace('"price_month"', '"price_year"') })).toThrow(/duplicate/);
    expect(() => readPlatformBillingConfig({ ...stripe, PLATFORM_BILLING_PLANS_JSON: stripe.PLATFORM_BILLING_PLANS_JSON.replace('"monthlyPriceId":"price_month",', "") })).toThrow();
  });
});
