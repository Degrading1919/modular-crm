import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { auditEvents, customers, domainEvents, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import type { SessionActor } from "../lib/api/actor";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records.ts");

let pglite: PGlite;
let db: Database;
let rejectAuditAction: string | null = null;

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  await seedDevelopment(db);
  getDbMock.mockImplementation(() => rejectAuditAction ? dbWithFailingAuditWriter(rejectAuditAction) : db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

function dbWithFailingAuditWriter(action: string): Database {
  return {
    transaction: (callback: (tx: unknown) => Promise<unknown>) => db.transaction((tx) => {
      const wrapped = new Proxy(tx, {
        get(target, property) {
          if (property === "insert") return (table: unknown) => {
            const builder = target.insert(table as never);
            if (table !== auditEvents) return builder;
            return new Proxy(builder, {
              get(insertBuilder, method) {
                if (method === "values") return (value: { action?: string }) => {
                  if (value.action === action) throw new Error(`forced ${action} audit failure`);
                  return insertBuilder.values(value as never);
                };
                const value = Reflect.get(insertBuilder, method, insertBuilder);
                return typeof value === "function" ? value.bind(insertBuilder) : value;
              },
            });
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return callback(wrapped);
    }),
  } as unknown as Database;
}

const actor: SessionActor = {
  kind: "staff", userId: "atomicity-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards",
  organizationId: seedIds.happyOrganization, membershipId: seedIds.oliviaMembership,
  role: "owner", permissions: new Set(["customers.create", "customers.update"]),
  locationIds: new Set([seedIds.augusta]), allLocations: true,
  email: "owner@example.test", name: "Owner", packKey: null,
};

function request(method: string, body: Record<string, unknown>): Request {
  return new Request("https://crm.example/api/v1/customers", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("record mutation and event atomicity", () => {
  it("rolls back creates and updates when their durable audit write fails", async () => {
    rejectAuditAction = "customer.create";
    await expect(handleRecords(request("POST", { name: "Must Roll Back" }), ["customers"], actor))
      .rejects.toThrow("forced customer.create audit failure");
    rejectAuditAction = null;
    expect(await db.select().from(customers).where(and(
      eq(customers.tenantId, seedIds.happyTenant), eq(customers.displayName, "Must Roll Back"),
    ))).toHaveLength(0);
    expect(await db.select().from(domainEvents).where(and(
      eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.eventType, "customer.created"),
    ))).toHaveLength(0);

    const createdResponse = await handleRecords(request("POST", { name: "Atomic Customer" }), ["customers"], actor);
    const created = await createdResponse!.json() as { item: { id: string; name: string } };
    expect(created.item.name).toBe("Atomic Customer");

    rejectAuditAction = "customers.update";
    await expect(handleRecords(request("PATCH", { name: "Must Stay Atomic" }), ["customers", created.item.id], actor))
      .rejects.toThrow("forced customers.update audit failure");
    rejectAuditAction = null;
    const [customer] = await db.select().from(customers).where(and(
      eq(customers.tenantId, seedIds.happyTenant), eq(customers.id, created.item.id),
    ));
    expect(customer?.displayName).toBe("Atomic Customer");
    expect(await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, seedIds.happyTenant), eq(auditEvents.entityId, created.item.id), eq(auditEvents.action, "customers.update"),
    ))).toHaveLength(0);
  });
});
