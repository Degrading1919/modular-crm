import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { connectorInstallations } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getRegistry } from "../connectors";
import { getDb } from "../db";
import type { SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, requireMethod } from "./http";
import { CONNECTOR_CREDENTIAL_MAX_LENGTH, sealConnectorCredentials } from "./connector-secrets";

const bodySchema = z.object({
  credentials: z.record(z.string(), z.string()),
  installationId: z.string().uuid().optional(),
}).strict();

async function boundedBody(request: Request): Promise<z.infer<typeof bodySchema>> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 16_384) throw new DomainError("VALIDATION_ERROR", "Request is too large.", 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 16_384) throw new DomainError("VALIDATION_ERROR", "Request is too large.", 413);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new DomainError("VALIDATION_ERROR", "Invalid JSON request.", 400); }
  return bodySchema.parse(parsed);
}

function assertOwner(actor: SessionActor): asserts actor is SessionActor & { kind: "staff"; membershipId: string; organizationId: string } {
  requirePermission(actor, "connectors.configure");
  if (actor.kind !== "staff" || actor.role !== "owner" || !actor.membershipId || !actor.organizationId) {
    throw new DomainError("FORBIDDEN", "Only a business owner can manage connector credentials.", 403);
  }
}

function eligibleConnector(connectorKey: string) {
  const manifest = getRegistry().listCatalog().find((candidate) => candidate.key === connectorKey);
  if (!manifest || manifest.availability !== "credentials_ready" || manifest.credentialSetup !== true
    || !["api_key", "service_account"].includes(manifest.authType) || !manifest.credentialFields?.length) {
    throw new DomainError("NOT_FOUND", "Credential setup is not available for this service.", 404);
  }
  return manifest;
}

export async function handleConnectorCredentials(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "connections" || path.length !== 3 || path[2] !== "credentials") return null;
  const connectorKey = path[1]!;
  assertOwner(actor);
  const manifest = eligibleConnector(connectorKey);
  if (request.method === "POST") {
    requireMethod(request, "POST");
    requirePermission(actor, "connectors.configure");
    const body = await boundedBody(request);
    if (Object.keys(body.credentials).length < 1 || Object.keys(body.credentials).length > 8) {
      throw new DomainError("VALIDATION_ERROR", "Provide between 1 and 8 credential fields.", 422);
    }
    const fieldMap = new Map(manifest.credentialFields!.map((field) => [field.key, field]));
    if (Object.keys(body.credentials).length !== fieldMap.size || Object.keys(body.credentials).some((key) => !fieldMap.has(key))) {
      throw new DomainError("VALIDATION_ERROR", "Provide the credential fields requested for this service.", 422);
    }
    for (const [key, value] of Object.entries(body.credentials)) {
      const field = fieldMap.get(key)!;
      if (!value.trim() || value.length > (field.maxLength ?? CONNECTOR_CREDENTIAL_MAX_LENGTH)) {
        throw new DomainError("VALIDATION_ERROR", "A credential field is empty or too long.", 422);
      }
    }
    const db = getDb();
    const condition = body.installationId
      ? and(eq(connectorInstallations.id, body.installationId), eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey))
      : and(eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey));
    const [prior] = await db.select().from(connectorInstallations).where(condition).orderBy(desc(connectorInstallations.createdAt)).limit(1);
    if (body.installationId && !prior) throw new DomainError("NOT_FOUND", "Connection not found.", 404);
    const installationId = prior?.id ?? randomUUID();
    const credentialReference = sealConnectorCredentials(body.credentials, { tenantId: actor.tenantId, installationId, connectorKey });
    if (prior) {
      await db.update(connectorInstallations).set({ credentialReference, status: "not_connected", updatedAt: new Date() })
        .where(and(eq(connectorInstallations.id, prior.id), eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey)));
    } else {
      await db.insert(connectorInstallations).values({
        id: installationId, tenantId: actor.tenantId, connectorKey, displayName: manifest.name,
        status: "not_connected", credentialReference, settings: {},
      });
    }
    await recordEvent(actor, {
      type: "connector.credential_saved", entityType: "connector_installation", entityId: installationId,
      payload: { connectorKey }, auditAction: "connector.credential_saved",
      before: { credentialConfigured: Boolean(prior?.credentialReference) }, after: { credentialConfigured: true },
    });
    return json({ item: { installationId, connectorKey, credentialConfigured: true, status: "not_connected" } }, prior ? 200 : 201);
  }
  if (request.method === "DELETE") {
    requireMethod(request, "DELETE");
    requirePermission(actor, "connectors.disconnect");
    const installationId = new URL(request.url).searchParams.get("installationId");
    if (installationId && !z.string().uuid().safeParse(installationId).success) throw new DomainError("VALIDATION_ERROR", "Installation ID is invalid.", 422);
    const db = getDb();
    const condition = installationId
      ? and(eq(connectorInstallations.id, installationId), eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey))
      : and(eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey));
    const [prior] = await db.select().from(connectorInstallations).where(condition).orderBy(desc(connectorInstallations.createdAt)).limit(1);
    if (!prior) throw new DomainError("NOT_FOUND", "Connection not found.", 404);
    await db.update(connectorInstallations).set({ credentialReference: null, status: "not_connected", updatedAt: new Date() })
      .where(and(eq(connectorInstallations.id, prior.id), eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey)));
    await recordEvent(actor, {
      type: "connector.credential_removed", entityType: "connector_installation", entityId: prior.id,
      payload: { connectorKey }, auditAction: "connector.credential_removed",
      before: { credentialConfigured: Boolean(prior.credentialReference) }, after: { credentialConfigured: false },
    });
    return json({ item: { installationId: prior.id, connectorKey, credentialConfigured: false, status: "not_connected" } });
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
