import { sql, type SQL } from "drizzle-orm";
import type { SessionActor } from "./actor";
import { uuidArray } from "./sql";

/**
 * Tickets a staff member may work on from the field (V1_PERMISSIONS: technicians get scoped
 * read/create/update for assigned or job-related tickets). Expects the ticket aliased as `t`.
 *
 * A ticket qualifies when it is assigned to the member, was created by them, or belongs to a job
 * actively assigned to them inside their location scope. Location scope still applies on top of
 * that relationship: a ticket whose business location resolves outside the member's locations is
 * excluded. Tickets with no resolvable location (field-created issues) stay visible to their owner.
 */
export function fieldTicketScope(actor: SessionActor & { kind: "staff"; membershipId: string }): SQL {
  const inScope = (column: SQL) => actor.allLocations ? sql`true` : sql`${column} = any(${uuidArray(actor.locationIds)})`;
  const ticketLocation = sql`coalesce(
    (select sl.organization_location_id from service_locations sl where sl.id=t.service_location_id and sl.tenant_id=t.tenant_id),
    (select tj.organization_location_id from jobs tj where tj.id=t.job_id and tj.tenant_id=t.tenant_id),
    (select tc.owning_location_id from customers tc where tc.id=t.customer_id and tc.tenant_id=t.tenant_id))`;
  return sql`(t.assigned_membership_id=${actor.membershipId}
      or (t.created_by_actor_type='staff' and t.created_by_actor_id=${actor.userId})
      or exists (select 1 from job_assignments ja join jobs aj on aj.id=ja.job_id and aj.tenant_id=ja.tenant_id
        where ja.tenant_id=t.tenant_id and ja.job_id=t.job_id and ja.membership_id=${actor.membershipId}
          and ja.removed_at is null and ${inScope(sql`aj.organization_location_id`)}))
    and (${ticketLocation} is null or ${inScope(ticketLocation)})`;
}
