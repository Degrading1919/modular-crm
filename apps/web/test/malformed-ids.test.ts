import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { DomainError, permissionsForRole } from "@modular-crm/domain";
import { API_CREDENTIAL_SCOPES } from "../lib/api/developer-credentials.ts";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import type { SessionActor } from "../lib/api/actor.ts";
import { apiError } from "../lib/api/http.ts";

const { getDbMock, actorMock, credentialMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), actorMock: vi.fn(), credentialMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
vi.mock("../lib/auth.ts", () => ({ auth: { api: {} } }));
vi.mock("../lib/api/actor.ts", async (original) => ({ ...await original<typeof import("../lib/api/actor.ts")>(), requireActor: actorMock }));
vi.mock("../lib/api/developer-credentials.ts", async (original) => ({ ...await original<typeof import("../lib/api/developer-credentials.ts")>(), resolveApiCredentialFromRequest: credentialMock }));

const { handleV1 } = await import("../lib/api/handler.ts");
const badId = "not-a-record-id";
const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta, seedIds.northAugusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};
const customer: SessionActor = {
  kind: "customer", userId: "demo-happy-customer", tenantId: seedIds.happyTenant, tenantName: "Happy Yards",
  packKey: "pet-waste-removal", email: "carter@example.test", name: "Carter Household",
  customerIds: new Set([seedIds.carter]), locationIds: new Set([seedIds.carterLocation]),
  customerLocationIds: new Map([[seedIds.carter, new Set([seedIds.carterLocation])]]),
};
let pglite: PGlite;
beforeAll(async () => {
  vi.stubEnv("DOMAIN_VERIFICATION_MODE", "mock");
  pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  getDbMock.mockReturnValue(db as unknown as Database);
  await seedDevelopment(db as unknown as Database);
  credentialMock.mockResolvedValue({ credentialId: crypto.randomUUID(), tenantId: seedIds.happyTenant, scopes: [...API_CREDENTIAL_SCOPES] });
}, 120_000);
afterAll(async () => { vi.unstubAllEnvs(); await pglite?.close(); });

type Case = [method: string, path: string, body?: Record<string, unknown>];
const reads: Case[] = [
  ...["leads", "customers", "jobs", "estimates", "invoices", "service-plans", "tickets", "services", "routes", "organization", "staff", "inventory", "purchase-orders"].map((root): Case => ["GET", `${root}/${badId}`]),
  ["GET", `organization/locations/${badId}`], ["GET", `invoices/${badId}/payments`],
  ...["invoice", "receipt", "statement", "completion", "estimate", "pay-statement", "royalty-statement"].map((kind): Case => ["GET", `documents/${kind}/${badId}`]),
  ["GET", `files/${badId}/download`], ["GET", `field/jobs/${badId}`],
  ["GET", `automations/${badId}`], ["GET", `automations/${badId}/runs`],
  ["GET", `customers/${badId}/portal-access`], ["GET", `payroll/periods/${badId}`],
  ["GET", `franchise/agreements/${badId}/rules`], ["GET", `franchise/agreements/${badId}/statements`],
  ["GET", `developer/webhooks/${badId}/deliveries`],
  ...["customers", "leads", "jobs", "estimates", "invoices", "payments", "service-plans", "tickets"].map((root): Case => ["GET", `public/${root}/${badId}`]),
];
const writes: Case[] = [
  ...["leads", "customers", "jobs", "estimates", "invoices", "service-plans", "tickets", "services", "routes", "organization", "staff", "automations"].map((root): Case => ["PATCH", `${root}/${badId}`, {}]),
  ["POST", `leads/${badId}/convert`],
  ...["send", "approve", "decline"].map((action): Case => ["POST", `estimates/${badId}/${action}`, {}]),
  ["POST", `jobs/${badId}/assign`, {}], ["POST", `jobs/${badId}/transition`, { status: "in_progress" }],
  ...["pause", "resume", "cancel"].map((action): Case => ["POST", `service-plans/${badId}/${action}`]),
  ...["issue", "pay"].map((action): Case => ["POST", `invoices/${badId}/${action}`, {}]),
  ["POST", `invoices/${badId}/refunds`, {}],
  ...["optimize", "publish"].map((action): Case => ["POST", `routes/${badId}/${action}`, {}]),
  ...["note", "complete", "skip"].map((action): Case => ["POST", `field/jobs/${badId}/${action}`, {}]),
  ["POST", `automations/runs/${badId}/retry`],
  ...["review", "approve", "decline"].map((action): Case => ["POST", `customer-change-requests/${badId}/${action}`, {}]),
  ["POST", `customers/${badId}/portal-access`, {}],
  ["DELETE", `customers/${seedIds.carter}/portal-access/${badId}`],
  ["DELETE", `customers/${badId}/portal-access/${crypto.randomUUID()}`],
  ...["receive", "transfer", "consume"].map((action): Case => ["POST", `inventory/${badId}/${action}`, {}]),
  ["POST", `purchase-orders/${badId}/receive`, {}],
  ["PATCH", `payroll/periods/${badId}`, {}], ["PATCH", `payroll/profiles/${badId}`, {}],
  ...["calculate", "corrections", "export"].map((action): Case => ["POST", `payroll/periods/${badId}/${action}`, {}]),
  ["POST", `franchise/agreements/${badId}/rules`, {}], ["POST", `franchise/agreements/${badId}/statements/calculate`, {}],
  ["DELETE", `developer/credentials/${badId}`], ["DELETE", `developer/webhooks/${badId}`],
  ["POST", `developer/webhooks/${badId}/test`],
  ["POST", `developer/webhooks/${badId}/deliveries/${crypto.randomUUID()}/retry`],
  ["POST", `developer/webhooks/${crypto.randomUUID()}/deliveries/${badId}/retry`],
  ["POST", `website/domains/${badId}/verify`], ["POST", `website/domains/${badId}/primary`], ["DELETE", `website/domains/${badId}`],
  ["PATCH", `public/customers/${badId}`, { name: "Updated name" }], ["PATCH", `public/leads/${badId}`, { name: "Updated name" }],
];
const portal: Case[] = [
  ["POST", `portal/feedback/${badId}`, { rating: 5 }],
  ["POST", `portal/invoices/${badId}/pay`, {}],
  ...["approve", "decline"].map((action): Case => ["POST", `portal/estimates/${badId}/${action}`, {}]),
];

async function request([method, path, body]: Case, actor: SessionActor) {
  actorMock.mockResolvedValue(actor);
  return handleV1(new Request(`http://localhost/api/v1/${path}`, { method,
    ...(method !== "GET" ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) } : {}) }), path.split("/"));
}

describe("malformed ID route sweep (actual handlers and migrated SQL fixture)", () => {
  it.each(reads)("%s /%s returns 400 or 404", async (method, path, body) => {
    const response = await request([method, path, body], owner);
    expect([400, 404], `${method} ${path}: ${await response.clone().text()}`).toContain(response.status);
  });
  it.each(writes)("%s /%s never becomes a server error", async (method, path, body) => {
    const response = await request([method, path, body], owner);
    // Empty mutation bodies may be rejected before the ID lookup by the unchanged schema.
    expect([400, 404, 422], `${method} ${path}: ${await response.clone().text()}`).toContain(response.status);
  });
  it.each(portal)("customer %s /%s returns 400 or 404", async (method, path, body) => {
    const response = await request([method, path, body], customer);
    expect([400, 404], `${method} ${path}: ${await response.clone().text()}`).toContain(response.status);
  });
  it("retains authentication and permission denial for malformed IDs", async () => {
    actorMock.mockRejectedValueOnce(new DomainError("UNAUTHENTICATED", "Sign in to continue.", 401));
    expect((await handleV1(new Request("http://localhost/api/v1/documents/invoice/not-an-id"), ["documents", "invoice", badId])).status).toBe(401);
    const response = await request(["GET", `documents/invoice/${badId}`], { ...owner, permissions: new Set() });
    expect(response.status).toBe(403);
  });
});

it("maps direct and nested PostgreSQL input errors without exposing values; other errors remain 500", async () => {
  const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const cause = Object.assign(new Error("invalid UUID private-record-input"), { code: "22P02" });
  for (const error of [cause, new Error("SQL private query", { cause: new Error("wrapper", { cause }) })]) {
    const response = apiError(error);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR", message: "Check the information you entered and try again." } });
  }
  expect(consoleInfo.mock.calls).toEqual([[JSON.stringify({ event: "api.invalid_input", level: "info", code: "22P02" })], [JSON.stringify({ event: "api.invalid_input", level: "info", code: "22P02" })]]);
  consoleInfo.mockRestore();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try { expect(apiError(Object.assign(new Error("database offline"), { code: "08006" })).status).toBe(500); }
  finally { consoleError.mockRestore(); }
});
