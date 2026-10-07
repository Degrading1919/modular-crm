import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readPlatformBillingConfig } from "@modular-crm/config";
import { createPlatformBillingProvider, platformBillingService, signMockBillingEvent } from "./platform-billing.ts";
import { createMockConnectorRegistry } from "./mocks.ts";
import type { BillingNotification } from "@modular-crm/domain";
const env = { PLATFORM_BILLING_PROVIDER: "stripe", PLATFORM_STRIPE_SECRET_KEY: "sk_test_platform", PLATFORM_STRIPE_WEBHOOK_SECRET: "whsec_platform", PLATFORM_STRIPE_MODE: "test",
  PLATFORM_BILLING_PLANS_JSON: JSON.stringify([{ key: "standard", name: "Standard", seats: 5, capabilities: ["*"], prices: { USD: { monthly: 2500, monthlyPriceId: "price_month" } } }]) };
const event: BillingNotification = { id: "platform_test", customerId: "cus_platform", subscriptionId: "sub_platform", created: 1791331200, type: "invoice.paid", snapshot: { customerId: "cus_platform", subscriptionId: "sub_platform", planKey: "local-standard", status: "active", currency: "USD", interval: "month" } };
function signed(payload: unknown, secret = "whsec_platform") {
  const raw = JSON.stringify(payload), t = Math.floor(Date.now() / 1000);
  return { raw, signature: `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}` };
}
describe("separate platform billing connector", () => {
  it("resolves a platform-managed capability without a tenant payments installation", async () => {
    const provider = platformBillingService(readPlatformBillingConfig({}));
    expect(await provider.createCustomer({ tenantId: "business", email: "owner@example.test", key: "key" })).toBe("mock_platform_business");
    expect(createMockConnectorRegistry().getCapability("business", "platform-billing")).toBeUndefined();
    const page = await provider.hosted({ purpose: "subscribe", tenantId: "business", customerId: "cus_platform", key: "key", returnUrl: "http://localhost:3000", trialEnd: new Date(), sessionId: "page" });
    expect(page.url).toBe("/plan-checkout/page");
  });
  it("rejects customer-payment signatures, raw-body changes and expired platform signatures", () => {
    const provider = createPlatformBillingProvider(readPlatformBillingConfig({})); const signed = signMockBillingEvent(event);
    expect(provider.verify(signed.rawBody, signed.signature)).toEqual(event);
    expect(() => provider.verify(signed.rawBody + " ", signed.signature)).toThrow();
    expect(() => provider.verify(signed.rawBody, signed.signature, new Date(Date.now() + 301000))).toThrow();
    const foreign = createHmac("sha256", "local-mock-payment-secret").update(`0.${signed.rawBody}`).digest("hex");
    expect(() => provider.verify(signed.rawBody, `t=0,v1=${foreign}`)).toThrow();
  });
  it("validates the exact operator price before serving, with no Connect account header", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ active: true, livemode: false, currency: "usd", unit_amount: 2500, recurring: { interval: "month", interval_count: 1 } }));
    const provider = platformBillingService(readPlatformBillingConfig(env), fetcher);
    await provider.validatePlans();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://api.stripe.com/v1/prices/price_month");
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: "Bearer sk_test_platform", "Stripe-Version": "2025-02-24.acacia" });
    expect(fetcher.mock.calls[0]![1]!.headers).not.toHaveProperty("Stripe-Account");
    fetcher.mockResolvedValueOnce(Response.json({ active: true, livemode: false, currency: "usd", unit_amount: 1, recurring: { interval: "month", interval_count: 1 } }));
    await expect(provider.validatePlans()).rejects.toThrow();
  });
  it("opens idempotent hosted subscription, setup and portal pages without card data", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "cs_page", url: "https://checkout.stripe.com/c/pay/page" }));
    const provider = createPlatformBillingProvider(readPlatformBillingConfig(env), fetcher);
    const input = { tenantId: "business", customerId: "cus_platform", subscriptionId: "sub_platform", priceId: "price_month", key: "platform-page-key", returnUrl: "https://crm.example/app/plan-billing", trialEnd: new Date(Date.now() + 86400000), sessionId: "page" };
    await provider.hosted({ ...input, purpose: "subscribe" });
    const fields = new URLSearchParams(String(fetcher.mock.calls[0]![1]!.body));
    expect(fields.get("mode")).toBe("subscription"); expect(fields.get("line_items[0][price]")).toBe("price_month");
    expect(Number(fields.get("subscription_data[trial_end]"))).toBeGreaterThan(Math.floor(input.trialEnd.getTime() / 1000));
    expect(fetcher.mock.calls[0]![1]!.headers).toHaveProperty("Idempotency-Key", input.key);
    await provider.hosted({ ...input, purpose: "card" });
    expect(new URLSearchParams(String(fetcher.mock.calls[1]![1]!.body)).get("setup_intent_data[metadata][platform_subscription_id]")).toBe("sub_platform");
    fetcher.mockResolvedValueOnce(Response.json({ id: "bps_page", url: "https://billing.stripe.com/p/session/page" }));
    await provider.hosted({ ...input, priceId: undefined, purpose: "portal" });
    expect(String(fetcher.mock.calls[2]![0])).toContain("billing_portal/sessions");
  });
  it("uses canonical subscription retrieval and rejects connected-account or wrong-mode events", async () => {
    const payload = { id: "evt_paid", type: "invoice.paid", created: Math.floor(Date.now() / 1000), livemode: false, data: { object: { customer: "cus_platform", subscription: "sub_platform" } } };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "sub_platform", customer: "cus_platform", livemode: false, status: "active", current_period_end: 1793923200, items: { data: [{ price: { id: "price_month", currency: "usd", recurring: { interval: "month" } } }] } }));
    const provider = createPlatformBillingProvider(readPlatformBillingConfig(env), fetcher), accepted = signed(payload);
    const verified = provider.verify(accepted.raw, accepted.signature)!;
    const completed = signed({ ...payload, type: "checkout.session.completed", data: { object: { id: "cs_completed", customer: "cus_platform", subscription: "sub_platform", mode: "subscription" } } });
    expect(provider.verify(completed.raw, completed.signature)).toMatchObject({ hostedSessionReference: "cs_completed", subscriptionId: "sub_platform" });
    expect(await provider.snapshot(verified)).toMatchObject({ status: "active", priceId: "price_month", currency: "USD", subscriptionId: "sub_platform" });
    expect(String(fetcher.mock.calls[0]![0])).toContain("subscriptions/sub_platform");
    for (const extra of [{ account: "acct_tenant" }, { livemode: true }]) {
      const foreign = signed({ ...payload, ...extra }); expect(() => provider.verify(foreign.raw, foreign.signature)).toThrow();
    }
  });
  it("confirms the selected price in the hosted portal, bound to the platform customer", async () => {
    const fetcher = vi.fn<typeof fetch>(async input => String(input).includes("subscriptions/")
      ? Response.json({ customer: "cus_platform", livemode: false, items: { data: [{ id: "si_existing" }] } })
      : Response.json({ id: "bps_change", url: "https://billing.stripe.com/p/change" }));
    const provider = createPlatformBillingProvider(readPlatformBillingConfig(env), fetcher);
    await provider.hosted({ purpose: "portal", tenantId: "business", customerId: "cus_platform", subscriptionId: "sub_platform", priceId: "price_month", key: "change", returnUrl: "https://crm.example/app/plan-billing", trialEnd: new Date(), sessionId: "page" });
    const fields = new URLSearchParams(String(fetcher.mock.calls[1]![1]!.body));
    expect(fields.get("flow_data[type]")).toBe("subscription_update_confirm");
    expect(fields.get("flow_data[subscription_update_confirm][items][0][price]")).toBe("price_month");
    expect(fields.get("flow_data[subscription_update_confirm][items][0][id]")).toBe("si_existing");
    fetcher.mockResolvedValueOnce(Response.json({ customer: "cus_other", livemode: false, items: { data: [{ id: "si_existing" }] } }));
    await expect(provider.hosted({ purpose: "portal", tenantId: "business", customerId: "cus_platform", subscriptionId: "sub_platform", priceId: "price_month", key: "other", returnUrl: "https://crm.example/app/plan-billing", trialEnd: new Date(), sessionId: "other" })).rejects.toThrow();
  });
  it("binds a hosted card update, pays the open bill idempotently and re-reads status", async () => {
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.includes("setup_intents/")) return Response.json({ status: "succeeded", customer: "cus_platform", payment_method: "pm_new", metadata: { platform_customer_id: "cus_platform", platform_subscription_id: "sub_platform" } });
      if (url.includes("invoices?")) return Response.json({ data: [{ id: "in_open" }] });
      if (url.endsWith("subscriptions/sub_platform")) return Response.json({ id: "sub_platform", customer: "cus_platform", livemode: false, status: "active", items: { data: [{ price: { id: "price_month", currency: "usd", recurring: { interval: "month" } } }] } });
      return Response.json({ id: "operation" });
    });
    const provider = createPlatformBillingProvider(readPlatformBillingConfig(env), fetcher);
    await expect(provider.snapshot({ ...event, subscriptionId: "setup:seti_update" }, "sub_replacement")).rejects.toThrow(/earlier subscription/);
    expect(fetcher).toHaveBeenCalledOnce(); // Retrieval only: no default-card mutation or invoice charge.
    fetcher.mockClear();
    expect(await provider.snapshot({ ...event, subscriptionId: "setup:seti_update" })).toMatchObject({ status: "active" });
    expect(fetcher.mock.calls.some(call => String(call[0]).endsWith("invoices/in_open/pay") && (call[1]!.headers as Record<string,string>)["Idempotency-Key"] === "platform-recover:platform_test")).toBe(true);
  });
});
