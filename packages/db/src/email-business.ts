import { and, eq } from "drizzle-orm";
import { type Database } from "./client.ts";
import { customers, jobs, invoices, organizationLocations, organizations, tenants } from "./schema/index.ts";

/** Prefer the message's actual work branch; never infer a different tenant/business. */
export async function loadEmailBusiness(db: Database, tenantId: string, input: { customerId?: string | null; jobId?: string | null; invoiceId?: string | null; locationId?: string | null } = {}) {
  let locationId = input.locationId;
  if (input.jobId) locationId = (await db.select({ id: jobs.organizationLocationId }).from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, input.jobId))).limit(1))[0]?.id;
  if (input.invoiceId) locationId = (await db.select({ id: invoices.organizationLocationId }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, input.invoiceId))).limit(1))[0]?.id;
  if (!locationId && input.customerId) locationId = (await db.select({ id: customers.owningLocationId }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, input.customerId))).limit(1))[0]?.id;
  if (locationId) {
    const [row] = await db.select({ location: organizationLocations, business: organizations }).from(organizationLocations)
      .innerJoin(organizations, and(eq(organizations.id, organizationLocations.organizationId), eq(organizations.tenantId, tenantId)))
      .where(and(eq(organizationLocations.id, locationId), eq(organizationLocations.tenantId, tenantId))).limit(1);
    if (row) return { name: row.business.displayName, replyTo: row.location.email ?? row.business.email ?? undefined,
      address: row.location.addressLine1 ? [row.location.addressLine1, row.location.addressLine2, row.location.city, row.location.region, row.location.postalCode, row.location.countryCode].filter(Boolean).join(", ") : undefined };
  }
  const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error("Email business not found");
  return { name: tenant.name };
}
