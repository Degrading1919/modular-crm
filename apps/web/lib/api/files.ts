import { and, eq, sql } from "drizzle-orm";
import { files } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { getCapability } from "../connectors";
import { getDb } from "../db";
import { type SessionActor } from "./actor";
import { rows } from "./sql";

export async function handleFiles(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "files" || !path[1] || path[2] !== "download" || request.method !== "GET") return null;
  const [file] = await getDb().select().from(files).where(and(eq(files.id, path[1]), eq(files.tenantId, actor.tenantId))).limit(1);
  if (!file) throw new DomainError("NOT_FOUND", "File not found.", 404);
  const linked = await rows(sql`select j.id, j.customer_id, j.service_location_id, j.organization_location_id
    from file_links fl join jobs j on fl.entity_type='job' and fl.entity_id=j.id and fl.tenant_id=j.tenant_id
    where fl.tenant_id=${actor.tenantId} and fl.file_id=${file.id} limit 1`);
  const job = linked[0];
  if (!job) throw new DomainError("NOT_FOUND", "File not found.", 404);
  if (actor.kind === "customer") {
    if (file.visibility !== "customer" || !actor.customerIds.has(String(job.customer_id)) || !actor.locationIds.has(String(job.service_location_id))) throw new DomainError("NOT_FOUND", "File not found.", 404);
  } else {
    requirePermission(actor, "jobs.read");
    if (!actor.allLocations && job.organization_location_id && !actor.locationIds.has(String(job.organization_location_id))) throw new DomainError("NOT_FOUND", "File not found.", 404);
    if (actor.role === "technician") {
      const assignment = await rows(sql`select 1 from job_assignments where tenant_id=${actor.tenantId} and job_id=${job.id} and membership_id=${actor.membershipId} and removed_at is null limit 1`);
      if (!assignment.length) throw new DomainError("NOT_FOUND", "File not found.", 404);
    }
  }
  const storage = await getCapability(actor.tenantId, "storage");
  if (!storage) throw new DomainError("EXTERNAL_SERVICE_ERROR", "File storage is unavailable.", 503);
  const object = await storage.getObject(file.storageKey);
  if (!object) throw new DomainError("NOT_FOUND", "File not found.", 404);
  const safeName = file.originalName.replace(/[\r\n"\\]/g, "_");
  return new Response(new Uint8Array(object.content).buffer as ArrayBuffer, {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(object.content.byteLength),
      "content-disposition": `inline; filename="${safeName}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
