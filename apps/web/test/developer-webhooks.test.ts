import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openSecret } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";

const dbHarness = vi.hoisted(() => ({
  insertCalls: [] as Array<{ values: Record<string, unknown>; returning?: boolean }> ,
  listRows: [] as Array<Record<string, unknown>>,
  selectRows: [] as Array<Record<string, unknown>>,
  updateRows: [] as Array<Record<string, unknown>>,
  events: new Map<string, Record<string, unknown>>(),
  deliveries: new Map<string, Record<string, unknown>>(),
  whereCondition: undefined as unknown,
}));

vi.mock("../lib/db", () => ({
  getDb: () => {
    const tx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          dbHarness.insertCalls.push({ values });
          let result: Record<string, unknown> | undefined;
          if ("secretReference" in values) {
            result = {
              ...values, id: "11111111-1111-4111-8111-111111111111", createdAt: new Date("2026-09-23T12:00:00Z"),
              lastSuccessAt: null, lastFailureAt: null,
            };
          } else if ("eventType" in values) {
            const eventId = String(values.id);
            if (!dbHarness.events.has(eventId)) {
              result = { id: eventId };
              dbHarness.events.set(eventId, { ...values });
            }
          } else if ("webhookSubscriptionId" in values) {
            const key = `${String(values.webhookSubscriptionId)}:${String(values.domainEventId)}`;
            if (!dbHarness.deliveries.has(key)) {
              result = { ...values, id: "22222222-2222-4222-8222-222222222222", attemptCount: 0 };
              dbHarness.deliveries.set(key, result);
            }
          }
          return {
            onConflictDoNothing() { return this; },
            returning: async () => {
              dbHarness.insertCalls[dbHarness.insertCalls.length - 1]!.returning = true;
              return result ? [result] : [];
            },
          };
        },
      }),
      select: () => ({
        from() { return this; },
        where(condition: unknown) { dbHarness.whereCondition = condition; return this; },
        orderBy() { return this; },
        limit: async () => dbHarness.selectRows.length ? [dbHarness.selectRows.shift()!] : dbHarness.listRows,
      }),
      update: () => ({
        set: () => ({
          where(condition: unknown) {
            dbHarness.whereCondition = condition;
            return { returning: async () => dbHarness.updateRows.length ? [dbHarness.updateRows.shift()!] : [] };
          },
        }),
      }),
    };
    return { ...tx, transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx) };
  },
}));

const { createWebhookBodySchema, handleDeveloperWebhooks } = await import("../lib/api/developer-webhooks.ts");

const owner: SessionActor = {
  kind: "staff", userId: "user-owner", tenantId: "tenant-a", role: "owner", permissions: new Set(),
  locationIds: new Set(), allLocations: true, membershipId: "membership-owner", email: "owner@example.test",
  name: "Owner", tenantName: "Tenant A", packKey: null,
};
const officeActor: SessionActor = { ...owner, role: "office", userId: "user-office", membershipId: "membership-office" };

beforeEach(() => {
  dbHarness.insertCalls = [];
  dbHarness.listRows = [];
  dbHarness.selectRows = [];
  dbHarness.updateRows = [];
  dbHarness.events = new Map();
  dbHarness.deliveries = new Map();
  dbHarness.whereCondition = undefined;
});

describe("developer outbound webhooks", () => {
  it("normalizes event patterns and rejects malformed patterns or extra fields", () => {
    expect(createWebhookBodySchema.parse({ url: "https://example.test/hook", events: ["job.completed", "job.completed", "job.*"] }))
      .toEqual({ url: "https://example.test/hook", events: ["job.completed", "job.*"] });
    expect(() => createWebhookBodySchema.parse({ url: "https://example.test", events: ["job.*"] , tenantId: "tenant-b" })).toThrow();
    expect(() => createWebhookBodySchema.parse({ url: "https://example.test", events: ["job.*.completed"] })).toThrow();
  });

  it("stores an authenticated secret envelope, reveals the secret once, and audits no secret material", async () => {
    const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = key;
    const response = await handleDeveloperWebhooks(new Request("https://crm.example/api/v1/developer/webhooks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://hooks.example.test/receive", events: ["job.completed"] }),
    }), ["developer", "webhooks"], owner);
    expect(response?.status).toBe(201);
    const payload = await response!.json();
    const signingSecret = payload.item.secret as string;
    const stored = dbHarness.insertCalls[0]!.values;
    const audit = dbHarness.insertCalls[1]!.values;

    expect(signingSecret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(stored.tenantId).toBe(owner.tenantId);
    expect(stored.secretReference).toMatch(/^mcrm-secret:v1:/);
    expect(stored.secretReference).not.toBe(signingSecret);
    expect(openSecret(String(stored.secretReference), key)).toBe(signingSecret);
    expect(payload.item).not.toHaveProperty("secretReference");
    expect(audit.action).toBe("developer.webhook_subscription_created");
    expect(JSON.stringify(audit)).not.toContain(signingSecret);
    expect(JSON.stringify(audit)).not.toContain(String(stored.secretReference));
  });

  it("lists only public endpoint fields with a tenant filter and limits management to owners", async () => {
    dbHarness.listRows = [{
      id: "11111111-1111-4111-8111-111111111111", tenantId: "tenant-a", name: "Hooks", url: "https://hooks.example.test/",
      eventPatterns: ["job.completed"], status: "active", createdAt: new Date("2026-09-23T12:00:00Z"),
      lastSuccessAt: null, lastFailureAt: null, secretReference: "must-not-be-returned",
    }];
    const response = await handleDeveloperWebhooks(new Request("https://crm.example/api/v1/developer/webhooks"), ["developer", "webhooks"], owner);
    const payload = await response!.json();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ events: ["job.completed"], status: "active" });
    expect(payload.items[0]).not.toHaveProperty("secretReference");
    const query = new PgDialect().sqlToQuery(dbHarness.whereCondition as SQL);
    expect(query.sql).toContain("tenant_id");
    expect(query.params).toContain(owner.tenantId);

    await expect(handleDeveloperWebhooks(new Request("https://crm.example/api/v1/developer/webhooks"), ["developer", "webhooks"], officeActor))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("creates one targeted test delivery for a repeated idempotency key", async () => {
    const subscription = { id: "11111111-1111-4111-8111-111111111111", status: "active" };
    dbHarness.selectRows = [subscription];
    const first = await handleDeveloperWebhooks(new Request(`https://crm.example/api/v1/developer/webhooks/${subscription.id}/test`, {
      method: "POST", headers: { "idempotency-key": "owner-test-event-1" },
    }), ["developer", "webhooks", subscription.id, "test"], owner);
    const firstPayload = await first!.json();
    expect(first?.status).toBe(202);
    expect(firstPayload.item).toMatchObject({ id: "22222222-2222-4222-8222-222222222222", status: "queued", reused: false });
    expect(dbHarness.events.size).toBe(1);
    expect([...dbHarness.events.values()][0]).toMatchObject({ eventType: "webhook.test", publishedAt: expect.any(Date) });

    dbHarness.selectRows = [subscription, { id: firstPayload.item.id, status: "queued" }];
    const second = await handleDeveloperWebhooks(new Request(`https://crm.example/api/v1/developer/webhooks/${subscription.id}/test`, {
      method: "POST", headers: { "idempotency-key": "owner-test-event-1" },
    }), ["developer", "webhooks", subscription.id, "test"], owner);
    const secondPayload = await second!.json();
    expect(second?.status).toBe(200);
    expect(secondPayload.item).toMatchObject({ id: firstPayload.item.id, status: "queued", reused: true });
    expect(dbHarness.events.size).toBe(1);
    expect(dbHarness.deliveries.size).toBe(1);
  });

  it("manually queues a failed delivery and reactivates an endpoint needing attention", async () => {
    const subscriptionId = "11111111-1111-4111-8111-111111111111";
    const deliveryId = "22222222-2222-4222-8222-222222222222";
    dbHarness.selectRows = [
      { id: subscriptionId, status: "needs_attention" },
      { id: deliveryId, status: "failed", attemptCount: 8, responseStatus: 500, nextRetryAt: null },
    ];
    dbHarness.updateRows = [
      { id: subscriptionId },
      { id: deliveryId, status: "queued", attemptCount: 8, responseStatus: 500, nextRetryAt: null },
    ];
    const response = await handleDeveloperWebhooks(new Request(`https://crm.example/api/v1/developer/webhooks/${subscriptionId}/deliveries/${deliveryId}/retry`, {
      method: "POST",
    }), ["developer", "webhooks", subscriptionId, "deliveries", deliveryId, "retry"], owner);
    expect(response?.status).toBe(202);
    expect(await response!.json()).toMatchObject({ item: { id: deliveryId, status: "queued", attemptCount: 8 } });
    expect(dbHarness.insertCalls.map((call) => call.values.action)).toEqual([
      "developer.webhook_subscription_reactivated_for_retry", "developer.webhook_delivery_retry_requested",
    ]);
  });
});
