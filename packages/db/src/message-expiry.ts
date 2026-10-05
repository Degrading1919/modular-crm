import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client.ts";
import { jobs } from "./schema/index.ts";

export const REMINDER_KEYS = ["appointment-reminder", "visit-reminder", "service-day-reminder", "route-published"];
/** Use a real window when available, otherwise the end of the job's business calendar date. */
export async function reminderDeadline(db: Database, tenantId: string, jobId: string): Promise<{ expiresAt: Date | null; active: boolean }> {
  const [row] = await db.select({ status: jobs.status, deadline: sql<Date | string | null>`coalesce(${jobs.serviceWindowStart},
    ((${jobs.scheduledDate}::date + 1)::timestamp at time zone coalesce(
      (select l.timezone from organization_locations l where l.tenant_id=${jobs.tenantId} and l.id=${jobs.organizationLocationId}),
      (select o.timezone from organizations o where o.tenant_id=${jobs.tenantId} and o.id=${jobs.organizationId}), 'UTC')))` })
    .from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId))).limit(1);
  return { expiresAt: row?.deadline ? new Date(row.deadline) : null, active: Boolean(row && ["scheduled", "dispatched", "en_route"].includes(row.status)) };
}
