import { and, asc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "./client.ts";
import {
  customers, customerContacts, serviceLocations, jobs, jobAssignments, invoices, payments,
  memberships, portalAccess, portalLocationAccess, roleTemplates, organizations, organizationLocations,
} from "./schema/index.ts";

export type TenantScope = {
  tenantId: string;
  organizationIds?: readonly string[];
  locationIds?: readonly string[];
};

function within(ids: readonly string[] | undefined, column: Parameters<typeof inArray>[0]): SQL | undefined {
  if (ids === undefined) return undefined;
  return ids.length ? inArray(column, [...ids]) : sql`false`;
}

/**
 * Construct with a tenant ID resolved from a trusted session or API credential.
 * Do not use a tenant ID supplied in request JSON/query parameters.
 */
export function createTenantRepository(db: Database, tenantId: string, scope: Omit<TenantScope, "tenantId"> = {}) {
  if (!tenantId) throw new Error("Tenant scope is required");
  const organizationIds = scope.organizationIds;
  const locationIds = scope.locationIds;

  const customerScope = (id?: string) => and(
    eq(customers.tenantId, tenantId),
    id ? eq(customers.id, id) : undefined,
    within(organizationIds, customers.organizationId),
    within(locationIds, customers.owningLocationId),
  );
  const jobScope = (id?: string) => and(
    eq(jobs.tenantId, tenantId),
    id ? eq(jobs.id, id) : undefined,
    within(organizationIds, jobs.organizationId),
    within(locationIds, jobs.organizationLocationId),
  );
  const invoiceScope = (id?: string) => and(
    eq(invoices.tenantId, tenantId),
    id ? eq(invoices.id, id) : undefined,
    within(organizationIds, invoices.organizationId),
    within(locationIds, invoices.organizationLocationId),
  );
  const getCustomer = async (id: string) => (await db.select().from(customers).where(customerScope(id)).limit(1))[0] ?? null;

  return {
    tenantId,
    scope: { tenantId, organizationIds, locationIds } as TenantScope,

    getCustomer,
    async listCustomers(options: { search?: string; limit?: number } = {}) {
      const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
      return db.select().from(customers).where(and(customerScope(), options.search ? ilike(customers.displayName, `%${options.search}%`) : undefined))
        .orderBy(asc(customers.displayName)).limit(limit);
    },
    async createCustomer(input: Omit<typeof customers.$inferInsert, "tenantId">) {
      // Enforce organization/location ownership before insert; the DB also validates parent references.
      const organization = (await db.select({ id: organizations.id }).from(organizations)
        .where(and(eq(organizations.tenantId, tenantId), eq(organizations.id, input.organizationId), within(organizationIds, organizations.id))).limit(1))[0];
      if (!organization) throw new Error("Forbidden or missing organization");
      if (input.owningLocationId) {
        const location = (await db.select({ id: organizationLocations.id }).from(organizationLocations)
          .where(and(eq(organizationLocations.tenantId, tenantId), eq(organizationLocations.organizationId, input.organizationId),
            eq(organizationLocations.id, input.owningLocationId), within(locationIds, organizationLocations.id))).limit(1))[0];
        if (!location) throw new Error("Forbidden or missing location");
      }
      return (await db.insert(customers).values({ ...input, tenantId }).returning())[0];
    },
    async updateCustomer(id: string, patch: Partial<Omit<typeof customers.$inferInsert, "id" | "tenantId" | "createdAt">>) {
      const { organizationId: _org, owningLocationId: _location, ...safePatch } = patch;
      return (await db.update(customers).set({ ...safePatch, updatedAt: new Date() }).where(customerScope(id)).returning())[0] ?? null;
    },
    async getCustomerContacts(customerId: string) {
      if (!(await getCustomer(customerId))) return [];
      return db.select().from(customerContacts).where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, customerId)));
    },
    async getServiceLocations(customerId: string) {
      if (!(await getCustomer(customerId))) return [];
      return db.select().from(serviceLocations).where(and(eq(serviceLocations.tenantId, tenantId), eq(serviceLocations.customerId, customerId)));
    },
    async getJob(id: string) {
      return (await db.select().from(jobs).where(jobScope(id)).limit(1))[0] ?? null;
    },
    async listJobs(options: { date?: string; status?: string; limit?: number } = {}) {
      return db.select().from(jobs).where(and(jobScope(), options.date ? eq(jobs.scheduledDate, options.date) : undefined,
        options.status ? eq(jobs.status, options.status) : undefined))
        .orderBy(asc(jobs.scheduledDate), asc(jobs.createdAt)).limit(Math.min(Math.max(options.limit ?? 100, 1), 500));
    },
    async createJob(input: Omit<typeof jobs.$inferInsert, "tenantId">) {
      const customer = await getCustomer(input.customerId);
      if (!customer || customer.organizationId !== input.organizationId) throw new Error("Forbidden or missing customer");
      const location = (await db.select().from(serviceLocations).where(and(eq(serviceLocations.tenantId, tenantId),
        eq(serviceLocations.id, input.serviceLocationId), eq(serviceLocations.customerId, input.customerId))).limit(1))[0];
      if (!location) throw new Error("Forbidden or missing service location");
      if (locationIds && (!input.organizationLocationId || !locationIds.includes(input.organizationLocationId))) throw new Error("Forbidden or missing location");
      return (await db.insert(jobs).values({ ...input, tenantId }).returning())[0];
    },
    async updateJob(id: string, patch: Partial<Omit<typeof jobs.$inferInsert, "id" | "tenantId" | "createdAt">>) {
      const { organizationId: _org, organizationLocationId: _orgLocation, customerId: _customer,
        serviceLocationId: _serviceLocation, servicePlanId: _plan, serviceId: _service, ...safePatch } = patch;
      return (await db.update(jobs).set({ ...safePatch, updatedAt: new Date() }).where(jobScope(id)).returning())[0] ?? null;
    },
    async getAssignedJob(id: string, membershipId: string) {
      return (await db.select({ job: jobs }).from(jobs).innerJoin(jobAssignments, and(eq(jobAssignments.jobId, jobs.id),
        eq(jobAssignments.tenantId, jobs.tenantId), eq(jobAssignments.membershipId, membershipId), sql`${jobAssignments.removedAt} IS NULL`))
        .where(jobScope(id)).limit(1))[0]?.job ?? null;
    },
    async getInvoice(id: string) {
      return (await db.select().from(invoices).where(invoiceScope(id)).limit(1))[0] ?? null;
    },
    async listInvoices(options: { customerId?: string; limit?: number } = {}) {
      return db.select().from(invoices).where(and(invoiceScope(), options.customerId ? eq(invoices.customerId, options.customerId) : undefined))
        .orderBy(asc(invoices.invoiceNumber)).limit(Math.min(Math.max(options.limit ?? 100, 1), 500));
    },
    async listPayments(customerId: string) {
      if (!(await getCustomer(customerId))) return [];
      return db.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.customerId, customerId)));
    },
    async getMembershipForUser(userId: string) {
      return db.select({ membership: memberships, roleKey: roleTemplates.key }).from(memberships)
        .innerJoin(roleTemplates, eq(roleTemplates.id, memberships.roleTemplateId))
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, "active")));
    },
    async getPortalCustomer(userId: string, customerId: string) {
      const link = (await db.select({ customerId: portalAccess.customerId }).from(portalAccess)
        .where(and(eq(portalAccess.tenantId, tenantId), eq(portalAccess.userId, userId), eq(portalAccess.customerId, customerId),
          eq(portalAccess.status, "active"))).limit(1))[0];
      return link ? getCustomer(link.customerId) : null;
    },
    async getPortalServiceLocations(userId: string, customerId: string) {
      return (await db.select({ location: serviceLocations }).from(portalAccess)
        .innerJoin(portalLocationAccess, and(eq(portalLocationAccess.portalAccessId, portalAccess.id),
          eq(portalLocationAccess.tenantId, portalAccess.tenantId)))
        .innerJoin(serviceLocations, and(eq(serviceLocations.id, portalLocationAccess.serviceLocationId),
          eq(serviceLocations.tenantId, portalAccess.tenantId), eq(serviceLocations.customerId, portalAccess.customerId)))
        .where(and(eq(portalAccess.tenantId, tenantId), eq(portalAccess.userId, userId),
          eq(portalAccess.customerId, customerId), eq(portalAccess.status, "active"))))
        .map((row) => row.location);
    },
    async getPortalInvoice(userId: string, invoiceId: string) {
      return (await db.select({ invoice: invoices }).from(invoices)
        .innerJoin(portalAccess, and(eq(portalAccess.tenantId, invoices.tenantId),
          eq(portalAccess.customerId, invoices.customerId), eq(portalAccess.userId, userId), eq(portalAccess.status, "active")))
        .where(invoiceScope(invoiceId)).limit(1))[0]?.invoice ?? null;
    },
  };
}

export type TenantRepository = ReturnType<typeof createTenantRepository>;
