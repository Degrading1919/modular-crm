import { and, eq, sql } from "drizzle-orm";
import { breaks, memberships, shifts, timeEntries } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { assertPayrollSourceEditable } from "./payroll";
import { normalized, rows, uuidArray } from "./sql";

function timeRows(items: Record<string, unknown>[]) {
  return normalized(items.map(item => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, value != null && ["updated_at", "created_at", "clock_in_at", "clock_out_at", "starts_at", "ends_at"].includes(key) ? new Date(String(value)).toISOString() : value]))));
}

const scope = (actor: SessionActor) => actor.kind === "staff" && actor.allLocations ? sql`true` : sql`coalesce(s.organization_location_id,j.organization_location_id,m.default_location_id)=any(${uuidArray(actor.locationIds)})`;

async function visibleEntries(actor: SessionActor, id?: string, page = 0) {
  return rows(sql`select t.*,t.status as approval_status,u.name as staff_name,coalesce(s.organization_location_id,j.organization_location_id,m.default_location_id) as location_id
    from time_entries t join memberships m on m.tenant_id=t.tenant_id and m.id=t.membership_id
    join "user" u on u.id=m.user_id
    left join shifts s on s.tenant_id=t.tenant_id and s.id=t.shift_id and s.membership_id=t.membership_id
    left join jobs j on j.tenant_id=t.tenant_id and j.id=t.job_id and j.organization_id=m.organization_id
    where t.tenant_id=${actor.tenantId} and m.organization_id=${actor.organizationId} and ${scope(actor)}
    and (t.shift_id is null or s.id is not null) and (t.job_id is null or j.id is not null)
    and exists(select 1 from organization_locations l where l.tenant_id=t.tenant_id and l.organization_id=m.organization_id and l.id=coalesce(s.organization_location_id,j.organization_location_id,m.default_location_id))
    and (t.shift_id is null or t.job_id is null or s.organization_location_id=j.organization_location_id)
    ${id ? sql`and t.id=${id}` : sql``} order by (t.status='pending') desc,t.starts_at desc,t.id limit ${id ? 1 : 51} offset ${id ? 0 : page * 50}`);
}

export async function handleTimeReview(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "time") return null;
  requireStaff(actor);
  requirePermission(actor, "time.all_read");
  if (path.length === 1 && request.method === "GET") {
    const page = z.coerce.number().int().min(0).max(1_000_000).parse(new URL(request.url).searchParams.get("page") ?? 0);
    const entries = await visibleEntries(actor, undefined, page);
    const open = await rows(sql`select s.*,u.name as staff_name from shifts s
      join memberships m on m.tenant_id=s.tenant_id and m.id=s.membership_id join "user" u on u.id=m.user_id
      where s.tenant_id=${actor.tenantId} and m.organization_id=${actor.organizationId} and s.status='clocked_in'
      and exists(select 1 from organization_locations l where l.tenant_id=s.tenant_id and l.organization_id=m.organization_id and l.id=s.organization_location_id)
      and (${actor.allLocations} or s.organization_location_id=any(${uuidArray(actor.locationIds)})) order by s.clock_in_at desc,s.id limit 200`);
    return json({ entries: timeRows(entries.slice(0, 50)), shifts: timeRows(open), page, hasMore: entries.length > 50 });
  }
  const id = z.uuid().parse(path[2]);
  if (path[1] === "entries" && path[3] === "approve" && path.length === 4 && request.method === "POST") {
    requirePermission(actor, "time.approve");
    const body = await readBody(request, z.object({ expectedUpdatedAt: z.iso.datetime({ offset: true }) }).strict());
    const [visible] = await visibleEntries(actor, id);
    if (!visible) throw new DomainError("NOT_FOUND", "Time entry not found.", 404);
    const entry = await getDb().transaction(async tx => {
      await assertPayrollSourceEditable(tx, actor, { startsAt: String(visible.starts_at), endsAt: String(visible.ends_at) });
      const [current] = await tx.select().from(timeEntries).where(and(eq(timeEntries.tenantId, actor.tenantId), eq(timeEntries.id, id))).for("update");
      if (!current) throw new DomainError("NOT_FOUND", "Time entry not found.", 404);
      if (current.approvalStatus === "approved") return current;
      if (current.updatedAt.toISOString() !== body.expectedUpdatedAt) throw new DomainError("CONFLICT", "This time entry changed. Refresh before approving it.", 409);
      if (current.shiftId) {
        const [shift] = await tx.select().from(shifts).where(and(eq(shifts.tenantId, actor.tenantId), eq(shifts.id, current.shiftId), eq(shifts.membershipId, current.membershipId))).limit(1);
        if (!shift?.clockOutAt || shift.status !== "clocked_out") throw new DomainError("CONFLICT", "Close the shift before approving its time.", 409);
      }
      const [saved] = await tx.update(timeEntries).set({ approvalStatus: "approved", updatedAt: new Date() }).where(and(eq(timeEntries.tenantId, actor.tenantId), eq(timeEntries.id, id))).returning();
      await recordEvent(actor, { type: "time.approved", entityType: "time_entry", entityId: id, locationId: visible.location_id as string, auditAction: "time.approve", before: { approvalStatus: current.approvalStatus }, after: { approvalStatus: "approved" }, payload: { membershipId: current.membershipId } }, tx);
      return saved;
    });
    return json({ item: normalized(entry) });
  }
  if (path[1] === "shifts" && path[3] === "clock-out" && path.length === 4 && request.method === "POST") {
    requirePermission(actor, "time.correct");
    const body = await readBody(request, z.object({ endsAt: z.iso.datetime({ offset: true }), reason: z.string().trim().min(1).max(500), expectedUpdatedAt: z.iso.datetime({ offset: true }) }).strict());
    const [visible] = await rows(sql`select s.* from shifts s join memberships m on m.tenant_id=s.tenant_id and m.id=s.membership_id
      where s.tenant_id=${actor.tenantId} and s.id=${id} and m.organization_id=${actor.organizationId}
      and exists(select 1 from organization_locations l where l.tenant_id=s.tenant_id and l.organization_id=m.organization_id and l.id=s.organization_location_id)
      and (${actor.allLocations} or s.organization_location_id=any(${uuidArray(actor.locationIds)})) limit 1`);
    if (!visible) throw new DomainError("NOT_FOUND", "Shift not found.", 404);
    const result = await getDb().transaction(async tx => {
      await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.id, String(visible.membership_id)))).for("update");
      const [shift] = await tx.select().from(shifts).where(and(eq(shifts.tenantId, actor.tenantId), eq(shifts.id, id))).for("update");
      if (!shift) throw new DomainError("NOT_FOUND", "Shift not found.", 404);
      const end = new Date(body.endsAt), now = new Date();
      if (shift.status === "clocked_out" && shift.clockOutAt?.getTime() === end.getTime() && shift.notes === body.reason) return shift;
      if (shift.status !== "clocked_in" || shift.updatedAt.toISOString() !== body.expectedUpdatedAt) throw new DomainError("CONFLICT", "This shift changed. Refresh before correcting it.", 409);
      if (end < shift.clockInAt || end > now) throw new DomainError("VALIDATION_ERROR", "Clock-out must be after clock-in and not in the future.", 422);
      await assertPayrollSourceEditable(tx, actor, { startsAt: shift.clockInAt, endsAt: end });
      const recordedBreaks = await tx.select().from(breaks).where(and(eq(breaks.tenantId, actor.tenantId), eq(breaks.shiftId, id)));
      if (recordedBreaks.some(b => b.startedAt > end || b.endedAt && b.endedAt > end)) throw new DomainError("VALIDATION_ERROR", "Clock-out cannot precede a recorded break.", 422);
      const active = recordedBreaks.filter(b => !b.endedAt);
      for (const b of active) await tx.update(breaks).set({ endedAt: end, updatedAt: now }).where(and(eq(breaks.tenantId, actor.tenantId), eq(breaks.id, b.id)));
      const [saved] = await tx.update(shifts).set({ status: "clocked_out", clockOutAt: end, notes: body.reason, updatedAt: now }).where(and(eq(shifts.tenantId, actor.tenantId), eq(shifts.id, id))).returning();
      await tx.insert(timeEntries).values({ tenantId: actor.tenantId, membershipId: shift.membershipId, shiftId: id, source: "office_correction", startsAt: shift.clockInAt, endsAt: end, durationSeconds: Math.round((end.getTime()-shift.clockInAt.getTime())/1000), approvalStatus: "pending", note: body.reason });
      await recordEvent(actor, { type: "time.corrected", entityType: "shift", entityId: id, locationId: shift.organizationLocationId, auditAction: "time.correct", before: { status: shift.status, clockOutAt: null }, after: { status: "clocked_out", clockOutAt: end.toISOString(), reason: body.reason } }, tx);
      return saved;
    });
    return json({ item: normalized(result) });
  }
  throw new DomainError("NOT_FOUND", "Time action not found.", 404);
}
