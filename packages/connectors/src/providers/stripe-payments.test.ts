import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripeOnlinePayments, createStripePaymentDefinition } from "./stripe-payments.ts";
import { createMockOnlinePayments, signMockPaymentEvent } from "./mock-online-payments.ts";
import { ConnectorRegistry } from "../registry.ts";

const now = new Date("2026-10-05T12:00:00Z");
const secretKey = "sk_test_fixture";
const webhookSecret = "whsec_fixture";
function signed(value: unknown, timestamp = Math.floor(now.getTime() / 1000)) {
  const rawBody = JSON.stringify(value);
  return { rawBody, signature: `t=${timestamp},v1=${createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex")}`, now };
}
function completed(overrides = {}) { return { id: "evt_paid", account: "acct_a", livemode: false, type: "checkout.session.completed", data: { object: { id: "cs_a", payment_intent: "pi_a", payment_status: "paid", amount_total: 1200, currency: "usd", ...overrides } } }; }

describe("Stripe hosted payments (fixtures only)", () => {
  it("maps account health notifications without inventing a money event", () => {
    const stripe = createStripeOnlinePayments({ secretKey, webhookSecret });
    expect(stripe.verifyWebhook(signed({ id: "evt_health", account: "acct_a", livemode: false, type: "account.updated", data: { object: { id: "acct_a", charges_enabled: false, details_submitted: true, requirements: { currently_due: ["identity"] } } } }))).toEqual({ id: "evt_health", accountReference: "acct_a", type: "account.updated", chargesEnabled: false, detailsNeeded: true });
  });
  it("uses the provider's default deadline on delayed retries with identical idempotent parameters", async () => {
    const expiresAt = Math.floor(now.getTime() / 1000) + 86400;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: "cs_a", url: "https://checkout.stripe.com/c/pay/example", expires_at: expiresAt }));
    const stripe = createStripeOnlinePayments({ secretKey, webhookSecret, accountReference: "acct_a", fetcher });
    const input = { invoiceReference: "INV-1", amountMinor: 1200, currency: "USD", idempotencyKey: "delayed", returnUrl: "https://crm.example", cancelUrl: "https://crm.example", expiresAt: Math.floor(now.getTime() / 1000) + 60 };
    expect(await stripe.createHostedPage(input)).toMatchObject({ expiresAt });
    await stripe.createHostedPage(input);
    expect(new URLSearchParams(String(fetcher.mock.calls[0]![1]?.body)).has("expires_at")).toBe(false);
    expect(String(fetcher.mock.calls[0]![1]?.body)).toBe(String(fetcher.mock.calls[1]![1]?.body));
  });
  it("verifies the raw signature, account, currency and actually-paid state", () => {
    const stripe = createStripeOnlinePayments({ secretKey, webhookSecret });
    expect(stripe.verifyWebhook(signed(completed()))).toEqual({ id: "evt_paid", accountReference: "acct_a", type: "payment.succeeded", paymentReference: "pi_a", sessionReference: "cs_a", amountMinor: 1200, currency: "USD" });
    expect(stripe.verifyWebhook(signed(completed({ payment_status: "unpaid" })))).toBeNull();
    expect(stripe.verifyWebhook(signed({ ...completed(), account: undefined }))).toBeNull();
  });
  it.each([-301, 301])("rejects stale or future signed deliveries by %s seconds", (offset) => {
    expect(() => createStripeOnlinePayments({ secretKey, webhookSecret }).verifyWebhook(signed(completed(), Math.floor(now.getTime() / 1000) + offset))).toThrow(/verified/);
  });
  it("rejects altered bytes, duplicate timestamps, invalid signatures and mismatched live mode", () => {
    const stripe = createStripeOnlinePayments({ secretKey, webhookSecret });
    const input = signed(completed());
    expect(() => stripe.verifyWebhook({ ...input, rawBody: input.rawBody + " " })).toThrow(/verified/);
    expect(() => stripe.verifyWebhook({ ...input, signature: input.signature + ",t=1" })).toThrow(/verified/);
    expect(() => stripe.verifyWebhook({ ...input, signature: "t=123,v1=short" })).toThrow(/verified/);
    expect(() => stripe.verifyWebhook(signed({ ...completed(), livemode: true }))).toThrow(/mode/);
    expect(stripe.verifyWebhook({ ...input, signature: `${input.signature},v1=${"f".repeat(64)}` })?.id).toBe("evt_paid");
  });
  it("parses successful partial refunds but does not treat pending refunds as final", () => {
    const stripe = createStripeOnlinePayments({ secretKey, webhookSecret });
    const refund = { id: "evt_refund", account: "acct_a", livemode: false, type: "refund.updated", data: { object: { id: "re_a", payment_intent: "pi_a", status: "succeeded", amount: 500, currency: "usd", metadata: { crm_refund_request: "request_a" } } } };
    expect(stripe.verifyWebhook(signed(refund))).toMatchObject({ type: "payment.refunded", refundReference: "re_a", refundRequestReference: "request_a", amountMinor: 500 });
    expect(stripe.verifyWebhook(signed({ ...refund, data: { object: { ...refund.data.object, status: "pending" } } }))).toBeNull();
    expect(stripe.verifyWebhook(signed({ ...refund, type: "refund.failed", data: { object: { ...refund.data.object, status: "failed" } } }))).toMatchObject({ type: "refund.failed", refundReference: "re_a", amountMinor: 500 });
    expect(stripe.verifyWebhook(signed(completed({ client_reference_id: "request_checkout" })))).toMatchObject({ sessionRequestReference: "request_checkout" });
  });
  it("uses Standard hosted onboarding and saves the account before issuing the temporary link", async () => {
    const saveAccount = vi.fn(async () => {});
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "acct_a" })).mockImplementationOnce(async () => {
      expect(saveAccount).toHaveBeenCalledWith("acct_a");
      return Response.json({ url: "https://connect.stripe.com/setup/example" });
    });
    const stripe = createStripeOnlinePayments({ secretKey, webhookSecret, fetcher });
    expect(await stripe.startOnboarding({ returnUrl: "https://crm.example/connections", refreshUrl: "https://crm.example/connections", idempotencyKey: "setup_a", saveAccount })).toEqual({ accountReference: "acct_a", url: "https://connect.stripe.com/setup/example" });
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain("type=standard");
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ "Idempotency-Key": "setup_a" });
  });
  it("maps card-decline notifications only when bound to a checkout request", () => {
    const stripe = createStripeOnlinePayments({ secretKey, webhookSecret });
    const event = { id: "evt_declined", account: "acct_a", livemode: false, type: "payment_intent.payment_failed", data: { object: { id: "pi_a", amount: 1200, currency: "usd", metadata: { crm_checkout_request: "request_a" } } } };
    expect(stripe.verifyWebhook(signed(event))).toMatchObject({ type: "payment.failed", sessionRequestReference: "request_a", paymentReference: "pi_a", amountMinor: 1200 });
    expect(stripe.verifyWebhook(signed({ ...event, data: { object: { ...event.data.object, metadata: {} } } }))).toBeNull();
  });
  it("readiness distinguishes an enabled account from outstanding account details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "acct_a", charges_enabled: true, details_submitted: true, requirements: { currently_due: ["business_profile.url"] } }));
    const stripe = createStripeOnlinePayments({ secretKey, webhookSecret, accountReference: "acct_a", fetcher });
    expect(await stripe.accountStatus()).toEqual({ accountReference: "acct_a", chargesEnabled: true, detailsNeeded: true });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.stripe.com/v1/accounts/acct_a");
  });
  it("creates card-only direct-charge checkout using the server amount and stable retry key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "cs_a", url: "https://checkout.stripe.com/c/pay/example" }));
    const stripe = createStripeOnlinePayments({ secretKey, webhookSecret, accountReference: "acct_a", fetcher });
    await stripe.createHostedPage({ invoiceReference: "INV-1", amountMinor: 1200, currency: "USD", idempotencyKey: "checkout_a", returnUrl: "https://crm.example/portal/billing", cancelUrl: "https://crm.example/portal/billing", expiresAt: 1800000000 });
    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({ "Stripe-Account": "acct_a", "Idempotency-Key": "checkout_a" });
    const fields = new URLSearchParams(String(request?.body));
    expect(fields.get("line_items[0][price_data][unit_amount]")).toBe("1200");
    expect(fields.get("payment_method_types[0]")).toBe("card");
    expect(fields.get("line_items[0][price_data][currency]")).toBe("usd");
  });
  it("submits partial refunds under the same account and defers ledger confirmation to the webhook", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "re_a", status: "succeeded" }));
    const stripe = createStripeOnlinePayments({ secretKey, webhookSecret, accountReference: "acct_a", fetcher });
    expect(await stripe.requestRefund({ paymentReference: "pi_a", amountMinor: 500, idempotencyKey: "refund_a", requestReference: "request_a" })).toEqual({ reference: "re_a", status: "pending" });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ "Stripe-Account": "acct_a", "Idempotency-Key": "refund_a" });
    expect(new URLSearchParams(String(fetcher.mock.calls[0]?.[1]?.body)).get("metadata[crm_refund_request]")).toBe("request_a");
  });
  it("rejects untrusted checkout URLs and unsupported direct card entry", async () => {
    const registry = new ConnectorRegistry();
    registry.register(createStripePaymentDefinition({ secretKey, webhookSecret, fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "cs_a", url: "https://attacker.example/pay" })) }));
    registry.connectGuidedPayments("tenant_a", "stripe-online-payments", { accountReference: "acct_a" });
    const payments = registry.getCapability("tenant_a", "payments")!;
    await expect(payments.charge({ paymentMethodReference: "card", amountMinor: 100, currency: "USD", idempotencyKey: "x" })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(payments.online.createHostedPage({ invoiceReference: "INV-1", amountMinor: 100, currency: "USD", idempotencyKey: "x", returnUrl: "https://crm.example", cancelUrl: "https://crm.example", expiresAt: 1800000000 })).rejects.toMatchObject({ code: "provider_error" });
    expect(registry.getCapability("tenant_b", "payments")).toBeUndefined();
  });
  it("mock hosted references are stable, account-isolated and notifications use the same signed contract", async () => {
    const a = createMockOnlinePayments("a", () => {});
    const b = createMockOnlinePayments("b", () => {});
    const input = { invoiceReference: "INV-1", amountMinor: 100, currency: "USD", idempotencyKey: "page", returnUrl: "http://localhost:3000/portal/billing", cancelUrl: "http://localhost:3000/portal/billing", expiresAt: 1800000000 };
    const first = await a.createHostedPage(input);
    expect(await a.createHostedPage(input)).toEqual(first);
    expect((await b.createHostedPage(input)).reference).not.toBe(first.reference);
    const event = { id: "mock_evt", accountReference: (await a.accountStatus()).accountReference, type: "payment.succeeded" as const, paymentReference: "mock_payment", sessionReference: first.reference, amountMinor: 100, currency: "USD" };
    expect(a.verifyWebhook({ ...signMockPaymentEvent(event, now), now })).toEqual(event);
  });
});
