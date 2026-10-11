import { and, asc, eq, sql } from "drizzle-orm";
import { customers, estimates, estimateRevisions, hasUsableFeature, jobs, loadTenantCapabilities, recurrenceRules, serviceLocations, servicePlans, services, tenants, type Database } from "@modular-crm/db";
import { documentCharges, DomainError, frozenDocument, normalizeRecurrenceFrequency, type DocumentPricing } from "@modular-crm/domain";
import { businessDate } from "../dates";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Called under the estimate lock, from both staff and secure-link approval. */
export async function createEstimateWork(tx: Tx, tenantId: string, estimate: typeof estimates.$inferSelect, revision: typeof estimateRevisions.$inferSelect, customerId: string, convertedLocationId: string | null, pricing: DocumentPricing) {
  const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId))).limit(1);
  const locationId = estimate.serviceLocationId ?? convertedLocationId;
  const locations = await tx.select().from(serviceLocations).where(and(eq(serviceLocations.tenantId, tenantId), eq(serviceLocations.customerId, customerId), eq(serviceLocations.active, true), locationId ? eq(serviceLocations.id, locationId) : estimate.organizationLocationId ? eq(serviceLocations.organizationLocationId, estimate.organizationLocationId) : sql`true`)).orderBy(asc(serviceLocations.createdAt), asc(serviceLocations.id)).limit(2);
  if (!customer || locations.length !== 1) throw new DomainError("VALIDATION_ERROR", "Choose an active service property before approving this work.", 422);
  const location = locations[0]!;
  if (estimate.organizationLocationId && estimate.organizationLocationId !== location.organizationLocationId) throw new DomainError("VALIDATION_ERROR", "The estimate property must belong to its business location.", 422);
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const capabilities = await loadTenantCapabilities(tx as unknown as Database, tenantId);
  const resolved = [];
  for (const line of pricing.items) {
    let service = line.serviceId ? (await tx.select().from(services).where(and(eq(services.tenantId, tenantId), eq(services.organizationId, customer.organizationId), eq(services.id, line.serviceId))).limit(1))[0] : undefined;
    if (line.serviceId && !service) throw new DomainError("NOT_FOUND", "An estimated service is no longer available in this business.", 404);
    if (!service) {
      // Work needs a service identity for checklists/routes. This estimate-only
      // definition is not offered as a reusable catalog choice.
      [service] = await tx.insert(services).values({ tenantId, organizationId: customer.organizationId, key: `estimate-${revision.id}-${line.sortOrder}`, name: line.description, serviceType: line.charge === "every_visit" ? "recurring" : "one_time", active: false, configuration: { estimateOnly: true, estimateRevisionId: revision.id } }).returning();
    }
    // Historical revisions predate charge metadata. Infer only when absent;
    // an explicit customer-agreed charge always wins over the catalog default.
    const charge = line.charge ?? (service!.serviceType === "recurring" ? "every_visit" : "once");
    resolved.push({ line: { ...line, charge }, service: service!, recurring: charge === "every_visit" });
  }
  const hasRecurring = resolved.some(item => item.recurring);
  const once = documentCharges({ ...pricing, items: resolved.map(item => item.line) }, "once");
  let ownsSetup = true;
  for (const { line, service, recurring } of resolved) {
    const feature = recurring ? "recurring_service_management" : "service_scheduling";
    if (!hasUsableFeature(capabilities, feature)) throw new DomainError("CAPABILITY_UNAVAILABLE", "Enable service scheduling for this work in your business setup.", 403);
    const portion = frozenDocument([line], pricing.taxRateBasisPoints);
    const snapshot = { ...portion, currency: estimate.currency, amountMinor: portion.totalMinor, estimateId: estimate.id, estimateRevisionId: revision.id, estimateLineOrder: line.sortOrder };
    if (recurring) {
      const frequency = normalizeRecurrenceFrequency(String(revision.snapshot.frequency ?? "weekly"));
      const zone = location.timezone ?? tenant?.defaultTimezone ?? "UTC";
      const [rule] = await tx.insert(recurrenceRules).values({ tenantId, ...frequency, timezone: zone }).returning();
      await tx.insert(servicePlans).values({ tenantId, customerId, serviceLocationId: location.id, organizationLocationId: location.organizationLocationId, serviceId: service.id, recurrenceRuleId: rule!.id, effectiveFrom: businessDate(new Date(), zone), status: "active", pricingSnapshot: snapshot, billingConfiguration: { type: "per_job", ...(ownsSetup ? { oneTimePricingSnapshot: once } : {}) } });
      ownsSetup = false;
    } else {
      // Existing recurring contracts bill setup with the first visit. The work
      // still has its own schedulable job, but is never billed a second time.
      const setup = hasRecurring && line.charge === "once";
      await tx.insert(jobs).values({ tenantId, organizationId: customer.organizationId, organizationLocationId: location.organizationLocationId, customerId, serviceLocationId: location.id, serviceId: service.id, status: "unscheduled", billable: !setup, customerSummary: line.description, priceSnapshot: { ...snapshot, ...(setup ? { billingIncludedInFirstVisit: true } : {}) } });
    }
  }
  await tx.update(estimates).set({ serviceLocationId: location.id }).where(and(eq(estimates.tenantId, tenantId), eq(estimates.id, estimate.id)));
}
