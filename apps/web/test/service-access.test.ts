import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema, seedDevelopment, seedIds, serviceLocations, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";
import { decryptServiceAccessInstructions, encryptServiceAccessInstructions } from "../lib/api/service-access.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRoutesField } = await import("../lib/api/routes-field.ts");

let pglite: PGlite;
let db: Database;
const technician: SessionActor = {
  kind: "staff", userId: "demo-happy-tech", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "terry@happyyards.test", name: "Terry Technician", role: "technician",
  permissions: permissionsForRole("technician"), locationIds: new Set([seedIds.augusta]), allLocations: false,
  membershipId: seedIds.terryMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
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

describe("service access instructions", () => {
  it("round-trips through the established v1 envelope", () => {
    process.env.BETTER_AUTH_SECRET = "service-access-test-secret";
    const encrypted = encryptServiceAccessInstructions("  Use side gate; code 2468  ");
    expect(encrypted).toMatch(/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$/);
    expect(decryptServiceAccessInstructions(encrypted)).toBe("Use side gate; code 2468");
    expect(encryptServiceAccessInstructions("  ")).toBeNull();
  });

  it("returns null for tampered and legacy fixture values", () => {
    process.env.BETTER_AUTH_SECRET = "service-access-test-secret";
    const encrypted = encryptServiceAccessInstructions("secret gate code")!;
    const [, iv, tag, ciphertext] = encrypted.split(":");
    const ciphertextBytes = Buffer.from(ciphertext!, "base64url");
    ciphertextBytes[0] = ciphertextBytes[0]! ^ 0x01;
    const changedCiphertext = ciphertextBytes.toString("base64url");
    expect(decryptServiceAccessInstructions(`v1:${iv}:${tag}:${changedCiphertext}`)).toBeNull();
    expect(decryptServiceAccessInstructions("demo-encrypted-gate-code")).toBeNull();
    expect(decryptServiceAccessInstructions("v0:legacy-envelope")).toBeNull();
    expect(decryptServiceAccessInstructions(null)).toBeNull();
  });

  it("returns decrypted instructions only through the assigned technician job route", async () => {
    process.env.BETTER_AUTH_SECRET = "service-access-test-secret";
    const encrypted = encryptServiceAccessInstructions("Call before opening the side gate")!;
    await db.update(serviceLocations).set({ accessInstructionsEncrypted: encrypted })
      .where((await import("drizzle-orm")).eq(serviceLocations.id, seedIds.carterLocation));

    const response = await handleRoutesField(new Request(`http://localhost/api/v1/field/jobs/${seedIds.upcomingJob}`), ["field", "jobs", seedIds.upcomingJob], technician);
    expect(response?.status).toBe(200);
    const payload = await response!.json() as { item: Record<string, unknown> };
    expect(payload.item.accessNotes).toBe("Call before opening the side gate");
    expect(payload.item.accessInstructionsEncrypted).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain(encrypted);
  });
});
