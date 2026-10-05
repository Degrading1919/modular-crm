import { ConnectorError, type OnlinePaymentCapability, type OnlinePaymentEvent, type PaymentCapability } from "../types.ts";
import { type ConnectorDefinition } from "../registry.ts";
import { requestJson, type ProviderFetch } from "./http.ts";
import { verifyPaymentSignature } from "./payment-signature.ts";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectorError("provider_error", "Payment service returned an invalid response", false);
  return value as ObjectValue;
}
function reference(value: unknown): string {
  if (typeof value === "object" && value) value = object(value).id;
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,255}$/.test(value)) throw new ConnectorError("provider_error", "Payment reference is invalid", false);
  return value;
}
function amount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ConnectorError("provider_error", "Payment amount is invalid", false);
  return Number(value);
}
function currency(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z]{3}$/i.test(value)) throw new ConnectorError("provider_error", "Payment currency is invalid", false);
  return value.toUpperCase();
}
function stripeUrl(value: unknown, host: string): string {
  if (typeof value !== "string") throw new ConnectorError("provider_error", "Payment page is unavailable", false);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password) throw new ConnectorError("provider_error", "Payment page is unavailable", false);
  return value;
}

export function createStripeOnlinePayments(input: { secretKey: string; webhookSecret: string; accountReference?: string; fetcher?: ProviderFetch; ensureAvailable?: () => void }): OnlinePaymentCapability {
  const fetcher = input.fetcher ?? fetch;
  let account = input.accountReference;
  const call = async (path: string, fields?: Record<string, string>, key?: string, connected = true) => {
    input.ensureAvailable?.();
    if (connected && !account) throw new ConnectorError("not_connected", "Set up online payments first", false);
    if (key !== undefined && (!key.trim() || key.length > 255)) throw new ConnectorError("invalid_request", "Payment retry key is invalid", false);
    return object(await requestJson<unknown>(fetcher, `https://api.stripe.com/v1/${path}`, {
      method: fields ? "POST" : "GET", headers: { Authorization: `Bearer ${input.secretKey}`, "Stripe-Version": "2025-02-24.acacia",
        ...(connected ? { "Stripe-Account": account! } : {}), ...(key ? { "Idempotency-Key": key } : {}),
        ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(fields ? { body: new URLSearchParams(fields) } : {}),
    }));
  };
  return {
    async startOnboarding(value) {
      if (!account) {
        const created = await call("accounts", { type: "standard", "capabilities[card_payments][requested]": "true", "capabilities[transfers][requested]": "true" }, value.idempotencyKey, false);
        account = reference(created.id);
        await value.saveAccount?.(account);
      }
      const link = await call("account_links", { account, type: "account_onboarding", return_url: value.returnUrl, refresh_url: value.refreshUrl }, undefined, false);
      return { accountReference: account, url: stripeUrl(link.url, "connect.stripe.com") };
    },
    async accountStatus() {
      if (!account) throw new ConnectorError("not_connected", "Set up online payments first", false);
      const value = await call(`accounts/${encodeURIComponent(account)}`, undefined, undefined, false);
      const requirements = value.requirements ? object(value.requirements) : {};
      return { accountReference: reference(value.id), chargesEnabled: value.charges_enabled === true,
        detailsNeeded: value.details_submitted !== true || (Array.isArray(requirements.currently_due) && requirements.currently_due.length > 0) };
    },
    async createHostedPage(value) {
      amount(value.amountMinor); currency(value.currency);
      const result = await call("checkout/sessions", { mode: "payment", "payment_method_types[0]": "card",
        "line_items[0][price_data][currency]": value.currency.toLowerCase(), "line_items[0][price_data][unit_amount]": String(value.amountMinor),
        "line_items[0][price_data][product_data][name]": `Invoice ${value.invoiceReference}`, "line_items[0][quantity]": "1",
        success_url: value.returnUrl, cancel_url: value.cancelUrl, expires_at: String(value.expiresAt),
        ...(value.requestReference ? { client_reference_id: reference(value.requestReference), "payment_intent_data[metadata][crm_checkout_request]": reference(value.requestReference) } : {}),
      }, value.idempotencyKey);
      return { reference: reference(result.id), url: stripeUrl(result.url, "checkout.stripe.com") };
    },
    async expireHostedPage(value) { await call(`checkout/sessions/${encodeURIComponent(reference(value))}/expire`, {}); },
    verifyWebhook(value) {
      const event = object(verifyPaymentSignature(value.rawBody, value.signature, input.webhookSecret, value.now));
      if (event.livemode !== input.secretKey.startsWith("sk_live_")) throw new ConnectorError("invalid_request", "Payment notification mode does not match", false);
      // Connected-account notification is authoritative, never tenant/invoice metadata.
      if (typeof event.account !== "string") return null;
      const data = object(object(event.data).object);
      const common = { id: reference(event.id), accountReference: reference(event.account) };
      if (event.type === "payment_intent.payment_failed") {
        const requestReference = data.metadata && object(data.metadata).crm_checkout_request;
        if (typeof requestReference !== "string") return null;
        return { ...common, type: "payment.failed", sessionRequestReference: reference(requestReference), paymentReference: reference(data.id), amountMinor: amount(data.amount), currency: currency(data.currency) };
      }
      if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"].includes(String(event.type))) {
        if (event.type !== "checkout.session.async_payment_failed" && data.payment_status !== "paid") return null;
        return { ...common, type: event.type === "checkout.session.async_payment_failed" ? "payment.failed" : "payment.succeeded",
          sessionReference: reference(data.id), ...(typeof data.client_reference_id === "string" ? { sessionRequestReference: reference(data.client_reference_id) } : {}), paymentReference: reference(data.payment_intent), amountMinor: amount(data.amount_total), currency: currency(data.currency) };
      }
      if (["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"].includes(String(event.type)) && ["succeeded", "failed", "canceled"].includes(String(data.status))) {
        const requestReference = data.metadata && object(data.metadata).crm_refund_request;
        return { ...common, type: data.status === "succeeded" ? "payment.refunded" : "refund.failed", refundReference: reference(data.id), paymentReference: reference(data.payment_intent), amountMinor: amount(data.amount), currency: currency(data.currency),
          ...(typeof requestReference === "string" ? { refundRequestReference: reference(requestReference) } : {}) } satisfies OnlinePaymentEvent;
      }
      return null;
    },
    async requestRefund(value) {
      amount(value.amountMinor);
      const result = await call("refunds", { payment_intent: reference(value.paymentReference), amount: String(value.amountMinor), "metadata[crm_refund_request]": reference(value.requestReference) }, value.idempotencyKey);
      return { reference: reference(result.id), status: "pending" };
    },
  };
}

export function createStripePaymentDefinition(input: { secretKey: string; webhookSecret: string; fetcher?: ProviderFetch }): ConnectorDefinition {
  return {
    manifest: { key: "stripe-online-payments", name: "Stripe", description: "Accept cards securely on your invoices.", provider: "Stripe", icon: "wallet", categories: ["get_paid"], capabilities: ["payments"],
      authType: "service_account", guidedPayments: true, requiredScopes: [], environments: ["local", "test", "production"], setupComplexity: "guided", discoverableResources: [], webhookSupport: true, syncModes: [], version: "1.0.0", availability: "credentials_ready" },
    createConfiguredScope(control) {
      const unavailable = async (): Promise<never> => { throw new ConnectorError("invalid_request", "Use the secure invoice payment page", false); };
      const online = createStripeOnlinePayments({ ...input, accountReference: control.credentials.accountReference, ensureAvailable: control.ensureAvailable });
      const payments: PaymentCapability = { online, createPaymentMethod: unavailable, charge: unavailable, refund: unavailable, getPayment: unavailable };
      return { payments };
    },
  };
}
