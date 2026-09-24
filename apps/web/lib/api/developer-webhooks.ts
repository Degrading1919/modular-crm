import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { and, desc, eq, ne } from "drizzle-orm";
import { auditEvents, domainEvents, webhookDeliveries, webhookSubscriptions } from "@modular-crm/db";
import { DomainError, sealSecret } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import type { SessionActor } from "./actor";
import { json, readBody } from "./http";

const EVENT_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*(?:\.\*)?$/;

export const createWebhookBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: z.string().trim().min(1).max(2_000),
  events: z.array(z.string().trim().min(1).max(200)).min(1).max(100)
    .transform((events) => [...new Set(events)])
    .refine((events) => events.every((event) => event === "*" || EVENT_PATTERN.test(event)), "Choose valid event names or patterns."),
}).strict();

const testEventBodySchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
}).strict();

type OwnerActor = SessionActor & { kind: "staff"; role: "owner"; membershipId: string };

function requireOwner(actor: SessionActor): asserts actor is OwnerActor {
  if (actor.kind !== "staff" || actor.role !== "owner" || !actor.membershipId) {
    throw new DomainError("FORBIDDEN", "Only a business owner can manage webhook endpoints.", 403);
  }
}

function webhookUrl(raw: string): URL {
  let endpoint: URL;
  try { endpoint = new URL(raw); }
  catch { throw new DomainError("VALIDATION_ERROR", "Enter a valid HTTPS endpoint URL.", 422); }
  const host = endpoint.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash
    || !host || isIP(host) || host === "localhost" || host.endsWith(".localhost")
    || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new DomainError("VALIDATION_ERROR", "Webhook endpoints must use HTTPS and a public hostname without URL credentials or fragments.", 422);
  }
  return endpoint;
}

function endpointSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function publicSubscription(row: {
  id: string; name: string; url: string; eventPatterns: string[]; status: string;
  createdAt: Date; lastSuccessAt: Date | null; lastFailureAt: Date | null;
}) {
  return {
    id: row.id, name: row.name, url: row.url, events: [...row.eventPatterns], status: row.status,
    createdAt: row.createdAt, lastSuccessAt: row.lastSuccessAt, lastFailureAt: row.lastFailureAt,
  };
}

export async function listDeveloperWebhookSubscriptions(tenantId: string) {
  const rows = await getDb().select({
    id: webhookSubscriptions.id, name: webhookSubscriptions.name, url: webhookSubscriptions.url,
    eventPatterns: webhookSubscriptions.eventPatterns, status: webhookSubscriptions.status,
    createdAt: webhookSubscriptions.createdAt, lastSuccessAt: webhookSubscriptions.lastSuccessAt,
    lastFailureAt: webhookSubscriptions.lastFailureAt,
  }).from(webhookSubscriptions).where(eq(webhookSubscriptions.tenantId, tenantId))
    .orderBy(desc(webhookSubscriptions.createdAt)).limit(100);
  return rows.map(publicSubscription);
}

async function createSubscription(request: Request, actor: OwnerActor): Promise<Response> {
  const body = await readBody(request, createWebhookBodySchema);
  const endpoint = webhookUrl(body.url);
  const signingSecret = endpointSecret();
  const key = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!key) throw new Error("WEBHOOK_SECRET_ENCRYPTION_KEY is required to register webhook endpoints");
  const envelope = sealSecret(signingSecret, key);
  const created = await getDb().transaction(async (tx) => {
    const [row] = await tx.insert(webhookSubscriptions).values({
      tenantId: actor.tenantId,
      name: body.name || endpoint.hostname,
      url: endpoint.toString(),
      eventPatterns: body.events,
      secretReference: envelope,
      status: "active",
      createdByMembershipId: actor.membershipId,
    }).returning({
      id: webhookSubscriptions.id, name: webhookSubscriptions.name, url: webhookSubscriptions.url,
      eventPatterns: webhookSubscriptions.eventPatterns, status: webhookSubscriptions.status,
      createdAt: webhookSubscriptions.createdAt, lastSuccessAt: webhookSubscriptions.lastSuccessAt,
      lastFailureAt: webhookSubscriptions.lastFailureAt,
    });
    if (!row) throw new Error("The webhook endpoint could not be created");
    await tx.insert(auditEvents).values({
      tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId,
      action: "developer.webhook_subscription_created", entityType: "webhook_subscription", entityId: row.id,
      afterData: { name: row.name, url: row.url, events: row.eventPatterns, status: row.status },
    });
    return row;
  });
  // The signing secret is returned only on creation; its database value is an authenticated envelope.
  return json({ item: { ...publicSubscription(created), secret: signingSecret } }, 201);
}

async function revokeSubscription(id: string, actor: OwnerActor): Promise<Response> {
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) throw new DomainError("NOT_FOUND", "Webhook endpoint not found.", 404);
  const db = getDb();
  const revoked = await db.transaction(async (tx) => {
    const [updated] = await tx.update(webhookSubscriptions).set({ status: "revoked", updatedAt: new Date() })
      .where(and(eq(webhookSubscriptions.id, parsedId.data), eq(webhookSubscriptions.tenantId, actor.tenantId), ne(webhookSubscriptions.status, "revoked")))
      .returning({
        id: webhookSubscriptions.id, name: webhookSubscriptions.name, url: webhookSubscriptions.url,
        eventPatterns: webhookSubscriptions.eventPatterns, status: webhookSubscriptions.status,
        createdAt: webhookSubscriptions.createdAt, lastSuccessAt: webhookSubscriptions.lastSuccessAt,
        lastFailureAt: webhookSubscriptions.lastFailureAt,
      });
    if (updated) {
      await tx.insert(auditEvents).values({
        tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId,
        action: "developer.webhook_subscription_revoked", entityType: "webhook_subscription", entityId: updated.id,
        afterData: { status: updated.status },
      });
      return updated;
    }
    const [existing] = await tx.select({
      id: webhookSubscriptions.id, name: webhookSubscriptions.name, url: webhookSubscriptions.url,
      eventPatterns: webhookSubscriptions.eventPatterns, status: webhookSubscriptions.status,
      createdAt: webhookSubscriptions.createdAt, lastSuccessAt: webhookSubscriptions.lastSuccessAt,
      lastFailureAt: webhookSubscriptions.lastFailureAt,
    }).from(webhookSubscriptions).where(and(eq(webhookSubscriptions.id, parsedId.data), eq(webhookSubscriptions.tenantId, actor.tenantId))).limit(1);
    if (!existing) throw new DomainError("NOT_FOUND", "Webhook endpoint not found.", 404);
    return existing;
  });
  return json({ item: publicSubscription(revoked) });
}

async function resolveSubscription(id: string, actor: OwnerActor) {
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) throw new DomainError("NOT_FOUND", "Webhook endpoint not found.", 404);
  const [subscription] = await getDb().select({
    id: webhookSubscriptions.id, status: webhookSubscriptions.status,
  }).from(webhookSubscriptions).where(and(eq(webhookSubscriptions.id, parsedId.data), eq(webhookSubscriptions.tenantId, actor.tenantId))).limit(1);
  if (!subscription) throw new DomainError("NOT_FOUND", "Webhook endpoint not found.", 404);
  return subscription;
}

async function requestTestDelivery(request: Request, id: string, actor: OwnerActor): Promise<Response> {
  const subscription = await resolveSubscription(id, actor);
  if (subscription.status !== "active") throw new DomainError("CONFLICT", "Activate this webhook endpoint before sending a test.", 409);
  const body = request.body ? await readBody(request, testEventBodySchema) : {};
  const idempotencyKey = (request.headers.get("idempotency-key") ?? body.idempotencyKey)?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new DomainError("VALIDATION_ERROR", "An Idempotency-Key of 8 to 200 characters is required for a test delivery.", 422);
  }
  const eventId = deterministicUuid(`webhook-test:${actor.tenantId}:${subscription.id}:${idempotencyKey}`);
  const result = await getDb().transaction(async (tx) => {
    const [event] = await tx.insert(domainEvents).values({
      id: eventId, tenantId: actor.tenantId, eventType: "webhook.test", eventVersion: 1,
      occurredAt: new Date(), publishedAt: new Date(), actorType: "staff", actorId: actor.userId,
      entityType: "webhook_subscription", entityId: subscription.id, organizationId: actor.organizationId ?? null,
      payload: { test: true },
    }).onConflictDoNothing().returning({ id: domainEvents.id });
    const [insertedDelivery] = await tx.insert(webhookDeliveries).values({
      tenantId: actor.tenantId, webhookSubscriptionId: subscription.id, domainEventId: eventId, status: "queued",
    }).onConflictDoNothing().returning({ id: webhookDeliveries.id, status: webhookDeliveries.status });
    const delivery = insertedDelivery ?? (await tx.select({
      id: webhookDeliveries.id, status: webhookDeliveries.status,
    }).from(webhookDeliveries).where(and(
      eq(webhookDeliveries.tenantId, actor.tenantId),
      eq(webhookDeliveries.webhookSubscriptionId, subscription.id),
      eq(webhookDeliveries.domainEventId, eventId),
    )).limit(1))[0];
    if (!delivery || (!event && delivery.status === "failed")) throw new Error("The test delivery could not be queued");
    if (event) {
      await tx.insert(auditEvents).values({
        tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId,
        action: "developer.webhook_test_requested", entityType: "webhook_subscription", entityId: subscription.id,
        afterData: { deliveryId: delivery.id, eventId },
      });
    }
    return { ...delivery, eventId, reused: !event };
  });
  return json({ item: result }, result.reused ? 200 : 202);
}

async function listDeliveries(id: string, actor: OwnerActor): Promise<Response> {
  const subscription = await resolveSubscription(id, actor);
  const rows = await getDb().select({
    id: webhookDeliveries.id, status: webhookDeliveries.status, attemptCount: webhookDeliveries.attemptCount,
    responseStatus: webhookDeliveries.responseStatus, responseExcerpt: webhookDeliveries.responseExcerpt,
    nextRetryAt: webhookDeliveries.nextRetryAt, lastAttemptAt: webhookDeliveries.lastAttemptAt,
    deliveredAt: webhookDeliveries.deliveredAt, createdAt: webhookDeliveries.createdAt,
    eventType: domainEvents.eventType, domainEventId: webhookDeliveries.domainEventId,
  }).from(webhookDeliveries).innerJoin(domainEvents, and(
    eq(domainEvents.id, webhookDeliveries.domainEventId), eq(domainEvents.tenantId, webhookDeliveries.tenantId),
  )).where(and(
    eq(webhookDeliveries.tenantId, actor.tenantId),
    eq(webhookDeliveries.webhookSubscriptionId, subscription.id),
  )).orderBy(desc(webhookDeliveries.createdAt)).limit(100);
  return json({ items: rows });
}

async function retryDelivery(subscriptionId: string, deliveryId: string, actor: OwnerActor): Promise<Response> {
  const subscription = await resolveSubscription(subscriptionId, actor);
  if (subscription.status !== "active" && subscription.status !== "needs_attention") {
    throw new DomainError("CONFLICT", "Re-register this webhook endpoint before retrying deliveries.", 409);
  }
  const parsedDeliveryId = z.uuid().safeParse(deliveryId);
  if (!parsedDeliveryId.success) throw new DomainError("NOT_FOUND", "Webhook delivery not found.", 404);
  const db = getDb();
  const delivery = await db.transaction(async (tx) => {
    if (subscription.status === "needs_attention") {
      const [reactivated] = await tx.update(webhookSubscriptions).set({ status: "active", updatedAt: new Date() })
        .where(and(
          eq(webhookSubscriptions.id, subscription.id), eq(webhookSubscriptions.tenantId, actor.tenantId),
          eq(webhookSubscriptions.status, "needs_attention"),
        )).returning({ id: webhookSubscriptions.id });
      if (!reactivated) throw new DomainError("CONFLICT", "This webhook endpoint changed before it could be retried.", 409);
      await tx.insert(auditEvents).values({
        tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId,
        action: "developer.webhook_subscription_reactivated_for_retry", entityType: "webhook_subscription", entityId: subscription.id,
        afterData: { status: "active" },
      });
    }
    const [current] = await tx.select({
      id: webhookDeliveries.id, status: webhookDeliveries.status, attemptCount: webhookDeliveries.attemptCount,
      responseStatus: webhookDeliveries.responseStatus, nextRetryAt: webhookDeliveries.nextRetryAt,
    }).from(webhookDeliveries).where(and(
      eq(webhookDeliveries.id, parsedDeliveryId.data), eq(webhookDeliveries.tenantId, actor.tenantId),
      eq(webhookDeliveries.webhookSubscriptionId, subscription.id),
    )).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "Webhook delivery not found.", 404);
    if (current.status === "delivered" || current.status === "sending") {
      throw new DomainError("CONFLICT", "This webhook delivery cannot be retried in its current state.", 409);
    }
    if (current.status === "queued") return current;
    const [updated] = await tx.update(webhookDeliveries).set({ status: "queued", nextRetryAt: null, updatedAt: new Date() })
      .where(and(eq(webhookDeliveries.id, current.id), eq(webhookDeliveries.tenantId, actor.tenantId), eq(webhookDeliveries.webhookSubscriptionId, subscription.id)))
      .returning({
        id: webhookDeliveries.id, status: webhookDeliveries.status, attemptCount: webhookDeliveries.attemptCount,
        responseStatus: webhookDeliveries.responseStatus, nextRetryAt: webhookDeliveries.nextRetryAt,
      });
    if (!updated) throw new DomainError("CONFLICT", "This webhook delivery changed before it could be retried.", 409);
    await tx.insert(auditEvents).values({
      tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId,
      action: "developer.webhook_delivery_retry_requested", entityType: "webhook_delivery", entityId: updated.id,
      afterData: { webhookSubscriptionId: subscription.id, status: updated.status },
    });
    return updated;
  });
  return json({ item: delivery }, delivery.status === "queued" ? 202 : 200);
}

/** Owner-only outbound webhook subscription and delivery management. */
export async function handleDeveloperWebhooks(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "developer" || path[1] !== "webhooks") return null;
  requireOwner(actor);

  if (path.length === 2 && request.method === "GET") return json({ items: await listDeveloperWebhookSubscriptions(actor.tenantId) });
  if (path.length === 2 && request.method === "POST") return createSubscription(request, actor);
  if (path.length === 3 && request.method === "DELETE") return revokeSubscription(path[2]!, actor);
  if (path.length === 4 && path[3] === "test" && request.method === "POST") return requestTestDelivery(request, path[2]!, actor);
  if (path.length === 4 && path[3] === "deliveries" && request.method === "GET") return listDeliveries(path[2]!, actor);
  if (path.length === 6 && path[3] === "deliveries" && path[5] === "retry" && request.method === "POST") {
    return retryDelivery(path[2]!, path[4]!, actor);
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
