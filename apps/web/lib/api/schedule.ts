import { sql } from "drizzle-orm";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { businessDate } from "../dates";
import { addDays, weekStart } from "../schedule-dates";
import { requireStaff, type SessionActor } from "./actor";
import { json } from "./http";
import { normalized, rows, uuidArray } from "./sql";

/** Constant four set-based reads, including unscheduled work; never the capped /jobs list. */
export async function handleSchedule(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length !== 1 || path[0] !== "schedule" || request.method !== "GET") return null;
  requireStaff(actor); requirePermission(actor, "schedule.read"); requirePermission(actor, "jobs.read"); requirePermission(actor, "staff.read");
  if (actor.role === "technician") throw new DomainError("FORBIDDEN", "Use your assigned work view.", 403);
  const params = new URL(request.url).searchParams;
  const locationId = params.get("locationId") ? z.uuid().parse(params.get("locationId")) : null;
  const scope = (column: string) => sql`${actor.allLocations ? sql`true` : sql`${sql.raw(column)} = any(${uuidArray(actor.locationIds)})`} and ${locationId ? sql`${sql.raw(column)} = ${locationId}` : sql`true`}`;
  const branches = await rows(sql`select l.id,l.name,l.organization_id,l.timezone,o.settings->>'weekStartsOn' as week_starts_on
    from organization_locations l join organizations o on o.tenant_id=l.tenant_id and o.id=l.organization_id
    where l.tenant_id=${actor.tenantId} and l.active=true and ${actor.allLocations ? sql`true` : sql`l.id=any(${uuidArray(actor.locationIds)})`} order by l.name,l.id`);
  if (locationId && !branches.some(branch => branch.id === locationId)) throw new DomainError("NOT_FOUND", "Branch not found.", 404);
  // The selected branch governs the calendar; all-branch mode uses the actor's business.
  const organization = await rows(sql`select timezone,settings->>'weekStartsOn' as week_starts_on from organizations where tenant_id=${actor.tenantId} and id=${actor.organizationId} limit 1`);
  const calendar = locationId ? branches.find(branch => branch.id === locationId)! : organization[0]!;
  const zone = String(calendar?.timezone ?? "UTC");
  const startsOn = Number(calendar?.week_starts_on) === 0 && calendar?.week_starts_on !== null ? 0 : 1;
  const day = z.iso.date().parse(params.get("week") ?? businessDate(new Date(), zone));
  const from = weekStart(day, startsOn), through = addDays(from, 6);
  const branchIds = branches.filter(branch => !locationId || branch.id === locationId).map(branch => String(branch.id));
  const technicians = await rows(sql`select m.id,u.name,m.organization_id,
      array(select l.id from organization_locations l where l.tenant_id=m.tenant_id and l.id=any(${uuidArray(branchIds)})
        and (l.id=m.default_location_id or exists(select 1 from membership_location_scopes ms where ms.tenant_id=m.tenant_id and ms.membership_id=m.id and ms.location_id=l.id))) as location_ids
    from memberships m join "user" u on u.id=m.user_id join role_templates r on r.id=m.role_template_id and r.tenant_id=m.tenant_id
    where m.tenant_id=${actor.tenantId} and m.status='active' and r.key='technician'
      and exists(select 1 from organization_locations l where l.tenant_id=m.tenant_id and l.id=any(${uuidArray(branchIds)}) and (l.id=m.default_location_id or exists(select 1 from membership_location_scopes ms where ms.tenant_id=m.tenant_id and ms.membership_id=m.id and ms.location_id=l.id)))
    order by u.name,m.id`);
  const items = await rows(sql`select j.id,j.status,j.scheduled_date,j.updated_at,j.organization_location_id,j.assigned_route_id,
      c.display_name as customer_name,s.name as service_name,l.name as branch_name,l.timezone,
      j.service_window_start,j.service_window_end,to_char(j.service_window_start at time zone l.timezone,'HH24:MI') as start_time,to_char(j.service_window_end at time zone l.timezone,'HH24:MI') as end_time,
      a.membership_id as technician_id,u.name as technician_name
    from jobs j join customers c on c.tenant_id=j.tenant_id and c.id=j.customer_id
      join services s on s.tenant_id=j.tenant_id and s.id=j.service_id
      join organization_locations l on l.tenant_id=j.tenant_id and l.id=j.organization_location_id
      left join lateral (select ja.membership_id from job_assignments ja where ja.tenant_id=j.tenant_id and ja.job_id=j.id and ja.removed_at is null and ja.assignment_role='primary' order by ja.created_at desc,ja.id limit 1) a on true
      left join memberships m on m.tenant_id=j.tenant_id and m.id=a.membership_id left join "user" u on u.id=m.user_id
    where j.tenant_id=${actor.tenantId} and j.organization_location_id=any(${uuidArray(branchIds)}) and ${scope("j.organization_location_id")}
      and (j.scheduled_date between ${from}::date and ${through}::date or (j.scheduled_date is null and j.status in ('draft','unscheduled')))
    order by j.scheduled_date nulls last,j.service_window_start nulls last,j.id limit 10001`);
  if (items.length > 10000) throw new DomainError("VALIDATION_ERROR", "Choose a branch to view a smaller schedule.", 422);
  return json(normalized({ from, through, timeZone: zone, weekStartsOn: startsOn, branches, technicians,
    items: items.filter(item => item.scheduled_date !== null).map(item => ({ ...item, updated_at: new Date(String(item.updated_at)).toISOString() })),
    unscheduled: items.filter(item => item.scheduled_date === null).map(item => ({ ...item, updated_at: new Date(String(item.updated_at)).toISOString() })) }));
}
