import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { connectorInstallations, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { createMockConnectorRegistry } from "@modular-crm/connectors";
import { sealSecret } from "@modular-crm/domain";
import { hydrateMessagingConnector } from "./messaging-connectors.js";
import { sendThroughMessagingCapability } from "./messages-db.js";

let pglite: PGlite;
let db: Database;
const key = Buffer.alloc(32, 7).toString("base64url");
const priorKey = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;

beforeAll(async () => {
  pglite = new PGlite();
  const database = drizzle(pglite, { schema });
  await migrate(database, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = database as unknown as Database;
  await seedDevelopment(db);
  process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = key;
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  if (priorKey === undefined) delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = priorKey;
  await pglite?.close();
});

it("selects the tenant's persisted live SMS installation over the connected test service", async () => {
  const [row] = await db.insert(connectorInstallations).values({
    tenantId: seedIds.happyTenant, connectorKey: "twilio", status: "connected", displayName: "Live texting",
  }).returning();
  const credentials = { accountSid: `AC${"a".repeat(32)}`, authToken: "test-token", sender: "+15555550100" };
  await db.update(connectorInstallations).set({ credentialReference: sealSecret(JSON.stringify({
    tenantId: seedIds.happyTenant, installationId: row!.id, connectorKey: "twilio", secret: JSON.stringify(credentials),
  }), key) }).where(eq(connectorInstallations.id, row!.id));
  const provider = vi.fn(async () => new Response(JSON.stringify({ sid: `SM${"b".repeat(32)}` }), {
    status: 201, headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", provider);
  const registry = createMockConnectorRegistry({ includePlannedProviders: true });
  await hydrateMessagingConnector(db, registry, seedIds.happyTenant, "sms");
  const sent = await sendThroughMessagingCapability(registry, {
    tenantId: seedIds.happyTenant, channel: "sms", recipient: "+15555550101", body: "Service update", idempotencyKey: "live-sms-1",
  }, false);
  expect(sent.reference).toBe(`SM${"b".repeat(32)}`);
  expect(provider).toHaveBeenCalledOnce();
});

it("does not silently switch to test delivery when configured texting is unavailable", async () => {
  await db.update(connectorInstallations).set({ status: "not_connected" }).where(and(
    eq(connectorInstallations.tenantId, seedIds.happyTenant), eq(connectorInstallations.connectorKey, "mock-communication"),
  ));
  await db.update(connectorInstallations).set({ status: "needs_attention" }).where(and(
    eq(connectorInstallations.tenantId, seedIds.happyTenant), eq(connectorInstallations.connectorKey, "twilio"),
  ));
  const registry = createMockConnectorRegistry({ includePlannedProviders: true });
  await expect(hydrateMessagingConnector(db, registry, seedIds.happyTenant, "sms"))
    .rejects.toMatchObject({ code: "not_connected", retryable: false });
  expect(registry.getCapability(seedIds.happyTenant, "sms")).toBeUndefined();
});

it("requires an explicit local mock setting when no messaging service is installed", async () => {
  const prior = process.env.MOCK_CONNECTORS;
  delete process.env.MOCK_CONNECTORS;
  try {
    const registry = createMockConnectorRegistry({ includePlannedProviders: true });
    await expect(hydrateMessagingConnector(db, registry, seedIds.cleanTenant, "sms"))
      .rejects.toMatchObject({ code: "not_connected", retryable: false });
  } finally {
    if (prior === undefined) delete process.env.MOCK_CONNECTORS;
    else process.env.MOCK_CONNECTORS = prior;
  }
});
