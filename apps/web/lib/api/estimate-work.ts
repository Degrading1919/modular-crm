import { and, asc, eq, sql } from "drizzle-orm";
import { customers, estimates, estimateRevisions, hasUsableFeature, jobs, loadTenantCapabilities, recurrenceRules, serviceLocations, servicePlans, services, tenants, type Database } from "@modular-crm/db";
import { DomainError, frozenDocument, normalizeRecurrenceFrequency, type DocumentPricing } from "@modular-crm/domain";
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
    const service = line.serviceId ? (await tx.select().from(services).where(and(eq(services.tenantId, tenantId), eq(services.organizationId, customer.organizationId), eq(services.id, line.serviceId))).limit(1))[0] : undefined;
    if (line.serviceId && !service) throw new DomainError("NOT_FOUND", "An estimated service is no longer available in this business.", 404);
    // Historical revisions predate charge metadata. Infer only when absent;
    // an explicit customer-agreed charge always wins over the catalog default.
    const charge = line.charge ?? (service?.serviceType === "recurring" ? "every_visit" : "once");
    resolved.push({ line: { ...line, charge }, service, recurring: charge === "every_visit" });
  }
  async function workService(name: string, key: string, recurring: boolean) {
    const [service] = await tx.insert(services).values({ tenantId, organizationId: customer!.organizationId, key: `estimate-${revision.id}-${key}`, name, serviceType: recurring ? "recurring" : "one_time", active: false, configuration: { estimateOnly: true, estimateRevisionId: revision.id } }).returning();
    return service!;
  }
  const recurring = resolved.filter(item => item.recurring);
  if (recurring.length) {
    if (!hasUsableFeature(capabilities, "recurring_service_management")) throw new DomainError("CAPABILITY_UNAVAILABLE", "Enable recurring services in your business setup.", 403);
    // One agreement means one visit per cycle. All accepted recurring lines
    // remain itemized on that visit; free-form additions need no service rows.
    const service = recurring.find(item => item.service)?.service ?? await workService(String(revision.snapshot.title ?? "Estimated recurring service"), "recurring", true);
    const portion = frozenDocument(recurring.map(item => item.line), pricing.taxRateBasisPoints);
    const frequency = normalizeRecurrenceFrequency(String(revision.snapshot.frequency ?? "weekly"));
    const zone = location.timezone ?? tenant?.defaultTimezone ?? "UTC";
    const [rule] = await tx.insert(recurrenceRules).values({ tenantId, ...frequency, timezone: zone }).returning();
    await tx.insert(servicePlans).values({ tenantId, customerId, serviceLocationId: location.id, organizationLocationId: location.organizationLocationId, serviceId: service.id, recurrenceRuleId: rule!.id, effectiveFrom: businessDate(new Date(), zone), status: "active", pricingSnapshot: { ...portion, currency: estimate.currency, amountMinor: portion.totalMinor, estimateId: estimate.id, estimateRevisionId: revision.id }, billingConfiguration: { type: "per_job" } });
  }
  for (const item of resolved.filter(item => !item.recurring)) {
    if (!hasUsableFeature(capabilities, "service_scheduling")) throw new DomainError("CAPABILITY_UNAVAILABLE", "Enable service scheduling for this work in your business setup.", 403);
    const { line } = item;
    const service = item.service ?? await workService(line.description, String(line.sortOrder), false);
    const portion = frozenDocument([line], pricing.taxRateBasisPoints);
    const snapshot = { ...portion, currency: estimate.currency, amountMinor: portion.totalMinor, estimateId: estimate.id, estimateRevisionId: revision.id, estimateLineOrder: line.sortOrder };
    // Setup has its own durable billing claim, independent of whether a plan
    // ever reaches its first visit. Historical plan setup snapshots still work.
    await tx.insert(jobs).values({ tenantId, organizationId: customer.organizationId, organizationLocationId: location.organizationLocationId, customerId, serviceLocationId: location.id, serviceId: service.id, status: "unscheduled", billable: true, customerSummary: line.description, priceSnapshot: snapshot });
  }
  await tx.update(estimates).set({ serviceLocationId: location.id }).where(and(eq(estimates.tenantId, tenantId), eq(estimates.id, estimate.id)));
}
