import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { connectorInstallations, type Database } from "@modular-crm/db";
import { ConnectorError, ConnectorRegistry, createMockConnectorRegistry, type CapabilityKey, type InstallationView } from "@modular-crm/connectors";
import { DomainError } from "@modular-crm/domain";
import { createLocalStorageDefinition } from "@modular-crm/connectors/local-storage";
import { createS3StorageDefinition } from "@modular-crm/connectors/s3-storage";
import { getDb } from "./db";
import { openConnectorCredentials } from "./api/connector-secrets";
import { authSigningSecret } from "./runtime-secret";

const globalForConnectors = globalThis as typeof globalThis & { modularRegistry?: ReturnType<typeof createMockConnectorRegistry> };

export function getRegistry() {
  if (!globalForConnectors.modularRegistry) {
    const registry = createMockConnectorRegistry({ includePlannedProviders: true });
    const objectStorageValues = [process.env.OBJECT_STORAGE_ENDPOINT, process.env.OBJECT_STORAGE_BUCKET, process.env.OBJECT_STORAGE_ACCESS_KEY, process.env.OBJECT_STORAGE_SECRET_KEY];
    const configuredStorageValues = objectStorageValues.filter(Boolean).length;
    if (configuredStorageValues > 0 && configuredStorageValues < objectStorageValues.length) throw new Error("Object storage configuration is incomplete");
    registry.register(createLocalStorageDefinition({
      rootDirectory: process.env.OBJECT_STORAGE_DIRECTORY ?? path.resolve(process.cwd(), "../../.local-data/files"),
      signingSecret: authSigningSecret(),
    }));
    if (configuredStorageValues === objectStorageValues.length) registry.register(createS3StorageDefinition({
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT!, bucket: process.env.OBJECT_STORAGE_BUCKET!,
      region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1", accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY!,
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY!,
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "false",
      signingSecret: authSigningSecret(),
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

type ConnectorStateWriter = Pick<Database, "select" | "insert" | "update">;
type ConnectorStateOptions = { writer?: ConnectorStateWriter; deferRuntime?: boolean };

function validationRegistry(registry: ReturnType<typeof getRegistry>, connectorKey: string): ConnectorRegistry {
  const definition = registry.getDefinition(connectorKey);
  if (!definition) throw new DomainError("NOT_FOUND", "This connection is not available yet.", 404);
  const validation = new ConnectorRegistry();
  validation.register(definition);
  return validation;
}

/** Apply a committed installation to the in-memory registry. Call after any transaction commits. */
export function applyConnectorInstallationToRegistry(installation: typeof connectorInstallations.$inferSelect): InstallationView {
  const registry = getRegistry();
  const { tenantId, connectorKey } = installation;
  const manifest = registry.getDefinition(connectorKey)?.manifest;
  if (!manifest || manifest.availability === "planned") throw new DomainError("NOT_FOUND", "This connection is not available yet.", 404);
  if (manifest.platformManaged) throw new DomainError("FORBIDDEN", "This service is managed by the platform.", 403);
  if (manifest.authType === "oauth2") {
    throw new DomainError("EXTERNAL_SERVICE_ERROR", "Sign in to this service to finish connecting it.", 409);
  }
  if (installation.status === "connected" && manifest.availability === "credentials_ready") {
    if (!installation.credentialReference) throw new DomainError("VALIDATION_ERROR", "Add the requested connection details before connecting this service.", 422);
    let credentials: Record<string, string>;
    try {
      credentials = openConnectorCredentials(installation.credentialReference, { tenantId, installationId: installation.id, connectorKey });
    } catch {
      throw new DomainError("CONFLICT", "The saved connection details could not be opened. Replace them and try again.", 409);
    }
    return connectConfiguredSafely(registry, tenantId, connectorKey, credentials);
  }
  return installation.status === "connected"
    ? (connectorKey === "local-storage" ? registry.connectLocal(tenantId, connectorKey) : registry.connectMock(tenantId, connectorKey))
    : registry.disconnect(tenantId, connectorKey);
}

function connectConfiguredSafely(
  registry: ReturnType<typeof getRegistry>, tenantId: string, connectorKey: string, credentials: Record<string, string>,
): InstallationView {
  try { return registry.connectConfigured(tenantId, connectorKey, credentials); }
  catch (error) {
    if (error instanceof ConnectorError && error.code === "invalid_request") throw new DomainError("VALIDATION_ERROR", "The saved connection details do not match this service.", 422);
    if (error instanceof ConnectorError && error.code === "connector_unavailable") throw new DomainError("EXTERNAL_SERVICE_ERROR", "The live connection flow for this service is not available yet.", 503);
    throw error;
  }
}

export async function setConnectorState(tenantId: string, connectorKey: string, connected: boolean, options: ConnectorStateOptions = {}) {
  const registry = getRegistry();
  const manifest = registry.getDefinition(connectorKey)?.manifest;
  if (!manifest || manifest.availability === "planned") throw new DomainError("NOT_FOUND", "This connection is not available yet.", 404);
  if (manifest.platformManaged) throw new DomainError("FORBIDDEN", "This service is managed by the platform.", 403);
  const writer = options.writer ?? getDb();
  const [existing] = await writer.select().from(connectorInstallations).where(and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.connectorKey, connectorKey))).limit(1);
  if (manifest.authType === "oauth2") {
    if (options.writer || options.deferRuntime) throw new DomainError("VALIDATION_ERROR", "OAuth state changes use the OAuth lifecycle.", 422);
    if (!connected) return (await import("./api/connector-oauth")).disconnectOAuthConnector(tenantId, connectorKey);
    throw new DomainError("EXTERNAL_SERVICE_ERROR", "Sign in to this service to finish connecting it.", 409);
  }

  // Validate connector behavior in an isolated registry so a failed transaction never changes
  // the process-wide capability cache. The committed row is applied to that cache afterward.
  const runtime = validationRegistry(registry, connectorKey);
  let state: InstallationView;
  if (connected && manifest.availability === "credentials_ready") {
    if (!existing?.credentialReference) throw new DomainError("VALIDATION_ERROR", "Add the requested connection details before connecting this service.", 422);
    let credentials: Record<string, string>;
    try { credentials = openConnectorCredentials(existing.credentialReference, { tenantId, installationId: existing.id, connectorKey }); }
    catch { throw new DomainError("CONFLICT", "The saved connection details could not be opened. Replace them and try again.", 409); }
    state = connectConfiguredSafely(runtime, tenantId, connectorKey, credentials);
    if (existing) await writer.update(connectorInstallations).set({ status: state.state, healthCheckedAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null, updatedAt: new Date() })
      .where(and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.id, existing.id)));
  } else {
    state = connected ? (connectorKey === "local-storage" ? runtime.connectLocal(tenantId, connectorKey) : runtime.connectMock(tenantId, connectorKey)) : runtime.disconnect(tenantId, connectorKey);
    if (existing) await writer.update(connectorInstallations).set({ status: state.state, healthCheckedAt: new Date(), lastErrorCode: state.lastErrorCode ?? null, ...(connected ? {} : { credentialReference: null }) }).where(connected
      ? and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.id, existing.id))
      : and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.connectorKey, connectorKey)));
    else await writer.insert(connectorInstallations).values({ tenantId, connectorKey, status: state.state, displayName: manifest.name, settings: { mode: "test" } });
  }

  if (options.deferRuntime) return state;
  if (!existing) {
    const [created] = await writer.select().from(connectorInstallations).where(and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.connectorKey, connectorKey))).orderBy(desc(connectorInstallations.createdAt)).limit(1);
    if (!created) throw new DomainError("EXTERNAL_SERVICE_ERROR", "The connection could not be saved.", 503);
    return applyConnectorInstallationToRegistry(created);
  }
  // Re-apply from the persisted installation after validation has succeeded.
  const [updated] = await writer.select().from(connectorInstallations).where(and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.id, existing.id))).limit(1);
  if (!updated) throw new DomainError("EXTERNAL_SERVICE_ERROR", "The connection could not be saved.", 503);
  return applyConnectorInstallationToRegistry(updated);
}
