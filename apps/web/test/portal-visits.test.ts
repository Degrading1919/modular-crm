import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { jobs, schema, seedDevelopment, seedIds, serviceFeedback, serviceLocations, type Database } from "@modular-crm/db";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handlePortal } = await import("../lib/api/portal.ts");

let pglite: PGlite;
let db: Database;
const actor: SessionActor = {
  kind: "customer", userId: "demo-happy-customer", tenantId: seedIds.happyTenant,
  tenantName: "Happy Yards Pet Waste", packKey: "pet-waste-removal", email: "carter@example.test", name: "Carter Customer",
  customerIds: new Set([seedIds.carter]), locationIds: new Set([seedIds.carterLocation]),
  customerLocationIds: new Map([[seedIds.carter, new Set([seedIds.carterLocation])]]),
};

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

async function addVisit(options: { status?: string; locationId?: string; customerId?: string; tenantId?: string; servicePlanId?: string | null } = {}) {
  const [job] = await db.insert(jobs).values({
    tenantId: options.tenantId ?? seedIds.happyTenant,
    organizationId: options.tenantId === seedIds.cleanTenant ? seedIds.cleanOrganization : seedIds.happyOrganization,
    organizationLocationId: options.tenantId === seedIds.cleanTenant ? seedIds.cleanBranch : seedIds.augusta,
    customerId: options.customerId ?? seedIds.carter,
    serviceLocationId: options.locationId ?? seedIds.carterLocation,
    servicePlanId: options.servicePlanId ?? null,
    serviceId: options.tenantId === seedIds.cleanTenant ? seedIds.cleanService : seedIds.weeklyService,
    status: options.status ?? "completed", scheduledDate: "2026-09-20", actualCompletedAt: new Date("2026-09-20T15:00:00Z"),
    customerSummary: "One-time yard cleanup",
  }).returning();
  if (!job) throw new Error("Could not create visit fixture.");
  return job;
}

function request(path: string, method = "GET", body?: Record<string, unknown>) {
  return new Request(`http://localhost/api/v1/${path}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

async function call(path: string, method = "GET", body?: Record<string, unknown>) {
  const response = await handlePortal(request(path, method, body), path.split("/").filter(Boolean), actor);
  if (!response) throw new Error(`Portal route did not handle ${path}.`);
  return response;
}

describe("customer portal completed visit readback", () => {
  it("lists completed visits only and scopes them to tenant, customer, and granted location", async () => {
    const standalone = await addVisit();
    const scheduled = await addVisit({ status: "scheduled" });
    const otherCustomer = await addVisit({ customerId: seedIds.nguyen, locationId: seedIds.nguyenLocation });
    const [otherCarterLocation] = await db.insert(serviceLocations).values({
      tenantId: seedIds.happyTenant, customerId: seedIds.carter, organizationLocationId: seedIds.northAugusta,
      name: "Second address", addressLine1: "12 Pine Street", city: "North Augusta", region: "SC", postalCode: "29841",
    }).returning();
    if (!otherCarterLocation) throw new Error("Could not create alternate location fixture.");
    const otherLocation = await addVisit({ locationId: otherCarterLocation.id });
    const otherTenant = await addVisit({ tenantId: seedIds.cleanTenant, customerId: seedIds.cleanCarter, locationId: seedIds.cleanCarterLocation });

    const response = await call("/portal/visits");
    expect(response.status).toBe(200);
    const payload = await response.json() as { items: Array<Record<string, unknown>> };
    const ids = payload.items.map((item) => item.id);
    expect(ids).toContain(standalone.id);
    expect(ids).not.toContain(scheduled.id);
    expect(ids).not.toContain(otherCustomer.id);
    expect(ids).not.toContain(otherLocation.id);
    expect(ids).not.toContain(otherTenant.id);
    expect(payload.items.every((item) => item.status === "completed")).toBe(true);
    expect(payload.items[0]).not.toHaveProperty("tenantId");

    const servicesResponse = await call("/portal/services");
    const services = await servicesResponse.json() as { items: Array<{ id: string; history: Array<{ id: string; servicePlanId: string | null }> }> };
    const recurringHistory = services.items.find((plan) => plan.id === seedIds.carterPlan)?.history ?? [];
    expect(recurringHistory.map((visit) => visit.id)).toContain(seedIds.completedJob);
    expect(recurringHistory.map((visit) => visit.id)).not.toContain(standalone.id);
    expect(recurringHistory.every((visit) => visit.servicePlanId === seedIds.carterPlan)).toBe(true);
  });

  it("limits profile and portal list rows to the exact granted service location", async () => {
    const siblingLocationId = crypto.randomUUID();
    const siblingInvoiceId = crypto.randomUUID();
    const branchOnlyInvoiceId = crypto.randomUUID();
    const siblingTicketId = crypto.randomUUID();
    const siblingRequestId = crypto.randomUUID();
    await db.insert(serviceLocations).values({
      id: siblingLocationId, tenantId: seedIds.happyTenant, customerId: seedIds.carter, organizationLocationId: seedIds.augusta,
      name: "Unshared property", addressLine1: "91 Cedar Street", city: "Augusta", region: "GA", postalCode: "30901",
    });
    const siblingJob = await addVisit({ locationId: siblingLocationId });
    await db.insert(schema.invoices).values({
      id: siblingInvoiceId, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
      customerId: seedIds.carter, status: "issued", invoiceNumber: `SIB-${siblingInvoiceId.slice(0, 8)}`, currency: "USD", totalMinor: 1500n,
    });
    await db.insert(schema.invoices).values({
      id: branchOnlyInvoiceId, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
      customerId: seedIds.carter, status: "issued", invoiceNumber: `BR-${branchOnlyInvoiceId.slice(0, 8)}`, currency: "USD", totalMinor: 1000n,
    });
    await db.insert(schema.invoiceItems).values({
      tenantId: seedIds.happyTenant, invoiceId: siblingInvoiceId, jobId: siblingJob.id,
      description: "Unshared property service", quantity: "1", unitAmountMinor: 1500n, totalMinor: 1500n,
    });
    await db.insert(schema.tickets).values({
      id: siblingTicketId, tenantId: seedIds.happyTenant, customerId: seedIds.carter, serviceLocationId: siblingLocationId,
      ticketTypeId: "00000000-0000-4000-8000-0000000001b8", statusDefinitionId: "00000000-0000-4000-8000-0000000001bd",
      title: "Unshared property issue", description: "Details for an unshared property", customerVisible: true,
      createdByActorType: "staff",
    });
    await db.insert(schema.customerChangeRequests).values({
      id: siblingRequestId, tenantId: seedIds.happyTenant, customerId: seedIds.carter, serviceLocationId: siblingLocationId,
      requestType: "change", status: "pending", customerMessage: "Details for an unshared property",
    });

    const profile = await call("/portal/profile").then((response) => response.json()) as { item: { locations: Array<{ id: string }> } };
    expect(profile.item.locations.map((location) => location.id)).toEqual([seedIds.carterLocation]);
    const invoicesResponse = await call("/portal/invoices");
    const invoicesPayload = await invoicesResponse.json() as { items: Array<Record<string, unknown>> };
    expect(invoicesPayload.items.map((item) => item.id)).not.toContain(branchOnlyInvoiceId);
    for (const resource of ["visits", "invoices", "tickets", "requests"] as const) {
      const response = await call(`/portal/${resource}`);
      expect(response.status).toBe(200);
      const payload = await response.json() as { items: Array<Record<string, unknown>> };
      expect(payload.items.map((item) => item.id)).not.toContain(siblingJob.id);
      expect(payload.items.map((item) => item.id)).not.toContain(siblingInvoiceId);
      expect(payload.items.map((item) => item.id)).not.toContain(siblingTicketId);
      expect(payload.items.map((item) => item.id)).not.toContain(siblingRequestId);
    }
  });

  it("reads feedback back on visits and leaves the existing submission idempotent on retry", async () => {
    const standalone = await addVisit();
    const response = await call(`/portal/feedback/${standalone.id}`, "POST", { rating: 5, comment: "Great work" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ item: { rating: 5, comment: "Great work" } });

    const retry = await call(`/portal/feedback/${standalone.id}`, "POST", { rating: 1, comment: "retry" });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ item: { jobId: standalone.id, duplicate: true, rating: 5, comment: "Great work" } });

    const readback = await call("/portal/visits");
    const payload = await readback.json() as { items: Array<Record<string, unknown>> };
    expect(payload.items.find((item) => item.id === standalone.id)).toMatchObject({ feedbackRating: 5, feedbackComment: "Great work" });
    expect(await db.select().from(serviceFeedback).where(eq(serviceFeedback.jobId, standalone.id))).toHaveLength(1);
  });

  it("emits the documented customer request event with the request commit", async () => {
    const response = await call("/portal/requests", "POST", { type: "change", details: "Please update my service." });
    expect(response.status).toBe(201);
    const payload = await response.json() as { item: { id: string } };
    const [event] = await db.select().from(schema.domainEvents).where(eq(schema.domainEvents.entityId, payload.item.id));
    expect(event).toMatchObject({
      eventType: "customer_change_request.submitted", entityType: "customer_change_request", entityId: payload.item.id,
      payload: { customerId: seedIds.carter, type: "change" },
    });
  });

  it("writes notification preferences and transactional consent as the notification worker reads them", async () => {
    const updated = await call("/portal/profile", "PATCH", { notificationPreferences: { email: false, sms: true } });
    expect(updated.status).toBe(200);
    const [general] = await db.select().from(schema.notificationPreferences).where(and(
      eq(schema.notificationPreferences.tenantId, seedIds.happyTenant),
      eq(schema.notificationPreferences.customerId, seedIds.carter),
      eq(schema.notificationPreferences.eventKey, "general"),
    ));
    expect(general).toMatchObject({ emailEnabled: false, smsEnabled: true });
    const consents = await db.select().from(schema.consentRecords).where(and(
      eq(schema.consentRecords.tenantId, seedIds.happyTenant),
      eq(schema.consentRecords.customerId, seedIds.carter),
      eq(schema.consentRecords.category, "transactional"),
    ));
    expect(consents).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "email", state: "opted_out", source: "customer_portal_profile", actorType: "customer", actorId: actor.userId }),
      expect.objectContaining({ channel: "sms", state: "opted_in", source: "customer_portal_profile", actorType: "customer", actorId: actor.userId }),
    ]));
    const readback = await call("/portal/profile");
    expect((await readback.json()).item.notificationPreferences).toEqual({ email: false, sms: true });
  });

  it("lists only successful or refunded payments tied to an invoice visible at a granted location", async () => {
    const response = await call("/portal/payments");
    expect(response.status).toBe(200);
    const payload = await response.json() as { items: Array<Record<string, unknown>> };
    expect(payload.items).toContainEqual(expect.objectContaining({ id: seedIds.happyPayment, status: "succeeded", amountMinor: 2500, currency: "USD" }));
    expect(payload.items.every((item) => item.status === "succeeded" || item.status === "refunded")).toBe(true);
    expect(payload.items.some((item) => item.id === seedIds.cleanPayment)).toBe(false);
    expect(payload.items[0]).not.toHaveProperty("tenantId");
  });
});
