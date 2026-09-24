import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import {
  apiCredentials, connectorInstallations, creditAllocations, customerCredits, customers, files, jobStatusEvents,
  paymentMethodReferences, schema, seedDevelopment, seedIds, tenants, webhookEvents, type Database,
} from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleDataPortability } = await import("../lib/api/data-portability.ts");

let pglite: PGlite;
let db: Database;
const owner: SessionActor & { kind: "staff"; membershipId: string; organizationId: string; defaultLocationId: string } = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
  await db.update(tenants).set({ settings: { onboarding: { serviceArea: "Augusta" }, connectorSecret: "private-tenant-secret" } })
    .where(eq(tenants.id, owner.tenantId));
  await db.insert(customers).values(Array.from({ length: 501 }, (_, index) => ({ tenantId: owner.tenantId,
    organizationId: owner.organizationId, owningLocationId: seedIds.augusta, customerType: "residential",
    displayName: `Paged export customer ${index + 1}`, status: "active" })));

  const [credit] = await db.insert(customerCredits).values({
    tenantId: owner.tenantId, customerId: seedIds.carter, sourceType: "service_adjustment",
    originalAmountMinor: 900n, remainingAmountMinor: 400n, currency: "USD", status: "partially_used",
  }).returning();
  if (!credit) throw new Error("Credit fixture was not created.");
  await db.insert(creditAllocations).values({ tenantId: owner.tenantId, customerCreditId: credit.id, invoiceId: seedIds.happyInvoice, amountMinor: 500n });
  await db.insert(jobStatusEvents).values({ tenantId: owner.tenantId, jobId: seedIds.completedJob,
    fromStatus: "in_progress", toStatus: "completed", actorType: "staff", actorId: owner.membershipId, occurredAt: new Date() });
  await db.insert(webhookEvents).values({ tenantId: owner.tenantId, connectorKey: "export-test", providerEventId: "signature-history-1",
    eventType: "customer.updated", signatureValid: true, status: "processed", payload: { safeValue: "retained", accessToken: "nested-private-token" } });

  const [installation] = await db.insert(connectorInstallations).values({
    tenantId: owner.tenantId, organizationId: owner.organizationId, connectorKey: "payments", status: "connected",
    displayName: "Test payments", credentialReference: "vault://private/payment-secret",
  }).returning();
  if (!installation) throw new Error("Connector fixture was not created.");
  await db.insert(paymentMethodReferences).values({ tenantId: owner.tenantId, customerId: seedIds.carter,
    connectorInstallationId: installation.id, providerMethodRef: "protected-provider-method-reference", methodType: "card", status: "active" });
  await db.insert(apiCredentials).values({ tenantId: owner.tenantId, name: "Export secret fixture", tokenHash: "protected-api-hash",
    tokenPrefix: "protected-prefix", scopes: ["customers:read"], status: "active", createdByMembershipId: owner.membershipId });
  await db.insert(files).values({ tenantId: owner.tenantId, storageKey: "private-storage-key", originalName: "proof.jpg",
    mimeType: "image/jpeg", byteSize: 42, checksum: "safe-checksum", visibility: "customer",
    uploadedByActorType: "staff", uploadedByActorId: owner.membershipId });
}, 120_000);

afterAll(async () => { await pglite?.close(); });

describe("full business-data export", () => {
  it("exports operational and financial history in stable tenant-scoped pages without credential material", async () => {
    const response = await handleDataPortability(new Request("http://localhost/api/v1/exports/business-data"), ["exports", "business-data"], owner);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-disposition")).toContain("business-data.json");
    const payload = await response!.json() as {
      schemaVersion: string;
      tenant: { id: string; settings?: Record<string, unknown> };
      data: Record<string, Array<Record<string, unknown>>>;
      fileManifest: Array<Record<string, unknown>>;
    };

    expect(payload.schemaVersion).toBe("modular-crm-business-data-v1");
    expect(payload.tenant.id).toBe(owner.tenantId);
    expect(payload.tenant.settings).toMatchObject({ onboarding: { serviceArea: "Augusta" } });
    expect(payload.data.paymentAllocations).toContainEqual(expect.objectContaining({ paymentId: seedIds.happyPayment, invoiceId: seedIds.happyInvoice }));
    expect(payload.data.refunds).toContainEqual(expect.objectContaining({ paymentId: expect.any(String), amountMinor: 500 }));
    expect(payload.data.creditAllocations).toContainEqual(expect.objectContaining({ invoiceId: seedIds.happyInvoice, amountMinor: 500 }));
    expect(payload.data.jobStatusEvents).toContainEqual(expect.objectContaining({ jobId: seedIds.completedJob, toStatus: "completed" }));
    expect(payload.data.customers).toContainEqual(expect.objectContaining({ displayName: "Paged export customer 501" }));
    expect(payload.data.staff).toContainEqual(expect.objectContaining({ name: "Olivia Owner", email: "owner@happyyards.test" }));
    expect(payload.data.webhookEvents).toContainEqual(expect.objectContaining({ signatureValid: true,
      payload: { safeValue: "retained" } }));
    expect(payload.data.customers.every((customer) => customer.tenantId === owner.tenantId)).toBe(true);
    expect(payload.data).not.toHaveProperty("paymentMethodReferences");
    expect(payload.data).not.toHaveProperty("apiCredentials");
    expect(payload.data.connectorInstallations?.every((installation) => !("credentialReference" in installation))).toBe(true);
    expect(payload.data.files?.every((file) => !("storageKey" in file))).toBe(true);
    expect(payload.fileManifest.every((file) => !("storageKey" in file))).toBe(true);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(seedIds.cleanTenant);
    for (const protectedValue of ["private-tenant-secret", "vault://private/payment-secret", "protected-provider-method-reference", "protected-api-hash", "private-storage-key", "nested-private-token"]) {
      expect(serialized).not.toContain(protectedValue);
    }
  }, 30_000);
});
