import { createHmac } from "node:crypto";
import type { BillingNotification, BillingSnapshot } from "@modular-crm/domain";
import type { PlatformBillingConfig } from "@modular-crm/config";
import { ConnectorError } from "./types.ts";
import { verifyPaymentSignature } from "./providers/payment-signature.ts";
import { requestJson, type ProviderFetch } from "./providers/http.ts";
import { ConnectorRegistry, type ConnectorDefinition } from "./registry.ts";

export interface PlatformBillingCapability {
  validatePlans(): Promise<void>;
  createCustomer(input: { tenantId: string; email: string; key: string }): Promise<string>;
  hosted(input: { purpose: "subscribe" | "card" | "portal"; tenantId: string; customerId: string; subscriptionId?: string; priceId?: string; key: string; returnUrl: string; trialEnd: Date; sessionId: string }): Promise<{ id: string; url: string }>;
  verify(rawBody: string, signature: string, now?: Date): BillingNotification | null;
  snapshot(event: BillingNotification, expectedSubscriptionId?: string): Promise<BillingSnapshot>;
}
export function createPlatformBillingDefinition(config: PlatformBillingConfig, fetcher: ProviderFetch = fetch): ConnectorDefinition {
  return { manifest: { key: `platform-billing-${config.provider}`, name: "Plan and billing", provider: config.provider === "stripe" ? "Stripe Billing" : "Local example",
    version: "1.0.0", categories: ["get_paid"], icon: "wallet", requiredScopes: [], environments: ["local", "test", "production"], setupComplexity: "easy", discoverableResources: [], webhookSupport: true, syncModes: [], capabilities: ["platform-billing"], authType: "service_account", availability: "credentials_ready", platformManaged: true,
    description: "Platform-owned workspace subscriptions, separate from customer payments." },
    createConfiguredScope({ ensureAvailable }) {
      const provider = createPlatformBillingProvider(config, fetcher);
      const guarded = Object.fromEntries(Object.entries(provider).map(([key, method]) => [key, (...args: unknown[]) => { ensureAvailable(); return (method as (...args: unknown[]) => unknown)(...args); }]));
      return { "platform-billing": guarded as unknown as PlatformBillingCapability };
    } };
}
/** A separate server-owned registry: never hydrated from tenant connector_installations. */
export function platformBillingService(config: PlatformBillingConfig, fetcher: ProviderFetch = fetch): PlatformBillingCapability {
  const registry = new ConnectorRegistry(); const definition = createPlatformBillingDefinition(config, fetcher);
  registry.register(definition); registry.connectPlatformManaged("platform", definition.manifest.key);
  return registry.getCapability("platform", "platform-billing")!;
}
export const MOCK_PLATFORM_BILLING_SECRET = "local-platform-billing-not-customer-payments";
export function signMockBillingEvent(event: BillingNotification, now = new Date()) {
  const rawBody = JSON.stringify(event), t = Math.floor(now.getTime() / 1000);
  return { rawBody, signature: `t=${t},v1=${createHmac("sha256", MOCK_PLATFORM_BILLING_SECRET).update(`${t}.${rawBody}`).digest("hex")}` };
}
const bad = () => new ConnectorError("provider_error", "Plan and billing service is unavailable. Try again shortly.", true);
function obj(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw bad(); return value as Record<string, unknown>; }
function ref(value: unknown): string { if (value && typeof value === "object") value = obj(value).id; if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,255}$/.test(value)) throw bad(); return value; }
function hostedUrl(value: unknown): string { if (typeof value !== "string") throw bad(); const url = new URL(value); if (url.protocol !== "https:" || !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname) || url.username || url.password) throw bad(); return value; }

/** Platform-owned scope, deliberately never installed as a tenant payment connector. */
export function createPlatformBillingProvider(config: PlatformBillingConfig, fetcher: ProviderFetch = fetch): PlatformBillingCapability {
  if (config.provider === "mock") return {
    async validatePlans() {}, async createCustomer({ tenantId }) { return `mock_platform_${tenantId}`; },
    async hosted({ sessionId }) { return { id: `mock_billing_${sessionId}`, url: `/plan-checkout/${sessionId}` }; },
    verify(raw, signature, now) {
      const event = obj(verifyPaymentSignature(raw, signature, MOCK_PLATFORM_BILLING_SECRET, now));
      if (typeof event.id !== "string" || !event.id.startsWith("platform_") || !Number.isSafeInteger(event.created) || !["invoice.paid", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"].includes(String(event.type))) throw bad();
      ref(event.customerId); ref(event.subscriptionId);
      return event as unknown as BillingNotification;
    },
    async snapshot(event) { if (!event.snapshot) throw bad(); return event.snapshot; },
  };
  const stripe = config.stripe;
  if (!stripe) throw bad();
  const call = async (path: string, fields?: Record<string, string>, key?: string) => obj(await requestJson(fetcher, `https://api.stripe.com/v1/${path}`, {
    method: fields ? "POST" : "GET", headers: { Authorization: `Bearer ${stripe.secretKey}`, "Stripe-Version": "2025-02-24.acacia", ...(key ? { "Idempotency-Key": key } : {}), ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    ...(fields ? { body: new URLSearchParams(fields) } : {}),
  }));
  return {
    async validatePlans() {
      for (const plan of config.plans) for (const [currency, prices] of Object.entries(plan.prices)) for (const interval of ["month", "year"] as const) {
        const amount = interval === "month" ? prices.monthly : prices.yearly;
        if (amount === undefined) continue;
        const priceId = interval === "month" ? prices.monthlyPriceId : prices.yearlyPriceId;
        const price = await call(`prices/${ref(priceId)}`), recurring = obj(price.recurring);
        if (price.active !== true || price.livemode !== (stripe.mode === "live") || price.currency !== currency.toLowerCase() || price.unit_amount !== amount || recurring.interval !== interval || recurring.interval_count !== 1) throw bad();
      }
    },
    async createCustomer({ tenantId, email, key }) { return ref((await call("customers", { email, "metadata[platform_tenant_id]": tenantId }, key)).id); },
    async hosted(input) {
      if (input.purpose === "portal") {
        const fields: Record<string, string> = { customer: input.customerId, return_url: input.returnUrl };
        if (input.priceId) {
          const subscription = await call(`subscriptions/${ref(input.subscriptionId)}`), items = obj(subscription.items).data;
          if (ref(subscription.customer) !== input.customerId || subscription.livemode !== (stripe.mode === "live") || !Array.isArray(items) || items.length !== 1) throw bad();
          fields["flow_data[type]"] = "subscription_update_confirm";
          fields["flow_data[subscription_update_confirm][subscription]"] = ref(input.subscriptionId);
          fields["flow_data[subscription_update_confirm][items][0][id]"] = ref(obj(items[0]).id);
          fields["flow_data[subscription_update_confirm][items][0][quantity]"] = "1";
          fields["flow_data[subscription_update_confirm][items][0][price]"] = ref(input.priceId);
          fields["flow_data[after_completion][type]"] = "redirect";
          fields["flow_data[after_completion][redirect][return_url]"] = input.returnUrl;
        }
        const page = await call("billing_portal/sessions", fields, input.key);
        return { id: ref(page.id), url: hostedUrl(page.url) };
      }
      const fields: Record<string, string> = { customer: input.customerId, mode: input.purpose === "card" ? "setup" : "subscription", success_url: input.returnUrl, cancel_url: input.returnUrl,
        "payment_method_types[0]": "card", "metadata[platform_tenant_id]": input.tenantId };
      if (input.purpose === "subscribe") {
        fields["line_items[0][price]"] = ref(input.priceId); fields["line_items[0][quantity]"] = "1";
        fields["subscription_data[metadata][platform_tenant_id]"] = input.tenantId;
        // Checkout requires a >=48h trial. Never charge before the promised trial ends.
        if (input.trialEnd.getTime() > Date.now()) fields["subscription_data[trial_end]"] = String(Math.ceil(Math.max(input.trialEnd.getTime(), Date.now() + 48 * 3600000 + 60000) / 1000));
      } else {
        fields["setup_intent_data[metadata][platform_customer_id]"] = input.customerId;
        if (input.subscriptionId) fields["setup_intent_data[metadata][platform_subscription_id]"] = input.subscriptionId;
      }
      const page = await call("checkout/sessions", fields, input.key);
      return { id: ref(page.id), url: hostedUrl(page.url) };
    },
    verify(raw, signature, now) {
      const event = obj(verifyPaymentSignature(raw, signature, stripe.webhookSecret, now));
      if (event.account || event.livemode !== (stripe.mode === "live")) throw new ConnectorError("invalid_request", "Billing notification could not be verified.", false); // Never accept connected-account tenant payments.
      const type = String(event.type), payload = obj(obj(event.data).object);
      if (!["invoice.paid", "invoice.payment_failed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "checkout.session.completed"].includes(type)) return null;
      if (!Number.isSafeInteger(event.created)) throw bad();
      return { id: ref(event.id), created: Number(event.created), type, customerId: ref(payload.customer), subscriptionId: type.startsWith("customer.subscription") ? ref(payload.id) : type === "checkout.session.completed" && payload.mode === "setup" ? `setup:${ref(payload.setup_intent)}` : ref(payload.subscription),
        ...(type === "checkout.session.completed" ? { hostedSessionReference: ref(payload.id) } : {}) };
    },
    async snapshot(event, expectedSubscriptionId) {
      let subscriptionId = event.subscriptionId;
      if (subscriptionId.startsWith("setup:")) {
        const intent = await call(`setup_intents/${ref(subscriptionId.slice(6))}`), metadata = obj(intent.metadata);
        if (intent.status !== "succeeded" || ref(intent.customer) !== event.customerId || metadata.platform_customer_id !== event.customerId) throw bad();
        subscriptionId = ref(metadata.platform_subscription_id);
        // A delayed setup page must not change a canceled/replaced subscription's card.
        if (expectedSubscriptionId && subscriptionId !== expectedSubscriptionId) throw new ConnectorError("invalid_request", "This card page belongs to an earlier subscription.", false);
        const method = ref(intent.payment_method);
        await call(`customers/${event.customerId}`, { "invoice_settings[default_payment_method]": method }, `platform-card:${event.id}`);
        await call(`subscriptions/${subscriptionId}`, { default_payment_method: method }, `platform-card-sub:${event.id}`);
        const invoices = await call(`invoices?customer=${event.customerId}&subscription=${subscriptionId}&status=open&limit=1`);
        const invoice = (invoices.data as unknown[])?.[0];
        if (invoice) await call(`invoices/${ref(obj(invoice).id)}/pay`, {}, `platform-recover:${event.id}`);
      }
      const sub = await call(`subscriptions/${ref(subscriptionId)}`);
      if (ref(sub.customer) !== event.customerId || sub.livemode !== (stripe.mode === "live")) throw bad();
      const items = obj(sub.items).data;
      if (!Array.isArray(items) || items.length !== 1) throw bad();
      const price = obj(obj(items[0]).price), recurring = obj(price.recurring);
      const status = sub.status === "trialing" ? "trialing" : sub.status === "active" ? "active" : ["canceled", "incomplete_expired"].includes(String(sub.status)) ? "canceled" : sub.status === "unpaid" || sub.status === "paused" ? "read_only" : "past_due";
      return { customerId: ref(sub.customer), subscriptionId: ref(sub.id), status, priceId: ref(price.id), currency: String(price.currency).toUpperCase(), interval: recurring.interval === "year" ? "year" : "month",
        ...(typeof sub.current_period_end === "number" ? { periodEnd: new Date(sub.current_period_end * 1000).toISOString() } : {}), ...(typeof sub.trial_end === "number" ? { trialEnd: new Date(sub.trial_end * 1000).toISOString() } : {}) };
    },
  };
}
