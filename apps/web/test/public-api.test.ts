import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { apiCredentials, auditEvents, customers, domainEvents, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { createApiKey, hashApiKey } from "@modular-crm/domain";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleV1 } = await import("../lib/api/handler.ts");

let pglite: PGlite;
let db: Database;
const keys = new Map<string, string>();

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
  await addCredential("read-only", ["customers:read"]);
  await addCredential("customer-lead-write", ["customers:read", "customers:write", "leads:read", "leads:write"]);
  await addCredential("job-write-only", ["jobs:write"]);
  await addCredential("all-reads", [
    "customers:read", "leads:read", "jobs:read", "estimates:read", "invoices:read", "payments:read",
    "service_plans:read", "tickets:read",
  ]);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

async function addCredential(name: string, scopes: string[]) {
  const key = createApiKey();
  keys.set(name, key.plain);
  await db.insert(apiCredentials).values({
    tenantId: seedIds.happyTenant, name, tokenHash: hashApiKey(key.plain), tokenPrefix: key.prefix, scopes,
    status: "active", createdByMembershipId: seedIds.oliviaMembership,
  });
}

function makeRequest(
  credential: string,
  path: string,
  options: { method?: string; body?: Record<string, unknown>; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({ authorization: `Bearer ${credential}`, ...options.headers });
  if (options.body) headers.set("content-type", "application/json");
  return new Request(`http://localhost/api/v1/public/${path}`, {
    method: options.method ?? "GET", headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function call(request: Request, path: string[]) {
  return handleV1(request, ["public", ...path]);
}

describe("V1 machine public API", () => {
  it("uses stored tenant and exact resource scopes for reads and writes", async () => {
    const readKey = keys.get("read-only")!;
    const list = await call(makeRequest(readKey, "customers?limit=1"), ["customers"]);
    expect(list.status).toBe(200);
    const page = await list.json() as { items: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: string | null };
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBeTruthy();
    expect(page.items[0]).not.toHaveProperty("tenantId");
    expect(page.items[0]).not.toHaveProperty("billingAddress");

    const cleanTenantRecord = await call(makeRequest(readKey, `customers/${seedIds.cleanCarter}`), ["customers", seedIds.cleanCarter]);
    expect(cleanTenantRecord.status).toBe(404);

    const deniedWrite = await call(makeRequest(readKey, "customers", {
      method: "POST", headers: { "idempotency-key": "read-key-write" }, body: { name: "Not Allowed" },
    }), ["customers"]);
    expect(deniedWrite.status).toBe(403);
    expect(await deniedWrite.json()).toMatchObject({ error: { code: "FORBIDDEN" } });

    const invalidCredential = await call(makeRequest("mcrm_" + "A".repeat(43), "customers"), ["customers"]);
    expect(invalidCredential.status).toBe(401);
    expect(await invalidCredential.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });

    const unsupportedWrite = await call(makeRequest(keys.get("job-write-only")!, "jobs", {
      method: "POST", headers: { "idempotency-key": "unsupported-job-create" }, body: { customerId: seedIds.carter },
    }), ["jobs"]);
    expect(unsupportedWrite.status).toBe(404);
  });

  it("lets existing slug-based public website routes continue through the public namespace", async () => {
    const response = await call(new Request("http://localhost/api/v1/public/site?slug=happy-yards"), ["site"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ item: { slug: "happy-yards" } });
  });

  it("cursor paginates by createdAt and id without repeating records", async () => {
    const key = keys.get("read-only")!;
    const firstResponse = await call(makeRequest(key, "customers?limit=1"), ["customers"]);
    const first = await firstResponse.json() as { items: Array<{ id: string }>; nextCursor: string };
    const secondResponse = await call(makeRequest(key, `customers?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`), ["customers"]);
    const secondPayload = await secondResponse.json();
    if (!("items" in secondPayload)) throw new Error(JSON.stringify(secondPayload));
    expect(secondPayload).toHaveProperty("items", expect.any(Array));
    const second = secondPayload as { items: Array<{ id: string }> };
    expect(first.items[0]!.id).not.toBe(second.items[0]!.id);

    const malformed = await call(makeRequest(key, "customers?limit=101"), ["customers"]);
    expect(malformed.status).toBe(422);
    const tenantQuery = await call(makeRequest(key, "customers?tenantId=other"), ["customers"]);
    expect(tenantQuery.status).toBe(422);
  });

  it("creates customer and lead records once per durable idempotency key", async () => {
    const key = keys.get("customer-lead-write")!;
    const customerBody = {
      name: "API Customer", email: "api-customer@example.test", phone: "+15550123456",
      address: "44 Machine Way", custom_fields: { source: "public-api", preference: { visits: 2 } },
    };
    const headers = { "idempotency-key": "customer-create-operation-1" };
    const firstResponse = await call(makeRequest(key, "customers", { method: "POST", headers, body: customerBody }), ["customers"]);
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as { item: { id: string; name: string; custom_fields: Record<string, unknown> } };
    expect(first.item).toMatchObject({ name: "API Customer", custom_fields: customerBody.custom_fields });

    const replayResponse = await call(makeRequest(key, "customers", {
      method: "POST", headers, body: { ...customerBody },
    }), ["customers"]);
    const replay = await replayResponse.json() as { item: { id: string } };
    expect(replayResponse.status).toBe(201);
    expect(replay.item.id).toBe(first.item.id);
    expect(await db.select().from(customers).where(and(eq(customers.tenantId, seedIds.happyTenant), eq(customers.id, first.item.id)))).toHaveLength(1);

    const conflict = await call(makeRequest(key, "customers", {
      method: "POST", headers, body: { ...customerBody, name: "Different Customer" },
    }), ["customers"]);
    expect(conflict.status).toBe(409);

    const updatedResponse = await call(makeRequest(key, `customers/${first.item.id}`, {
      method: "PATCH", body: { name: "Updated API Customer", phone: "" },
    }), ["customers", first.item.id]);
    expect(updatedResponse.status).toBe(200);
    expect(await updatedResponse.json()).toMatchObject({ item: { name: "Updated API Customer", phone: null } });

    const leadResponse = await call(makeRequest(key, "leads", {
      method: "POST", headers: { "idempotency-key": "lead-create-operation-1" },
      body: {
        name: "Taylor Prospect", source: "partner", notes: "Call after 3pm",
        custom_fields: { campaign: "fall", websiteSignup: { accessInstructionsEncrypted: "encrypted-secret-material" } },
      },
    }), ["leads"]);
    expect(leadResponse.status).toBe(201);
    const lead = await leadResponse.json() as { item: { id: string; name: string; custom_fields: Record<string, unknown> } };
    expect(lead.item).toMatchObject({ name: "Taylor Prospect", custom_fields: { campaign: "fall", notes: "Call after 3pm" } });
    expect(lead.item.custom_fields).not.toHaveProperty("websiteSignup.accessInstructionsEncrypted");

    const leadUpdate = await call(makeRequest(key, `leads/${lead.item.id}`, {
      method: "PATCH", body: { source: "conference", notes: "Qualified" },
    }), ["leads", lead.item.id]);
    expect(leadUpdate.status).toBe(200);
    expect(await leadUpdate.json()).toMatchObject({ item: { source: "conference", custom_fields: { campaign: "fall", notes: "Qualified" } } });

    const noIdempotency = await call(makeRequest(key, "leads", { method: "POST", body: { name: "Missing Key" } }), ["leads"]);
    expect(noIdempotency.status).toBe(422);
    expect(await noIdempotency.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    const strictBody = await call(makeRequest(key, "leads", {
      method: "POST", headers: { "idempotency-key": "lead-strict-operation" }, body: { name: "Strict Lead", tenantId: seedIds.cleanTenant },
    }), ["leads"]);
    expect(strictBody.status).toBe(422);

    const audit = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, seedIds.happyTenant), eq(auditEvents.entityId, first.item.id),
    ));
    const events = await db.select().from(domainEvents).where(and(
      eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.entityId, first.item.id),
    ));
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(["public_api.customer.create", "public_api.customer.update"]));
    expect(events.map((row) => row.eventType)).toEqual(expect.arrayContaining(["customer.created", "customer.updated"]));
    expect(JSON.stringify({ audit, events })).not.toContain(key);
  });

  it("serves all other scoped resources as read-only tenant lists and hides internal fields", async () => {
    const key = keys.get("all-reads")!;
    for (const resource of ["leads", "jobs", "estimates", "invoices", "payments", "service-plans", "tickets"]) {
      const response = await call(makeRequest(key, `${resource}?limit=2`), [resource]);
      expect(response.status, resource).toBe(200);
      expect((await response.json()).items).toBeInstanceOf(Array);
    }

    const jobs = await call(makeRequest(key, "jobs"), ["jobs"]);
    const jobItems = (await jobs.json()).items as Array<Record<string, unknown>>;
    expect(jobItems[0]).not.toHaveProperty("internalSummary");
    const invoices = await call(makeRequest(key, "invoices"), ["invoices"]);
    const invoiceItems = (await invoices.json()).items as Array<Record<string, unknown>>;
    expect(invoiceItems[0]).not.toHaveProperty("billingSnapshot");
    expect(invoiceItems[0]).toHaveProperty("totalAmount");
    expect(invoiceItems[0]).not.toHaveProperty("totalMinor");
    const payments = await call(makeRequest(key, "payments"), ["payments"]);
    const paymentItems = (await payments.json()).items as Array<Record<string, unknown>>;
    expect(paymentItems[0]).not.toHaveProperty("providerReference");
    expect(paymentItems[0]).toHaveProperty("amount");
    expect(paymentItems[0]).not.toHaveProperty("amountMinor");
  });
});
