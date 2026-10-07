import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { readPlatformBillingConfig, DEVELOPMENT_AUTH_SECRET } from "@modular-crm/config";
import { applyPlatformBillingEvent, assertBusinessWritable, platformBillingSessions, platformSubscriptions, platformSubscription, startPlatformTrial, sweepPlatformBilling, tenants } from "@modular-crm/db";
import { ConnectorError, platformBillingService, signMockBillingEvent } from "@modular-crm/connectors";
import { DomainError, type BillingNotification } from "@modular-crm/domain";
import { auth } from "../auth";
import { getDb } from "../db";
import { json, readBody } from "./http";
import type { SessionActor } from "./actor";

const config = () => readPlatformBillingConfig(process.env);
const mail = () => ({ secret: process.env.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET, baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000" });
function owner(actor: SessionActor) { if (actor.kind !== "staff" || actor.role !== "owner") throw new DomainError("FORBIDDEN", "Only the business owner can manage the plan.", 403); }
async function notify(event: BillingNotification) {
  const signed = signMockBillingEvent(event);
  const provider = platformBillingService(config());
  const verified = provider.verify(signed.rawBody, signed.signature)!;
  return applyPlatformBillingEvent(getDb(), config(), verified, createHash("sha256").update(signed.rawBody).digest("hex"), () => provider.snapshot(verified), mail());
}
export async function handlePlatformBillingPublic(request: Request, path: string[]): Promise<Response | null> {
  if (path[0] === "platform-admin" && path[1] === "billing") {
    if (request.method !== "GET" || path.length !== 2) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !config().operatorUserIds.includes(session.user.id)) throw new DomainError("FORBIDDEN", "Platform operator access is required.", 403);
    const filter = new URL(request.url).searchParams.get("status");
    const page = Number(new URL(request.url).searchParams.get("page") ?? "0");
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) throw new DomainError("VALIDATION_ERROR", "Choose a valid page.", 422);
    const allowed = ["trialing", "active", "past_due", "read_only", "canceled"];
    if (filter && !allowed.includes(filter)) throw new DomainError("VALIDATION_ERROR", "Choose a billing status.", 422);
    const rows = await getDb().select({ name: tenants.name, tenantId: tenants.id, planKey: platformSubscriptions.planKey, status: platformSubscriptions.status,
      trialEnd: platformSubscriptions.trialEnd, periodEnd: platformSubscriptions.periodEnd, graceEnd: platformSubscriptions.graceEnd }).from(platformSubscriptions).innerJoin(tenants, eq(tenants.id, platformSubscriptions.tenantId))
      .where(filter ? eq(platformSubscriptions.status, filter) : undefined).orderBy(tenants.name, tenants.id).limit(101).offset(page * 100);
    return json({ items: rows.slice(0, 100), hasNext: rows.length > 100, page });
  }
  if (path.join("/") !== "platform-billing/webhook") return null;
  if (request.method !== "POST") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > 1000000) { await reader.cancel(); throw new DomainError("VALIDATION_ERROR", "Billing notification is too large.", 413); } chunks.push(chunk.value); }
  try {
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
    const provider = platformBillingService(config());
    const event = provider.verify(raw, request.headers.get("stripe-signature") ?? request.headers.get("platform-billing-signature") ?? "");
    if (!event) return json({ accepted: true, ignored: true });
    const result = await applyPlatformBillingEvent(getDb(), config(), event, createHash("sha256").update(raw).digest("hex"), expected => provider.snapshot(event, expected), mail());
    return json({ accepted: true, ...result });
  } catch (error) {
    if (error instanceof ConnectorError && error.retryable) throw new DomainError("EXTERNAL_SERVICE_ERROR", "Billing service is temporarily unavailable. The notification was not accepted.", 503);
    if (error instanceof ConnectorError || error instanceof TypeError) throw new DomainError("VALIDATION_ERROR", "Billing notification could not be verified.", 400); throw error;
  }
}

export async function guardBusinessRequest(request: Request, path: string[], actor: SessionActor) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method) || path[0] === "platform-billing" || (path[0] === "exports" && request.method === "POST")) return;
  // Existing customer payment URLs survive suspension; no owner business-edit exemption.
  if (actor.kind === "customer" && path[0] === "portal" && path[1] === "invoices" && path[3] === "checkout") return;
  if (actor.kind === "customer" && path[0] === "payments" && path[1] === "test-checkout") return;
  await assertBusinessWritable(getDb(), actor.tenantId);
}
export async function handlePlatformBilling(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "platform-billing") return null;
  const db = getDb(), settings = config();
  const sub = await startPlatformTrial(db, actor.tenantId, settings);
  if (path.length === 1 && request.method === "GET") {
    const plan = settings.plans.find(plan => plan.key === sub.planKey);
    return json({ item: { planKey: sub.planKey, planName: plan?.name ?? "Free trial", status: sub.status, trialEnd: sub.trialEnd, periodEnd: sub.periodEnd, graceEnd: sub.graceEnd,
      currency: sub.currency, interval: sub.interval, includedSeats: sub.includedSeats, trialDaysLeft: Math.max(0, Math.ceil((sub.trialEnd.getTime() - Date.now()) / 86400000)),
      plans: settings.plans.map(({ key, name, prices, seats, placeholder }) => ({ key, name, seats, placeholder, prices: Object.fromEntries(Object.entries(prices).map(([currency, price]) => [currency, { monthly: price.monthly, yearly: price.yearly }])) })),
      hasSubscription: !!sub.subscriptionId && sub.status !== "canceled", nextBill: plan?.prices[sub.currency]?.[sub.interval === "year" ? "yearly" : "monthly"], canManage: actor.kind === "staff" && actor.role === "owner", mock: settings.provider === "mock" } });
  }
  owner(actor);
  if (path[1] === "hosted" && path.length === 2 && request.method === "POST") {
    const input = await readBody(request, z.object({ purpose: z.enum(["subscribe", "card", "portal"]), planKey: z.string().max(64).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), interval: z.enum(["month", "year"]).optional(), idempotencyKey: z.string().min(8).max(120) }).strict());
    const plan = settings.plans.find(plan => plan.key === (input.planKey ?? sub.planKey));
    const currency = input.currency ?? sub.currency, interval = input.interval ?? sub.interval;
    const price = plan?.prices[currency];
    if (!plan || !price || (interval === "year" && price.yearly === undefined)) throw new DomainError("VALIDATION_ERROR", "Choose an available plan and currency.", 422);
    const provider = platformBillingService(settings);
    if (input.purpose !== "subscribe" && !sub.subscriptionId) throw new DomainError("CONFLICT", "Choose a plan first. No card is needed during your free trial.", 409);
    const customerId = sub.customerId ?? await provider.createCustomer({ tenantId: actor.tenantId, email: actor.email, key: `platform-customer:${actor.tenantId}` });
    await db.update(platformSubscriptions).set({ customerId }).where(and(eq(platformSubscriptions.tenantId, actor.tenantId), isNull(platformSubscriptions.customerId)));
    const session = await db.transaction(async tx => {
      await tx.execute(sql`select tenant_id from platform_subscriptions where tenant_id=${actor.tenantId} for update`);
      const current = (await platformSubscription(tx, actor.tenantId))!;
      const [prior] = await tx.select().from(platformBillingSessions).where(and(eq(platformBillingSessions.tenantId, actor.tenantId), eq(platformBillingSessions.requestKey, input.idempotencyKey))).limit(1);
      if (prior) {
        if (prior.purpose !== input.purpose || prior.planKey !== plan.key || prior.currency !== currency || prior.interval !== interval) throw new DomainError("IDEMPOTENCY_CONFLICT", "This billing retry was already used for a different choice.", 409);
        if (prior.expiresAt <= new Date() || prior.completedAt) throw new DomainError("CONFLICT", "Start a new billing page.", 409);
        return prior;
      }
      if (input.purpose === "subscribe" && current.subscriptionId && current.status !== "canceled") throw new DomainError("CONFLICT", "Use Change plan to update your existing plan.", 409);
      if (input.purpose === "subscribe") {
        const [pending] = await tx.select().from(platformBillingSessions).where(and(eq(platformBillingSessions.tenantId, actor.tenantId), eq(platformBillingSessions.purpose, "subscribe"), isNull(platformBillingSessions.completedAt), gt(platformBillingSessions.expiresAt, new Date()))).limit(1);
        if (pending) { if (pending.planKey === plan.key && pending.currency === currency && pending.interval === interval) return pending; throw new DomainError("CONFLICT", "Finish or wait for your open plan page before choosing another plan.", 409); }
      }
      return (await tx.insert(platformBillingSessions).values({ tenantId: actor.tenantId, purpose: input.purpose, planKey: plan.key, currency, interval, requestKey: input.idempotencyKey, expiresAt: new Date(Date.now() + 24 * 3600000) }).returning())[0]!;
    });
    if (session.createdAt.getTime() < Date.now() - 23 * 3600000) throw new DomainError("CONFLICT", "This billing page needs an operator review before retrying.", 409);
    if (!session.url) {
      const page = await provider.hosted({ purpose: input.purpose, tenantId: actor.tenantId, customerId, subscriptionId: sub.subscriptionId ?? undefined,
        priceId: input.purpose === "portal" && !input.planKey ? undefined : interval === "year" ? price.yearlyPriceId : price.monthlyPriceId, key: `platform-hosted:${session.id}`, returnUrl: new URL("/app/plan-billing?billing=processing", mail().baseUrl).toString(), trialEnd: sub.trialEnd, sessionId: session.id });
      await db.update(platformBillingSessions).set({ url: page.url, providerReference: page.id }).where(and(eq(platformBillingSessions.id, session.id), eq(platformBillingSessions.tenantId, actor.tenantId)));
      return json({ item: { url: page.url } });
    }
    return json({ item: { url: session.url } });
  }
  if (path[1] === "mock" && settings.provider === "mock" && process.env.NODE_ENV !== "production") {
    const action = path[2];
    if (action === "session" && path[3]) {
      const [session] = await db.select().from(platformBillingSessions).where(and(eq(platformBillingSessions.tenantId, actor.tenantId), eq(platformBillingSessions.id, path[3]))).limit(1);
      if (!session || session.expiresAt <= new Date()) throw new DomainError("NOT_FOUND", "Billing page not found.", 404);
      if (request.method === "GET") return json({ item: { purpose: session.purpose, planName: settings.plans.find(plan => plan.key === session.planKey)?.name, completed: !!session.completedAt,
        plans: settings.plans.filter(plan => plan.prices[session.currency] && (session.interval !== "year" || plan.prices[session.currency]?.yearly !== undefined)).map(plan => ({ key: plan.key, name: plan.name })) } });
      if (request.method === "POST") {
        const input = await readBody(request, z.object({ action: z.enum(["pay", "cancel", "change"]), planKey: z.string().optional() }).strict());
        const planKey = input.action === "change" ? input.planKey : session.planKey;
        if (!settings.plans.some(plan => plan.key === planKey)) throw new DomainError("VALIDATION_ERROR", "Choose an available plan.", 422);
        if (session.purpose !== "portal" && input.action !== "pay") throw new DomainError("FORBIDDEN", "Use Change plan to change or cancel your plan.", 403);
        const event = await db.transaction(async tx => {
          await tx.execute(sql`select id from platform_billing_sessions where tenant_id=${actor.tenantId} and id=${session.id} for update`);
          const [latest] = await tx.select().from(platformBillingSessions).where(eq(platformBillingSessions.id, session.id));
          const prior = latest!.metadata.event as BillingNotification | undefined;
          if (prior) {
            if (latest!.metadata.action !== input.action || prior.snapshot?.planKey !== planKey) throw new DomainError("IDEMPOTENCY_CONFLICT", "This billing page was already used for another choice.", 409);
            return prior;
          }
          const event: BillingNotification = { id: `platform_session_${session.id}`, created: Math.floor(Date.now() / 1000), type: input.action === "cancel" ? "customer.subscription.deleted" : "invoice.paid", customerId: sub.customerId!, subscriptionId: sub.subscriptionId ?? `mock_subscription_${session.id}`,
            snapshot: { customerId: sub.customerId!, subscriptionId: sub.subscriptionId ?? `mock_subscription_${session.id}`, planKey, status: input.action === "cancel" ? "canceled" : "active", currency: session.currency, interval: session.interval as "month" | "year", periodEnd: new Date(Date.now() + (session.interval === "year" ? 365 : 30) * 86400000).toISOString() } };
          const [saved] = await tx.update(platformBillingSessions).set({ metadata: { action: input.action, event } }).where(eq(platformBillingSessions.id, session.id)).returning({ metadata: platformBillingSessions.metadata });
          // JSONB has canonical key ordering; hash that representation on first delivery and replay.
          return saved!.metadata.event as BillingNotification;
        });
        await notify(event);
        await db.update(platformBillingSessions).set({ completedAt: new Date() }).where(eq(platformBillingSessions.id, session.id));
        return json({ item: { returnUrl: "/app/plan-billing" } });
      }
    }
    // Explicit local-only simulation, owner authenticated, same signed webhook path; no production clock override.
    if (["fail", "expire-grace"].includes(action ?? "") && request.method === "POST") {
      if (!sub.customerId || !sub.subscriptionId) throw new DomainError("CONFLICT", "Choose a plan first.", 409);
      if (action === "fail") await notify({ id: `platform_failure_${randomUUID()}`, created: Math.floor(Date.now() / 1000), type: "invoice.payment_failed", customerId: sub.customerId, subscriptionId: sub.subscriptionId,
        snapshot: { customerId: sub.customerId, subscriptionId: sub.subscriptionId, planKey: sub.planKey, status: "past_due", currency: sub.currency, interval: sub.interval as "month" | "year" } });
      else if (sub.graceEnd) await sweepPlatformBilling(db, settings, mail(), sub.graceEnd, actor.tenantId);
      return json({ accepted: true });
    }
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
