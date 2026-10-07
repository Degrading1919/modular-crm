import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { applyPlatformBillingEvent, closeDatabase, createDatabase, platformSubscriptions, platformSubscription, startPlatformTrial, tenants } from "@modular-crm/db";
import { DEVELOPMENT_AUTH_SECRET, readPlatformBillingConfig } from "@modular-crm/config";
import type { BillingNotification, BillingSnapshot } from "@modular-crm/domain";

// Real PostgreSQL: PGlite has one session and cannot prove lock concurrency.
test("business writes finish while billing retrieval is pending; reconciliation rechecks the latest binding", async () => {
  const db = createDatabase(process.env.DATABASE_URL!);
  const tenantId = randomUUID();
  const config = readPlatformBillingConfig({});
  let release!: (snapshot: BillingSnapshot) => void;
  let started!: () => void;
  const resolving = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<BillingSnapshot>(resolve => { release = resolve; });
  const snapshot: BillingSnapshot = { customerId: `customer_${tenantId}`, subscriptionId: "sub_original", status: "active", planKey: "local-standard", currency: "USD", interval: "month" };
  const event: BillingNotification = { id: randomUUID(), created: Math.floor(Date.now() / 1000), type: "invoice.paid", customerId: snapshot.customerId, subscriptionId: snapshot.subscriptionId };
  let reconciliation: ReturnType<typeof applyPlatformBillingEvent> | undefined;
  try {
    await db.insert(tenants).values({ id: tenantId, name: "Billing concurrency fixture", slug: `billing-concurrency-${tenantId}`, status: "active" });
    await startPlatformTrial(db, tenantId, config);
    await db.update(platformSubscriptions).set({ customerId: snapshot.customerId, subscriptionId: snapshot.subscriptionId }).where(eq(platformSubscriptions.tenantId, tenantId));
    reconciliation = applyPlatformBillingEvent(db, config, event, "original-payload", async () => { started(); return pending; }, { secret: DEVELOPMENT_AUTH_SECRET, baseUrl: "http://localhost:3000" });
    await resolving;
    // A server-side deadline makes the old FOR UPDATE-across-resolve implementation
    // fail deterministically, without sleeping, retrying or changing runner timeouts.
    await db.transaction(async tx => {
      await tx.execute(sql`set local statement_timeout = '1000ms'`);
      await tx.update(tenants).set({ name: "Business write completed during provider retrieval" }).where(eq(tenants.id, tenantId));
    });
    const [business] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(business!.name).toBe("Business write completed during provider retrieval");
    // Simulate another allowed billing operation replacing the subscription while
    // the provider request is in flight. The old binding must not be restored.
    await db.update(platformSubscriptions).set({ subscriptionId: "sub_replacement", status: "active" }).where(eq(platformSubscriptions.tenantId, tenantId));
    release(snapshot);
    expect(await reconciliation).toEqual({ duplicate: false, ignored: true });
    expect((await platformSubscription(db, tenantId))!.subscriptionId).toBe("sub_replacement");
  } finally {
    release(snapshot);
    await reconciliation?.catch(() => {}); // Drain after an assertion failure, preserving that failure.
    await closeDatabase(db);
  }
});
