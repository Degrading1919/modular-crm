import path from "node:path";
import { and, eq } from "drizzle-orm";
import { connectorInstallations } from "@modular-crm/db";
import { ConnectorError, createMockConnectorRegistry, type CapabilityKey } from "@modular-crm/connectors";
import { DomainError } from "@modular-crm/domain";
import { createLocalStorageDefinition } from "@modular-crm/connectors/local-storage";
import { createS3StorageDefinition } from "@modular-crm/connectors/s3-storage";
import { getDb } from "./db";
import { openConnectorCredentials } from "./api/connector-secrets";

const globalForConnectors = globalThis as typeof globalThis & { modularRegistry?: ReturnType<typeof createMockConnectorRegistry> };

export function getRegistry() {
  if (!globalForConnectors.modularRegistry) {
    const registry = createMockConnectorRegistry({ includePlannedProviders: true });
    const objectStorageValues = [process.env.OBJECT_STORAGE_ENDPOINT, process.env.OBJECT_STORAGE_BUCKET, process.env.OBJECT_STORAGE_ACCESS_KEY, process.env.OBJECT_STORAGE_SECRET_KEY];
    const configuredStorageValues = objectStorageValues.filter(Boolean).length;
    if (configuredStorageValues > 0 && configuredStorageValues < objectStorageValues.length) throw new Error("Object storage configuration is incomplete");
    if (configuredStorageValues === objectStorageValues.length) registry.register(createS3StorageDefinition({
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT!, bucket: process.env.OBJECT_STORAGE_BUCKET!,
      region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1", accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY!,
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY!,
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "false",
      signingSecret: process.env.BETTER_AUTH_SECRET ?? "dev-only-replace-before-deploying-0123456789",
    }));
    else registry.register(createLocalStorageDefinition({
      rootDirectory: process.env.OBJECT_STORAGE_DIRECTORY ?? path.resolve(process.cwd(), "../../.local-data/files"),
      signingSecret: process.env.BETTER_AUTH_SECRET ?? "dev-only-replace-before-deploying-0123456789",
    }));
    globalForConnectors.modularRegistry = registry;
  }
  return globalForConnectors.modularRegistry;
}

export async function hydrateTenantConnectors(tenantId: string) {
  const registry = getRegistry();
  const managedStorage = registry.getDefinition("s3-compatible");
  if (managedStorage && registry.getInstallation(tenantId, "s3-compatible").state !== "connected") registry.connectPlatformManaged(tenantId, "s3-compatible");
  const installations = await getDb().select().from(connectorInstallations).where(eq(connectorInstallations.tenantId, tenantId));
  for (const installation of installations) {
    if (installation.status !== "connected") continue;
    const manifest = registry.getDefinition(installation.connectorKey)?.manifest;
    if (manifest?.authType === "oauth2" && manifest.availability === "credentials_ready") {
      try { await (await import("./api/connector-oauth")).hydrateOAuthInstallation(tenantId, installation.id); }
      catch { registry.disconnect(tenantId, installation.connectorKey); }
      continue;
    }
    if (registry.getInstallation(tenantId, installation.connectorKey).state !== "connected") {
      if (manifest?.availability === "credentials_ready") {
        try { await setConnectorState(tenantId, installation.connectorKey, true); } catch { /* An unavailable live adapter must not break local capabilities. */ }
      } else if (installation.connectorKey === "local-storage") registry.connectLocal(tenantId, "local-storage");
      else registry.connectMock(tenantId, installation.connectorKey);
    }
  }
  return registry;
}

export async function getCapability<K extends CapabilityKey>(tenantId: string, key: K) {
  const registry = await hydrateTenantConnectors(tenantId);
  return registry.getCapability(tenantId, key);
}

export async function setConnectorState(tenantId: string, connectorKey: string, connected: boolean) {
  const registry = getRegistry();
  const manifest = registry.getDefinition(connectorKey)?.manifest;
  if (!manifest || manifest.availability === "planned") throw new DomainError("NOT_FOUND", "This connection is not available yet.", 404);
  if (manifest.platformManaged) throw new DomainError("FORBIDDEN", "This service is managed by the platform.", 403);
  const db = getDb();
  const [existing] = await db.select().from(connectorInstallations).where(and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.connectorKey, connectorKey))).limit(1);
  if (manifest.authType === "oauth2") {
    if (!connected) return (await import("./api/connector-oauth")).disconnectOAuthConnector(tenantId, connectorKey);
    throw new DomainError("EXTERNAL_SERVICE_ERROR", "Sign in to this service to finish connecting it.", 409);
  }
  if (connected && manifest.availability === "credentials_ready") {
    if (!existing?.credentialReference) throw new DomainError("VALIDATION_ERROR", "Add the requested connection details before connecting this service.", 422);
    let credentials: Record<string, string>;
    try {
      credentials = openConnectorCredentials(existing.credentialReference, { tenantId, installationId: existing.id, connectorKey });
    } catch {
      throw new DomainError("CONFLICT", "The saved connection details could not be opened. Replace them and try again.", 409);
    }
    let configuredState;
    try { configuredState = registry.connectConfigured(tenantId, connectorKey, credentials); }
    catch (error) {
      if (error instanceof ConnectorError && error.code === "invalid_request") throw new DomainError("VALIDATION_ERROR", "The saved connection details do not match this service.", 422);
      if (error instanceof ConnectorError && error.code === "connector_unavailable") throw new DomainError("EXTERNAL_SERVICE_ERROR", "The live connection flow for this service is not available yet.", 503);
      throw error;
    }
    await db.update(connectorInstallations).set({ status: configuredState.state, healthCheckedAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null, updatedAt: new Date() })
      .where(and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.id, existing.id)));
    return configuredState;
  }
  const state = connected ? (connectorKey === "local-storage" ? registry.connectLocal(tenantId, connectorKey) : registry.connectMock(tenantId, connectorKey)) : registry.disconnect(tenantId, connectorKey);
  if (existing) await db.update(connectorInstallations).set({ status: state.state, healthCheckedAt: new Date(), lastErrorCode: state.lastErrorCode ?? null, ...(connected ? {} : { credentialReference: null }) }).where(connected
    ? and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.id, existing.id))
    : and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.connectorKey, connectorKey)));
  else await db.insert(connectorInstallations).values({ tenantId, connectorKey, status: state.state, displayName: manifest.name, settings: { mode: "test" } });
  return state;
}
