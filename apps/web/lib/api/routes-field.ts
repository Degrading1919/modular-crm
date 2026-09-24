import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  breaks, customerAssets, files, fileLinks, formResponses, jobAssignments, jobs, memberships, mileageRecords,
  notes, organizationLocations, organizations, routeOptimizationRuns, routePlans, routeStops, serviceLocations, shifts, tenants, ticketStatusDefinitions,
  ticketTypeDefinitions, tickets, timeEntries,
} from "@modular-crm/db";
import { assertTransition, DomainError, requirePermission } from "@modular-crm/domain";
import { getCapability } from "../connectors";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized, rows, uuidArray } from "./sql";
import { assertPayrollSourceEditable } from "./payroll";
import { decryptServiceAccessInstructions } from "./service-access";
import { getAssignedJob, transitionJob } from "./workflows";
import { claimFieldOperation, completeFieldOperation, fieldEffectiveTime, fieldTimeAnomaly } from "./field-operations";

function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; }
  catch { return null; }
}

async function fieldTimeZone(actor: SessionActor, locationId: string | null | undefined): Promise<string> {
  requireStaff(actor);
  const db = getDb();
  const [row] = await db.select({ locationTimezone: organizationLocations.timezone, organizationTimezone: organizations.timezone, defaultTimezone: tenants.defaultTimezone })
    .from(organizations)
    .innerJoin(tenants, eq(tenants.id, organizations.tenantId))
    .leftJoin(organizationLocations, and(
      eq(organizationLocations.tenantId, organizations.tenantId),
      eq(organizationLocations.organizationId, organizations.id),
      locationId ? eq(organizationLocations.id, locationId) : sql.raw("false"),
    ))
    .where(and(eq(organizations.id, actor.organizationId), eq(organizations.tenantId, actor.tenantId)))
    .limit(1);
  return validTimeZone(row?.locationTimezone) ?? validTimeZone(row?.organizationTimezone) ?? validTimeZone(row?.defaultTimezone) ?? "UTC";
}

type FieldTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function fieldTimeZoneInTransaction(tx: FieldTransaction, actor: SessionActor, locationId: string | null | undefined): Promise<string> {
  requireStaff(actor);
  const [row] = await tx.select({ locationTimezone: organizationLocations.timezone, organizationTimezone: organizations.timezone, defaultTimezone: tenants.defaultTimezone })
    .from(organizations)
    .innerJoin(tenants, eq(tenants.id, organizations.tenantId))
    .leftJoin(organizationLocations, and(
      eq(organizationLocations.tenantId, organizations.tenantId),
      eq(organizationLocations.organizationId, organizations.id),
      locationId ? eq(organizationLocations.id, locationId) : sql.raw("false"),
    ))
    .where(and(eq(organizations.id, actor.organizationId), eq(organizations.tenantId, actor.tenantId)))
    .limit(1);
  return validTimeZone(row?.locationTimezone) ?? validTimeZone(row?.organizationTimezone) ?? validTimeZone(row?.defaultTimezone) ?? "UTC";
}

function dateInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return String(part("year")).padStart(4, "0") + "-" + String(part("month")).padStart(2, "0") + "-" + String(part("day")).padStart(2, "0");
}

async function today(actor: SessionActor, locationId?: string | null): Promise<string> {
  const timezone = await fieldTimeZone(actor, locationId ?? actor.defaultLocationId);
  return dateInTimeZone(new Date(), timezone);
}
const locationAllowed = (actor: SessionActor, locationId: string | null) => actor.kind === "staff" && (actor.allLocations || (!!locationId && actor.locationIds.has(locationId)));

async function routeView(actor: SessionActor, id?: string) {
  requireStaff(actor);
  requirePermission(actor, "routes.read");
  const data = await rows(sql`select rp.*, u.name as technician_name from route_plans rp
    join memberships m on m.id=rp.membership_id and m.tenant_id=rp.tenant_id
    join "user" u on u.id=m.user_id
    where rp.tenant_id=${actor.tenantId} and (${actor.allLocations} or rp.organization_location_id = any(${uuidArray(actor.locationIds)}))
    ${id ? sql`and rp.id=${id}` : sql``} order by rp.route_date desc limit ${id ? 1 : 100}`);
  if (id && !data.length) throw new DomainError("NOT_FOUND", "Route not found.", 404);
  return Promise.all(data.map(async (route) => {
    const stops = await rows(sql`select rs.id, rs.job_id, rs.sequence, rs.status, j.status as job_status,
      c.display_name as customer_name, s.name as service_name, sl.address_line1 as address,
      sl.latitude, sl.longitude from route_stops rs
      join jobs j on j.id=rs.job_id and j.tenant_id=rs.tenant_id
      join customers c on c.id=j.customer_id and c.tenant_id=j.tenant_id
      join services s on s.id=j.service_id and s.tenant_id=j.tenant_id
      join service_locations sl on sl.id=j.service_location_id and sl.tenant_id=j.tenant_id
      where rs.tenant_id=${actor.tenantId} and rs.route_plan_id=${route.id} order by rs.sequence`);
    return normalized({ ...route, date: route.route_date, technicianName: route.technician_name,
      distanceMiles: Number(route.estimated_distance_meters ?? 0) / 1609.344,
      driveMinutes: Math.round(Number(route.estimated_drive_seconds ?? 0) / 60),
      stops: stops.map((stop) => ({ ...stop, status: stop.job_status,
        latitude: stop.latitude === null ? null : Number(stop.latitude), longitude: stop.longitude === null ? null : Number(stop.longitude) })) });
  }));
}

async function createRoute(request: Request, actor: SessionActor): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "routes.create");
  const body = await readBody(request, z.object({ date: z.iso.date(), technicianId: z.uuid() }));
  const db = getDb();
  const technician = await rows(sql`select m.id,m.default_location_id from memberships m join role_templates rt on rt.id=m.role_template_id and rt.tenant_id=m.tenant_id
    where m.tenant_id=${actor.tenantId} and m.id=${body.technicianId} and m.status='active' and rt.key='technician' limit 1`);
  if (!technician.length) throw new DomainError("NOT_FOUND", "Technician not found.", 404);
  const assigned = await rows(sql`select distinct j.id, j.organization_location_id from jobs j join job_assignments ja on ja.job_id=j.id and ja.tenant_id=j.tenant_id and ja.removed_at is null
    where j.tenant_id=${actor.tenantId} and ja.membership_id=${body.technicianId} and j.scheduled_date=${body.date}
    and j.status='scheduled' order by j.id`);
  if (!assigned.length) throw new DomainError("VALIDATION_ERROR", "No assigned jobs were found for that date.", 422);
  if (assigned.some((job) => !locationAllowed(actor, job.organization_location_id as string | null))) throw new DomainError("NOT_FOUND", "Some jobs are outside your locations.", 404);
  const routeLocationId = assigned[0]!.organization_location_id as string | null;
  if (assigned.some((job) => job.organization_location_id !== routeLocationId)) throw new DomainError("VALIDATION_ERROR", "Create a separate route for each business location.", 422);
  const [route] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(routePlans).values({ tenantId: actor.tenantId, organizationLocationId: routeLocationId, membershipId: body.technicianId, routeDate: body.date, status: "draft" }).returning();
    if (!created) throw new Error("Could not create route");
    await tx.insert(routeStops).values(assigned.map((job, index) => ({ tenantId: actor.tenantId, routePlanId: created.id, jobId: String(job.id), sequence: index + 1, status: "planned" })));
    return [created];
  });
  await recordEvent(actor, { type: "route.created", entityType: "route", entityId: route.id, locationId: route.organizationLocationId, auditAction: "route.create" });
  return json({ item: (await routeView(actor, route.id))[0] }, 201);
}

async function mutateRoute(request: Request, actor: SessionActor, id: string, action?: string): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, action === "publish" ? "routes.publish" : action === "optimize" ? "routes.optimize" : "routes.reorder");
  const db = getDb();
  const [route] = await db.select().from(routePlans).where(and(eq(routePlans.tenantId, actor.tenantId), eq(routePlans.id, id))).limit(1);
  if (!route || !locationAllowed(actor, route.organizationLocationId)) throw new DomainError("NOT_FOUND", "Route not found.", 404);
  const stops = await db.select().from(routeStops).where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.routePlanId, id))).orderBy(routeStops.sequence);
  if (action === "publish") {
    assertTransition("route", route.status, "published");
    if (!stops.length) throw new DomainError("VALIDATION_ERROR", "Add stops before publishing.", 422);
    await db.transaction(async (tx) => {
      await tx.update(routePlans).set({ status: "published", publishedAt: new Date(), updatedAt: new Date() }).where(and(eq(routePlans.id, id), eq(routePlans.tenantId, actor.tenantId)));
      await tx.update(jobs).set({ status: "dispatched", assignedRouteId: id, updatedAt: new Date() }).where(and(eq(jobs.tenantId, actor.tenantId), sql`${jobs.id} = any(${uuidArray(stops.map((stop) => stop.jobId))})`, eq(jobs.status, "scheduled")));
    });
    await recordEvent(actor, { type: "route.published", entityType: "route", entityId: id, locationId: route.organizationLocationId, auditAction: "route.publish" });
  } else if (action === "optimize") {
    assertTransition("route", route.status, "optimized");
    const routing = await getCapability(actor.tenantId, "routing");
    const geocoding = await getCapability(actor.tenantId, "geocoding");
    if (!routing || !geocoding) throw new DomainError("EXTERNAL_SERVICE_ERROR", "Connect test route planning first.", 503);
    const addresses = await rows(sql`select rs.id as stop_id, sl.id as location_id, sl.address_line1, sl.city, sl.region, sl.latitude, sl.longitude
      from route_stops rs join jobs j on j.id=rs.job_id and j.tenant_id=rs.tenant_id
      join service_locations sl on sl.id=j.service_location_id and sl.tenant_id=j.tenant_id
      where rs.tenant_id=${actor.tenantId} and rs.route_plan_id=${id} order by rs.sequence`);
    const points = await Promise.all(addresses.map(async (row) => {
      const coordinates = row.latitude && row.longitude ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : (await geocoding.geocode(`${row.address_line1}, ${row.city}, ${row.region}`)).coordinates;
      await db.update(serviceLocations).set({ latitude: String(coordinates.latitude), longitude: String(coordinates.longitude), geocodeStatus: "complete", updatedAt: new Date() }).where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.id, String(row.location_id))));
      return { id: String(row.stop_id), coordinates };
    }));
    if (points.length) {
      const outcome = await routing.optimizeRoute({ start: points[0]!.coordinates, stops: points });
      await db.transaction(async (tx) => {
        for (let i = 0; i < outcome.stopIds.length; i++) await tx.update(routeStops).set({ sequence: -(i + 1), updatedAt: new Date() }).where(and(eq(routeStops.id, outcome.stopIds[i]!), eq(routeStops.tenantId, actor.tenantId)));
        for (let i = 0; i < outcome.stopIds.length; i++) await tx.update(routeStops).set({ sequence: i + 1, updatedAt: new Date() }).where(and(eq(routeStops.id, outcome.stopIds[i]!), eq(routeStops.tenantId, actor.tenantId)));
        const [run] = await tx.insert(routeOptimizationRuns).values({ tenantId: actor.tenantId, routePlanId: id, status: "completed", inputSnapshot: { stopIds: points.map((point) => point.id) }, outputSnapshot: { stopIds: outcome.stopIds }, completedAt: new Date() }).returning();
        await tx.update(routePlans).set({ estimatedDistanceMeters: Math.round(outcome.distanceKm * 1000), estimatedDriveSeconds: Math.round(outcome.durationMinutes * 60), currentOptimizationRunId: run?.id, status: "optimized", updatedAt: new Date() }).where(and(eq(routePlans.id, id), eq(routePlans.tenantId, actor.tenantId)));
      });
      await recordEvent(actor, { type: "route.optimized", entityType: "route", entityId: id, locationId: route.organizationLocationId, auditAction: "route.optimize" });
    }
  } else {
    const body = await readBody(request, z.object({ stopIds: z.array(z.uuid()).min(1) }));
    if (body.stopIds.length !== stops.length || new Set(body.stopIds).size !== stops.length || body.stopIds.some((stopId) => !stops.some((stop) => stop.id === stopId))) throw new DomainError("VALIDATION_ERROR", "Stop order must contain every stop exactly once.", 422);
    await db.transaction(async (tx) => {
      for (let i = 0; i < body.stopIds.length; i++) await tx.update(routeStops).set({ sequence: -(i + 1), updatedAt: new Date() }).where(and(eq(routeStops.id, body.stopIds[i]!), eq(routeStops.tenantId, actor.tenantId)));
      for (let i = 0; i < body.stopIds.length; i++) await tx.update(routeStops).set({ sequence: i + 1, updatedAt: new Date() }).where(and(eq(routeStops.id, body.stopIds[i]!), eq(routeStops.tenantId, actor.tenantId)));
    });
    await recordEvent(actor, { type: "route.reordered", entityType: "route", entityId: id, locationId: route.organizationLocationId, auditAction: "route.reorder" });
  }
  return json({ item: (await routeView(actor, id))[0] });
}

async function fieldRouteData(actor: SessionActor, dateMode: "today" | "nearest") {
  requireStaff(actor);
  if (actor.role !== "technician") throw new DomainError("FORBIDDEN", "Field workspace requires a technician account.", 403);
  const businessDate = await today(actor, actor.defaultLocationId);
  const routeDateCondition = dateMode === "today" ? sql`rp.route_date=${businessDate}` : sql`rp.route_date >= ${businessDate}`;
  const route = await rows(sql`select rp.* from route_plans rp where rp.tenant_id=${actor.tenantId} and rp.membership_id=${actor.membershipId}
    and ${routeDateCondition} and rp.status in ('published','started','completed')
    and (${actor.allLocations} or rp.organization_location_id = any(${uuidArray(actor.locationIds)}))
    and exists (select 1 from route_stops rs join jobs j on j.id=rs.job_id and j.tenant_id=rs.tenant_id
      where rs.tenant_id=rp.tenant_id and rs.route_plan_id=rp.id and j.scheduled_date=rp.route_date
      and (${actor.allLocations} or j.organization_location_id = any(${uuidArray(actor.locationIds)}))
      and exists (select 1 from job_assignments ja where ja.tenant_id=j.tenant_id and ja.job_id=j.id
        and ja.membership_id=rp.membership_id and ja.removed_at is null))
    order by rp.route_date asc, rp.published_at desc limit 1`);
  const list = route[0] ? await rows(sql`select j.id, j.status, j.scheduled_date, c.display_name as customer_name, c.billing_phone as phone,
    s.name as service_name, sl.address_line1 as address, sl.latitude, sl.longitude, rs.sequence, j.estimated_duration_minutes as duration_minutes
    from route_stops rs join jobs j on j.id=rs.job_id and j.tenant_id=rs.tenant_id
    join customers c on c.id=j.customer_id and c.tenant_id=j.tenant_id
    join services s on s.id=j.service_id and s.tenant_id=j.tenant_id
    join service_locations sl on sl.id=j.service_location_id and sl.tenant_id=j.tenant_id
    where rs.tenant_id=${actor.tenantId} and rs.route_plan_id=${route[0].id} and j.scheduled_date=${route[0].route_date}
      and (${actor.allLocations} or j.organization_location_id = any(${uuidArray(actor.locationIds)}))
      and exists (select 1 from job_assignments ja where ja.tenant_id=j.tenant_id and ja.job_id=j.id
        and ja.membership_id=${actor.membershipId} and ja.removed_at is null)
    order by rs.sequence`) : [];
  return {
    route: route[0] ? normalized({ ...route[0], date: route[0].route_date, distanceMiles: Number(route[0].estimated_distance_meters ?? 0) / 1609.344, driveMinutes: Math.round(Number(route[0].estimated_drive_seconds ?? 0) / 60) }) : null,
    jobs: normalized(list),
  };
}

async function fieldToday(actor: SessionActor) {
  requireStaff(actor);
  if (actor.role !== "technician") throw new DomainError("FORBIDDEN", "Field workspace requires a technician account.", 403);
  const routeData = await fieldRouteData(actor, "today");
  const [shift] = await getDb().select().from(shifts).where(and(eq(shifts.tenantId, actor.tenantId), eq(shifts.membershipId, actor.membershipId))).orderBy(sql`${shifts.clockInAt} desc`).limit(1);
  const timezone = await fieldTimeZone(actor, shift?.organizationLocationId ?? actor.defaultLocationId);
  const businessDate = dateInTimeZone(new Date(), timezone);
  const recentShift = shift && dateInTimeZone(shift.clockInAt, timezone) === businessDate ? shift : null;
  const activeBreak = recentShift ? await getDb().select().from(breaks).where(and(eq(breaks.tenantId, actor.tenantId), eq(breaks.shiftId, recentShift.id), isNull(breaks.endedAt))).limit(1) : [];
  const shiftStatus = recentShift ? recentShift.status === "clocked_in" && activeBreak.length ? "on_break" : recentShift.status : "clocked_out";
  return { ...routeData, shift: recentShift ? normalized({ ...recentShift, status: shiftStatus, startedAt: recentShift.clockInAt }) : { status: "clocked_out" } };
}

async function fieldRoute(actor: SessionActor) {
  return fieldRouteData(actor, "nearest");
}

async function fieldJob(actor: SessionActor, id: string) {
  requireStaff(actor);
  const job = await getAssignedJob(actor, id);
  if (actor.role !== "technician") throw new DomainError("FORBIDDEN", "Field workspace requires a technician account.", 403);
  const [details] = await rows(sql`select j.*, c.display_name as customer_name, c.billing_phone as phone, s.name as service_name,
    sl.address_line1 as address, sl.access_instructions_encrypted, sl.custom_fields as location_fields
    from jobs j join customers c on c.id=j.customer_id and c.tenant_id=j.tenant_id
    join services s on s.id=j.service_id and s.tenant_id=j.tenant_id
    join service_locations sl on sl.id=j.service_location_id and sl.tenant_id=j.tenant_id
    where j.id=${id} and j.tenant_id=${actor.tenantId} limit 1`);
  const pets = await rows(sql`select id,name,custom_fields from customer_assets where tenant_id=${actor.tenantId} and customer_id=${job.customerId} and archived_at is null`);
  const { access_instructions_encrypted: encryptedAccess, ...safeDetails } = details ?? {};
  return normalized({ ...safeDetails, access_notes: decryptServiceAccessInstructions(encryptedAccess), durationMinutes: job.estimatedDurationMinutes, notes: job.internalSummary, pets: pets.map((pet) => ({ ...pet, ...(pet.custom_fields as object || {}) })), ...(details?.location_fields as object || {}) });
}

async function savePhoto(tx: FieldTransaction, actor: SessionActor, jobId: string, dataUrl: string | undefined, name = "service-photo.jpg", clientOperationId?: string): Promise<string | null> {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new DomainError("VALIDATION_ERROR", "Choose a PNG, JPEG, or WebP photo.", 422);
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length > 1_500_000) throw new DomainError("VALIDATION_ERROR", "Photo must be under 1.5 MB.", 422);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const operationSeed = clientOperationId ? `${actor.tenantId}:${actor.userId}:${jobId}:${clientOperationId}` : randomUUID();
  const key = `job/${jobId}/field-${createHash("sha256").update(operationSeed).digest("hex").slice(0, 40)}`;
  const [prior] = await tx.select().from(files).where(and(eq(files.tenantId, actor.tenantId), eq(files.storageKey, key))).limit(1);
  if (prior && prior.checksum !== checksum) throw new DomainError("IDEMPOTENCY_CONFLICT", "This field operation ID was already used for a different photo.", 409);
  if (!prior) {
    const storage = await getCapability(actor.tenantId, "storage");
    if (!storage) throw new DomainError("EXTERNAL_SERVICE_ERROR", "Connect local file storage first.", 503);
    // A retry after storage succeeded but its database transaction rolled back reuses this key.
    await storage.putObject({ key, content: bytes, contentType: match[1]! });
  }
  const [file] = prior ? [prior] : await tx.insert(files).values({ tenantId: actor.tenantId, storageKey: key, originalName: name, mimeType: match[1]!, byteSize: bytes.length, checksum, visibility: "customer", uploadedByActorType: actor.kind, uploadedByActorId: actor.userId }).returning();
  if (!file) throw new Error("Could not save field photo metadata.");
  const [priorLink] = await tx.select({ id: fileLinks.id }).from(fileLinks).where(and(eq(fileLinks.tenantId, actor.tenantId), eq(fileLinks.fileId, file.id), eq(fileLinks.entityType, "job"), eq(fileLinks.entityId, jobId), eq(fileLinks.purpose, "proof"))).limit(1);
  if (!priorLink) await tx.insert(fileLinks).values({ tenantId: actor.tenantId, fileId: file.id, entityType: "job", entityId: jobId, purpose: "proof" });
  return file.id;
}

async function fieldMutation(request: Request, actor: SessionActor, id: string, action: string): Promise<Response> {
  requireStaff(actor);
  const job = await getAssignedJob(actor, id, action === "complete" ? "jobs.complete" : action === "skip" ? "jobs.skip" : "jobs.forms_submit");
  if (action === "note") {
    const body = await readBody(request, z.object({ text: z.string().default(""), photoDataUrl: z.string().optional(), photoName: z.string().optional(), clientOperationId: z.uuid().optional(), deviceTimestamp: z.iso.datetime({ offset: true }).optional(), expectedPriorState: z.string().min(1).max(40).optional() }));
    if (!body.text.trim() && !body.photoDataUrl) throw new DomainError("VALIDATION_ERROR", "Add a note or photo.", 422);
    const receivedAt = new Date();
    const outcome = await getDb().transaction(async (tx) => {
      const operation = await claimFieldOperation(tx, actor, { action: "job.note", target: id, clientOperationId: body.clientOperationId, payload: body, deviceTimestamp: body.deviceTimestamp ? new Date(body.deviceTimestamp) : null, serverReceivedAt: receivedAt });
      if (operation.replay) return { operation, noteId: operation.resultEntityId!, fileId: operation.resultRelatedId };
      await tx.execute(sql`SELECT id FROM jobs WHERE tenant_id=${actor.tenantId} AND id=${id} FOR UPDATE`);
      const [current] = await tx.select({ status: jobs.status }).from(jobs).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, id))).limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "Job not found.", 404);
      if (body.expectedPriorState !== undefined && current.status !== body.expectedPriorState) throw new DomainError("CONFLICT", "This job changed while it was offline. Review the current job before trying again.", 409, { expectedPriorState: body.expectedPriorState, currentState: current.status });
      const fileId = await savePhoto(tx, actor, id, body.photoDataUrl, body.photoName, body.clientOperationId);
      const [note] = await tx.insert(notes).values({ tenantId: actor.tenantId, entityType: "job", entityId: id, visibility: "internal", body: body.text.trim(), createdByActorType: actor.kind, createdByActorId: actor.userId }).returning();
      if (!note) throw new Error("Could not save field note.");
      await recordEvent(actor, { type: "job.note_added", entityType: "job", entityId: id, payload: { customerId: job.customerId, fileId }, locationId: job.organizationLocationId, auditAction: "job.note" }, tx);
      await completeFieldOperation(tx, actor, operation.receiptId, { kind: "job_note", entityId: note.id, relatedId: fileId, status: 201 });
      return { operation: { ...operation, responseStatus: 201 }, noteId: note.id, fileId };
    });
    const [note] = await getDb().select().from(notes).where(and(eq(notes.tenantId, actor.tenantId), eq(notes.id, outcome.noteId))).limit(1);
    if (!note) throw new Error("The saved field note could not be loaded.");
    return json({ item: normalized({ ...note, fileId: outcome.fileId ?? null }) }, outcome.operation.responseStatus);
  }
  if (action === "skip") {
    const body = await readBody(request, z.object({ reason: z.string().min(1), note: z.string().optional(), clientOperationId: z.uuid().optional(), deviceTimestamp: z.iso.datetime({ offset: true }).optional(), expectedPriorState: z.string().min(1).max(40).optional() }));
    return transitionJob(actor, id, "skipped", {
      ...body,
      fieldOperation: { action: "job.transition.skipped", target: id, clientOperationId: body.clientOperationId, payload: body, deviceTimestamp: body.deviceTimestamp ? new Date(body.deviceTimestamp) : null },
    });
  }
  if (action === "complete") {
    const body = await readBody(request, z.object({ checklist: z.object({ propertyConfirmed: z.boolean(), gateSecured: z.boolean() }), note: z.string().optional(), photoDataUrl: z.string().optional(), photoName: z.string().optional(), clientOperationId: z.uuid().optional(), deviceTimestamp: z.iso.datetime({ offset: true }).optional(), expectedPriorState: z.string().min(1).max(40).optional() }));
    if (!body.checklist.propertyConfirmed || !body.checklist.gateSecured) throw new DomainError("VALIDATION_ERROR", "Confirm the service checklist first.", 422);
    return transitionJob(actor, id, "completed", {
      ...body,
      completedChecklist: body.checklist.propertyConfirmed && body.checklist.gateSecured,
      expectedPriorState: body.expectedPriorState,
      proofProvided: !!body.photoDataUrl,
      fieldOperation: { action: "job.transition.completed", target: id, clientOperationId: body.clientOperationId, payload: body, deviceTimestamp: body.deviceTimestamp ? new Date(body.deviceTimestamp) : null },
      prepareCompletionProof: async (tx) => ({ fileId: await savePhoto(tx, actor, id, body.photoDataUrl, body.photoName, body.clientOperationId), checklist: body.checklist, membershipId: actor.membershipId! }),
      responseItem: () => fieldJob(actor, id),
    });
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}

async function fieldTime(request: Request, actor: SessionActor): Promise<Response> {
  requireStaff(actor);
  if (actor.role !== "technician") throw new DomainError("FORBIDDEN", "Field workspace requires a technician account.", 403);
  const db = getDb();
  if (request.method === "GET") {
    const state = await fieldToday(actor);
    const entries = await rows(sql`select id, source as action, starts_at as created_at, duration_seconds from time_entries where tenant_id=${actor.tenantId} and membership_id=${actor.membershipId} order by starts_at desc limit 20`);
    const miles = await rows(sql`select id, source as action, occurred_on as created_at, round(distance_meters / 1609.344,1) as miles from mileage_records where tenant_id=${actor.tenantId} and membership_id=${actor.membershipId} order by occurred_on desc limit 20`);
    return json({ item: { shift: state.shift, entries: normalized([...entries, ...miles]) } });
  }
  const body = await readBody(request, z.object({ action: z.enum(["clock_in", "clock_out", "break_start", "break_end", "mileage"]), miles: z.number().positive().optional(), clientOperationId: z.uuid().optional(), deviceTimestamp: z.iso.datetime({ offset: true }).optional() }));
  const receivedAt = new Date();
  const deviceTime = body.deviceTimestamp ? new Date(body.deviceTimestamp) : null;
  const effectiveAt = fieldEffectiveTime(deviceTime, receivedAt);
  const anomaly = fieldTimeAnomaly(deviceTime, receivedAt);
  const outcome = await db.transaction(async (tx) => {
    const operation = await claimFieldOperation(tx, actor, {
      action: `field.time.${body.action}`, target: `membership:${actor.membershipId}`, clientOperationId: body.clientOperationId,
      payload: body, deviceTimestamp: deviceTime, serverReceivedAt: receivedAt, anomalyClass: anomaly,
    });
    if (operation.replay) return { operation, item: null, duplicate: operation.resultKind === "shift_existing" };

    // Serializes distinct operations for a technician so two clock-ins cannot create parallel shifts.
    await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.id, actor.membershipId!))).for("update").limit(1);
    const [shift] = await tx.select().from(shifts)
      .where(and(eq(shifts.tenantId, actor.tenantId), eq(shifts.membershipId, actor.membershipId)))
      .orderBy(desc(shifts.clockInAt)).for("update").limit(1);
    const open = shift?.status === "clocked_in" ? shift : null;
    if (body.action === "clock_in") {
      if (open) {
        await completeFieldOperation(tx, actor, operation.receiptId, { kind: "shift_existing", entityId: open.id, state: open.status, status: 200 });
        return { operation: { ...operation, resultKind: "shift_existing", resultEntityId: open.id, resultState: open.status, responseStatus: 200 }, item: open, duplicate: true };
      }
      const first = effectiveAt < receivedAt ? effectiveAt : receivedAt;
      const last = effectiveAt > receivedAt ? effectiveAt : receivedAt;
      await assertPayrollSourceEditable(tx, actor, { startsAt: first, endsAt: last });
      const [created] = await tx.insert(shifts).values({
        tenantId: actor.tenantId, membershipId: actor.membershipId, organizationLocationId: actor.defaultLocationId,
        status: "clocked_in", clockInAt: effectiveAt,
      }).returning();
      if (!created) throw new Error("Could not clock in.");
      await completeFieldOperation(tx, actor, operation.receiptId, { kind: "shift", entityId: created.id, state: created.status, status: 201 });
      return { operation: { ...operation, resultKind: "shift", resultEntityId: created.id, resultState: created.status, responseStatus: 201 }, item: created, duplicate: false };
    }
    if (!open) throw new DomainError("INVALID_TRANSITION", "Clock in before recording work time.", 409);
    if (effectiveAt < open.clockInAt) throw new DomainError("VALIDATION_ERROR", "Device time cannot precede the shift start.", 422);
    const endOfCheckedRange = effectiveAt > receivedAt ? effectiveAt : receivedAt;
    let resultEntityId = open.id;
    if (body.action === "clock_out") {
      await assertPayrollSourceEditable(tx, actor, { startsAt: open.clockInAt, endsAt: endOfCheckedRange });
      const active = await tx.select().from(breaks).where(and(eq(breaks.tenantId, actor.tenantId), eq(breaks.shiftId, open.id), isNull(breaks.endedAt)));
      for (const item of active) {
        if (effectiveAt < item.startedAt) throw new DomainError("VALIDATION_ERROR", "Device time cannot precede the active break.", 422);
        await tx.update(breaks).set({ endedAt: effectiveAt, updatedAt: receivedAt }).where(and(eq(breaks.id, item.id), eq(breaks.tenantId, actor.tenantId)));
      }
      await tx.update(shifts).set({ status: "clocked_out", clockOutAt: effectiveAt, updatedAt: receivedAt })
        .where(and(eq(shifts.id, open.id), eq(shifts.tenantId, actor.tenantId), eq(shifts.membershipId, actor.membershipId)));
      await tx.insert(timeEntries).values({
        tenantId: actor.tenantId, membershipId: actor.membershipId, shiftId: open.id, source: "shift",
        startsAt: open.clockInAt, endsAt: effectiveAt, durationSeconds: Math.max(0, Math.round((effectiveAt.getTime() - open.clockInAt.getTime()) / 1000)), approvalStatus: "pending",
      });
    } else if (body.action === "break_start") {
      await assertPayrollSourceEditable(tx, actor, { startsAt: open.clockInAt, endsAt: endOfCheckedRange });
      const active = await tx.select().from(breaks).where(and(eq(breaks.tenantId, actor.tenantId), eq(breaks.shiftId, open.id), isNull(breaks.endedAt))).limit(1);
      if (active.length) throw new DomainError("INVALID_TRANSITION", "A break is already in progress.", 409);
      const [created] = await tx.insert(breaks).values({ tenantId: actor.tenantId, shiftId: open.id, breakType: "meal", startedAt: effectiveAt }).returning();
      if (!created) throw new Error("Could not start break.");
      resultEntityId = created.id;
    } else if (body.action === "break_end") {
      const [active] = await tx.select().from(breaks).where(and(eq(breaks.tenantId, actor.tenantId), eq(breaks.shiftId, open.id), isNull(breaks.endedAt))).limit(1);
      if (!active) throw new DomainError("INVALID_TRANSITION", "No break is in progress.", 409);
      if (effectiveAt < active.startedAt) throw new DomainError("VALIDATION_ERROR", "Device time cannot precede the break start.", 422);
      await assertPayrollSourceEditable(tx, actor, { startsAt: open.clockInAt, endsAt: endOfCheckedRange });
      await tx.update(breaks).set({ endedAt: effectiveAt, updatedAt: receivedAt }).where(and(eq(breaks.id, active.id), eq(breaks.tenantId, actor.tenantId)));
      resultEntityId = active.id;
    } else if (body.action === "mileage") {
      if (!body.miles) throw new DomainError("VALIDATION_ERROR", "Enter miles driven.", 422);
      const timezone = await fieldTimeZoneInTransaction(tx, actor, open.organizationLocationId);
      const occurredOn = dateInTimeZone(effectiveAt, timezone);
      const receivedOn = dateInTimeZone(receivedAt, timezone);
      for (const date of new Set([occurredOn, receivedOn])) await assertPayrollSourceEditable(tx, actor, { occurredOn: date });
      const [mileage] = await tx.insert(mileageRecords).values({ tenantId: actor.tenantId, membershipId: actor.membershipId, shiftId: open.id, source: "manual", distanceMeters: Math.round(body.miles * 1609.344), occurredOn }).returning();
      if (!mileage) throw new Error("Could not record mileage.");
      resultEntityId = mileage.id;
    }
    await completeFieldOperation(tx, actor, operation.receiptId, { kind: `time_${body.action}`, entityId: resultEntityId, state: body.action });
    return { operation: { ...operation, resultKind: `time_${body.action}`, resultEntityId, resultState: body.action }, item: null, duplicate: false };
  });
  if (body.action === "clock_in") {
    let item = outcome.item;
    if (!item && outcome.operation.resultEntityId) [item] = await db.select().from(shifts).where(and(eq(shifts.tenantId, actor.tenantId), eq(shifts.id, outcome.operation.resultEntityId))).limit(1);
    if (!item) throw new Error("The saved shift could not be loaded.");
    const responseItem = outcome.operation.resultState ? { ...item, status: outcome.operation.resultState } : item;
    return json({ item: normalized(responseItem), ...(outcome.duplicate ? { duplicate: true } : {}) }, outcome.operation.responseStatus);
  }
  return fieldTime(new Request(request.url, { method: "GET", headers: request.headers }), actor);
}

export async function handleRoutesField(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] === "routes") {
    if (request.method === "GET" && path.length <= 2) { const items = await routeView(actor, path[1]); return json(path[1] ? { item: items[0] } : { items }); }
    if (request.method === "POST" && path.length === 1) return createRoute(request, actor);
    if (path[1] && path.length <= 3 && ((request.method === "PATCH" && path.length === 2) || (request.method === "POST" && ["optimize", "publish"].includes(path[2] ?? "")))) return mutateRoute(request, actor, path[1], path[2]);
  }
  if (path[0] !== "field") return null;
  requireStaff(actor);
  if (request.method === "GET" && path[1] === "today") return json({ item: await fieldToday(actor) });
  if (request.method === "GET" && path[1] === "route") return json({ item: await fieldRoute(actor) });
  if (path[1] === "time" && ["GET", "POST"].includes(request.method)) return fieldTime(request, actor);
  if (request.method === "GET" && path[1] === "profile") return json({ item: normalized({ id: actor.membershipId, name: actor.name, email: actor.email, locationName: actor.defaultLocationId }) });
  if (path[1] === "jobs" && path[2]) {
    if (request.method === "GET" && path.length === 3) return json({ item: await fieldJob(actor, path[2]) });
    if (request.method === "POST" && path[3]) return fieldMutation(request, actor, path[2], path[3]);
  }
  if (path[1] === "tickets") {
    if (request.method === "GET") return json({ items: normalized(await rows(sql`select t.id,t.title as subject,t.description,ts.key as status,t.created_at from tickets t join ticket_status_definitions ts on ts.id=t.status_definition_id and ts.tenant_id=t.tenant_id where t.tenant_id=${actor.tenantId} and (t.assigned_membership_id=${actor.membershipId} or t.created_by_actor_id=${actor.userId}) order by t.created_at desc limit 100`)) });
    if (request.method === "POST") {
      const body = await readBody(request, z.object({ subject: z.string().min(2), description: z.string().min(1), type: z.string().default("field_issue"), clientOperationId: z.uuid().optional(), deviceTimestamp: z.iso.datetime({ offset: true }).optional() }));
      const db = getDb();
      const receivedAt = new Date();
      const outcome = await db.transaction(async (tx) => {
        const operation = await claimFieldOperation(tx, actor, { action: "field.ticket.create", target: `membership:${actor.membershipId}`, clientOperationId: body.clientOperationId, payload: body, deviceTimestamp: body.deviceTimestamp ? new Date(body.deviceTimestamp) : null, serverReceivedAt: receivedAt });
        if (operation.replay) return { operation, ticketId: operation.resultEntityId! };
        let [type] = await tx.select().from(ticketTypeDefinitions).where(and(eq(ticketTypeDefinitions.tenantId, actor.tenantId), eq(ticketTypeDefinitions.key, body.type))).limit(1);
        let [status] = await tx.select().from(ticketStatusDefinitions).where(and(eq(ticketStatusDefinitions.tenantId, actor.tenantId), eq(ticketStatusDefinitions.key, "open"))).limit(1);
        if (!type) [type] = await tx.insert(ticketTypeDefinitions).values({ tenantId: actor.tenantId, key: body.type, name: "Field issue" }).returning();
        if (!status) [status] = await tx.insert(ticketStatusDefinitions).values({ tenantId: actor.tenantId, key: "open", name: "Open", normalizedCategory: "open" }).returning();
        if (!type || !status) throw new Error("Could not initialize field ticket definitions.");
        const [ticket] = await tx.insert(tickets).values({ tenantId: actor.tenantId, ticketTypeId: type.id, statusDefinitionId: status.id, title: body.subject, description: body.description, createdByActorType: "staff", createdByActorId: actor.userId, assignedMembershipId: actor.membershipId }).returning();
        if (!ticket) throw new Error("Could not create field ticket.");
        await recordEvent(actor, { type: "ticket.created", entityType: "ticket", entityId: ticket.id, auditAction: "ticket.create" }, tx);
        await completeFieldOperation(tx, actor, operation.receiptId, { kind: "ticket", entityId: ticket.id, status: 201 });
        return { operation: { ...operation, responseStatus: 201 }, ticketId: ticket.id };
      });
      const [ticket] = await db.select().from(tickets).where(and(eq(tickets.tenantId, actor.tenantId), eq(tickets.id, outcome.ticketId))).limit(1);
      if (!ticket) throw new Error("The saved field ticket could not be loaded.");
      return json({ item: normalized(ticket) }, outcome.operation.responseStatus);
    }
  }
  return null;
}
