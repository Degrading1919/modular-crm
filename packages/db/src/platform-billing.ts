import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PlatformBillingConfig } from "@modular-crm/config";
import { billingReadOnly, billingTransition, DomainError, type BillingNotification, type BillingSnapshot } from "@modular-crm/domain";
import type { Database } from "./client.ts";
import { memberships, outboundMessages, platformBillingEvents, platformBillingSessions, platformSubscriptions, roleTemplates, user, tenants } from "./schema/index.ts";
import { sealAccountEmail } from "./account-email.ts";

export type BillingExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Explicit upgrade backfill: one trial per legacy tenant, never reset on restart. */
export async function initializePlatformTrials(db: Database, config: PlatformBillingConfig, now = new Date()) {
  const businesses = await db.select({ id: tenants.id }).from(tenants);
  for (const business of businesses) await startPlatformTrial(db, business.id, config, now);
}
export async function startPlatformTrial(db: BillingExecutor, tenantId: string, config: PlatformBillingConfig, now = new Date()) {
  const plan = config.plans[0]!;
  await db.insert(platformSubscriptions).values({ tenantId, planKey: plan.key, status: "trialing", provider: config.provider, includedSeats: plan.seats, capabilities: [...plan.capabilities],
    currency: Object.keys(plan.prices)[0]!, trialEnd: new Date(now.getTime() + config.trialDays * 86400000), createdAt: now }).onConflictDoNothing();
  return (await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.tenantId, tenantId)).limit(1))[0]!;
}
export async function platformSubscription(db: BillingExecutor, tenantId: string) {
  return (await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.tenantId, tenantId)).limit(1))[0];
}
export async function assertBusinessWritable(db: BillingExecutor, tenantId: string) {
  const sub = await platformSubscription(db, tenantId);
  if (sub && billingReadOnly(sub.status)) throw new DomainError("BILLING_REQUIRED", "Your workspace is read-only. Update your card or choose a plan in Plan and billing. You can still view and export your data.", 402);
}
export async function billingNotice(db: BillingExecutor, tenantId: string, kind: string, reference: string, secret: string, baseUrl: string, now: Date) {
  const owners = await db.select({ email: user.email, userId: user.id }).from(memberships)
    .innerJoin(roleTemplates, eq(memberships.roleTemplateId, roleTemplates.id)).innerJoin(user, eq(memberships.userId, user.id))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), eq(roleTemplates.key, "owner")));
  const subject = kind === "trial-ending" ? "Your free trial is ending" : kind === "payment-failed" ? "Your plan payment needs attention" : "Your workspace is read-only";
  for (const owner of owners) await db.insert(outboundMessages).values({ tenantId, channel: "email", category: "account", recipient: owner.email, renderedSubject: subject,
    renderedBody: sealAccountEmail(`${subject}. Your data is safe. View your workspace, export your data, or update billing here: ${new URL("/app/plan-billing", baseUrl)}`, secret),
    templateKey: `platform-billing-${kind}`, idempotencyKey: `platform-billing:${kind}:${reference}:${owner.userId}`, status: "queued", queuedAt: now })
    .onConflictDoNothing({ target: [outboundMessages.tenantId, outboundMessages.idempotencyKey] });
}
function staleBillingEvent(current: typeof platformSubscriptions.$inferSelect, config: PlatformBillingConfig, event: BillingNotification, occurredAt: Date) {
  const differentSubscription = current.subscriptionId && !event.subscriptionId.startsWith("setup:") && event.subscriptionId !== current.subscriptionId;
  return (config.provider === "mock" && current.lastEventAt !== null && occurredAt < current.lastEventAt)
    || !!(differentSubscription && (current.status !== "canceled"
      || (current.lastEventAt && occurredAt < current.lastEventAt)
      || !["customer.subscription.created", "checkout.session.completed"].includes(event.type)));
}
/** Serialize provider reconciliation independently of the row lock required by business writes. */
export async function applyPlatformBillingEvent(db: Database, config: PlatformBillingConfig, event: BillingNotification, payloadHash: string,
  resolve: (expectedSubscriptionId?: string) => Promise<BillingSnapshot>, mail: { secret: string; baseUrl: string }, now = new Date()) {
  return db.transaction(async tx => {
    const [sub] = await tx.select().from(platformSubscriptions).where(and(eq(platformSubscriptions.provider, config.provider), eq(platformSubscriptions.customerId, event.customerId))).limit(1);
    if (!sub) return { ignored: true, duplicate: false };
    // Only other billing notifications take this transaction-scoped lock. Business
    // write guards take FOR SHARE on the subscription row, never this advisory lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`platform-billing:${sub.tenantId}`}, 0))`);
    let current = (await platformSubscription(tx, sub.tenantId))!;
    const [prior] = await tx.select().from(platformBillingEvents).where(and(eq(platformBillingEvents.provider, config.provider), eq(platformBillingEvents.eventId, event.id))).limit(1);
    if (prior) {
      if (prior.payloadHash !== payloadHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "This billing notification changed after processing.", 409);
      return { duplicate: true, ignored: false };
    }
    const occurredAt = new Date(event.created * 1000);
    let stale = staleBillingEvent(current, config, event, occurredAt);
    const snapshot = stale ? undefined : await resolve(current.subscriptionId ?? undefined);
    // A sweep or hosted operation can change the binding while retrieval is pending.
    // Re-read and validate after taking the short mutation lock; never resurrect a
    // retired subscription or extend a grace period from a stale pre-network read.
    await tx.execute(sql`select tenant_id from platform_subscriptions where tenant_id=${sub.tenantId} for update`);
    current = (await platformSubscription(tx, sub.tenantId))!;
    stale = stale || staleBillingEvent(current, config, event, occurredAt)
      || current.provider !== config.provider || current.customerId !== event.customerId;
    if (!stale) {
      if (!snapshot) throw new DomainError("CONFLICT", "The billing notification could not be resolved.", 409);
      if (snapshot.customerId !== event.customerId || (current.subscriptionId && snapshot.subscriptionId !== current.subscriptionId && current.status !== "canceled")) throw new DomainError("CONFLICT", "This billing notification does not match the subscription.", 409);
      const plan = config.plans.find(plan => config.provider === "mock" ? plan.key === snapshot.planKey : Object.values(plan.prices).some(price => price.monthlyPriceId === snapshot.priceId || price.yearlyPriceId === snapshot.priceId));
      const price = plan?.prices[snapshot.currency];
      const expectedPriceId = snapshot.interval === "year" ? price?.yearlyPriceId : price?.monthlyPriceId;
      if (!plan || !price || !["month", "year"].includes(snapshot.interval) || (snapshot.interval === "year" && price.yearly === undefined)
        || (config.provider === "stripe" && expectedPriceId !== snapshot.priceId) || [snapshot.periodEnd, snapshot.trialEnd].some(value => value !== undefined && !Number.isFinite(Date.parse(value)))
        || !["trialing", "active", "past_due", "read_only", "canceled"].includes(snapshot.status)) throw new DomainError("CONFLICT", "The billing plan needs an operator review.", 409);
      const transition = billingTransition(current, snapshot.status, now, config.graceDays);
      await tx.update(platformSubscriptions).set({ ...transition, subscriptionId: snapshot.subscriptionId, planKey: plan.key, includedSeats: plan.seats, capabilities: [...plan.capabilities],
        currency: snapshot.currency, interval: snapshot.interval, ...(snapshot.periodEnd ? { periodEnd: new Date(snapshot.periodEnd) } : {}), ...(snapshot.trialEnd ? { trialEnd: new Date(snapshot.trialEnd) } : {}),
        lastEventAt: occurredAt > (current.lastEventAt ?? new Date(0)) ? occurredAt : current.lastEventAt, updatedAt: now }).where(eq(platformSubscriptions.tenantId, sub.tenantId));
      if (transition.status === "past_due" && current.status !== "past_due") await billingNotice(tx, sub.tenantId, "payment-failed", transition.pastDueAt!.toISOString(), mail.secret, mail.baseUrl, now);
      if (billingReadOnly(transition.status) && !billingReadOnly(current.status)) await billingNotice(tx, sub.tenantId, "read-only", event.id, mail.secret, mail.baseUrl, now);
      if (event.type === "checkout.session.completed" && event.hostedSessionReference) {
        await tx.update(platformBillingSessions).set({ completedAt: now, updatedAt: now }).where(and(
          eq(platformBillingSessions.tenantId, sub.tenantId), eq(platformBillingSessions.providerReference, event.hostedSessionReference)));
      }
    }
    await tx.insert(platformBillingEvents).values({ tenantId: sub.tenantId, provider: config.provider, eventId: event.id, type: event.type, occurredAt, payloadHash, outcome: stale ? "stale" : "applied" });
    return { duplicate: false, ignored: stale };
  });
}
/** Scheduled once/minute. Idempotent notices and grace transitions survive process restarts. */
export async function sweepPlatformBilling(db: Database, config: PlatformBillingConfig, mail: { secret: string; baseUrl: string }, now = new Date(), tenantId?: string) {
  const subscriptions = await db.select().from(platformSubscriptions).where(and(inArray(platformSubscriptions.status, ["trialing", "past_due"]), tenantId ? eq(platformSubscriptions.tenantId, tenantId) : undefined));
  for (const sub of subscriptions) await db.transaction(async tx => {
    await tx.execute(sql`select tenant_id from platform_subscriptions where tenant_id=${sub.tenantId} for update`);
    const current = (await platformSubscription(tx, sub.tenantId))!;
    if (current.status === "trialing" && current.trialEnd.getTime() - now.getTime() <= 3 * 86400000) await billingNotice(tx, sub.tenantId, "trial-ending", current.trialEnd.toISOString(), mail.secret, mail.baseUrl, now);
    if (current.status === "trialing" && current.trialEnd <= now) {
      const change = billingTransition(current, "past_due", current.trialEnd, config.graceDays);
      await tx.update(platformSubscriptions).set({ ...change, updatedAt: now }).where(eq(platformSubscriptions.tenantId, sub.tenantId));
      await billingNotice(tx, sub.tenantId, "payment-failed", current.trialEnd.toISOString(), mail.secret, mail.baseUrl, now);
    }
    const latest = (await platformSubscription(tx, sub.tenantId))!;
    if (latest.status === "past_due" && latest.graceEnd && latest.graceEnd <= now) {
      await tx.update(platformSubscriptions).set({ status: "read_only", updatedAt: now }).where(eq(platformSubscriptions.tenantId, sub.tenantId));
      const eventId = `grace:${sub.tenantId}:${latest.graceEnd.toISOString()}`;
      await tx.insert(platformBillingEvents).values({ tenantId: sub.tenantId, provider: "platform", eventId, type: "grace.expired", occurredAt: now, payloadHash: createHash("sha256").update(eventId).digest("hex"), outcome: "applied" }).onConflictDoNothing();
      await billingNotice(tx, sub.tenantId, "read-only", eventId, mail.secret, mail.baseUrl, now);
    }
  });
}
