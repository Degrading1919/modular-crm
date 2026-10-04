import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { leads, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { apiError } = await import("../lib/api/http.ts");
const { handlePublicSite } = await import("../lib/api/public-site.ts");

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

async function signup(body: unknown, ip: string) {
  const request = new Request("http://localhost/api/v1/public/signup", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body),
  });
  return (await handlePublicSite(request, ["public", "signup"]).catch(apiError))!;
}

describe("public signup retries", () => {
  it("returns the original result when the same request is resent without optional fields", async () => {
    // Mirrors the signup form when no price was quoted: quoteId and paymentMethod are left out.
    const body = {
      slug: "happy-yards", address: "80 Retry Lane", zip: "30901",
      contact: { name: "Rita Retry", email: "rita.retry@example.test", phone: "706-555-0178" },
      service: { id: seedIds.weeklyService, frequency: "weekly" },
      pets: [{ name: "Rex", size: "medium" }], yard: { size: "medium" }, termsAccepted: true,
      idempotencyKey: "public-signup-retry-without-optional-fields",
    };
    const first = await signup(body, "198.51.100.231");
    expect(first.status).toBe(201);
    const created = await first.json() as { item: { id: string; kind: string } };

    const retry = await signup(body, "198.51.100.231");
    expect(retry.status).toBe(200);
    expect((await retry.json() as { item: { id: string; kind: string } }).item).toMatchObject({ id: created.item.id, kind: created.item.kind });
    if (created.item.kind === "lead") {
      expect(await db.select({ id: leads.id }).from(leads).where(eq(leads.email, "rita.retry@example.test"))).toHaveLength(1);
    }
  });

  it("still rejects a reused key with different information", async () => {
    const body = {
      slug: "happy-yards", address: "81 Retry Lane", zip: "30901",
      contact: { name: "Rob Retry", email: "rob.retry@example.test", phone: "706-555-0179" },
      service: { id: seedIds.weeklyService, frequency: "weekly" },
      pets: [{ name: "Rex", size: "medium" }], yard: { size: "medium" }, termsAccepted: true,
      idempotencyKey: "public-signup-retry-changed",
    };
    expect((await signup(body, "198.51.100.232")).status).toBe(201);
    expect((await signup({ ...body, pets: [{ name: "Max", size: "large" }] }, "198.51.100.232")).status).toBe(409);
  });
});
