import type { Database } from "./client.ts";
import {
  account, user, tenants, organizations, organizationLocations, roleTemplates, permissions, rolePermissions,
  memberships, membershipLocationScopes, customers, customerContacts, serviceLocations, customerAssets,
  customerPreferences, portalAccess, portalLocationAccess, leadSources, leads, services, serviceZones, priceRules,
  estimates, estimateRevisions, estimateItems, estimateApprovals,
  recurrenceRules, servicePlans, jobs, jobAssignments, jobStatusEvents, routePlans, routeStops,
  invoices, invoiceItems, payments, paymentAllocations, refunds, tips, ticketTypeDefinitions, ticketStatusDefinitions,
  tickets, ticketComments, completionProofs, sites, domains, siteContents, siteForms, connectorInstallations,
  shifts, breaks, timeEntries, mileageRecords, compensationProfiles, payrollPeriods, payrollCalculations,
  payrollComponents, inventoryItems, inventoryLocations, stockMovements, vendors, purchaseOrders, purchaseOrderItems,
  automationRules, automationRuns, domainEvents, auditEvents, notificationPreferences, consentRecords,
} from "./schema/index.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const seedIds = {
  happyTenant: uuid(1), cleanTenant: uuid(2),
  happyOrganization: uuid(10), cleanOrganization: uuid(20),
  augusta: uuid(11), northAugusta: uuid(12), cleanBranch: uuid(21),
  happyOwnerRole: uuid(30), happyOfficeRole: uuid(31), happyTechRole: uuid(32),
  cleanOwnerRole: uuid(33), cleanTechRole: uuid(34),
  oliviaMembership: uuid(40), morganMembership: uuid(41), terryMembership: uuid(42), caseyMembership: uuid(43),
  cleanOwnerMembership: uuid(44), cleanTechMembership: uuid(45),
  carter: uuid(100), nguyen: uuid(101), riverfront: uuid(102), cleanCarter: uuid(103), cleanRivera: uuid(104),
  carterLocation: uuid(110), nguyenLocation: uuid(111), riverfrontLocation: uuid(112), cleanCarterLocation: uuid(113), cleanRiveraLocation: uuid(114),
  weeklyService: uuid(200), commercialService: uuid(201), cleanService: uuid(202),
  weeklyRule: uuid(210), fortnightRule: uuid(211), cleanWeeklyRule: uuid(212),
  carterPlan: uuid(220), nguyenPlan: uuid(221), riverfrontPlan: uuid(222), cleanCarterPlan: uuid(223),
  completedJob: uuid(300), upcomingJob: uuid(301), skippedJob: uuid(302), recleanJob: uuid(303), cleanJob: uuid(304),
  happyRoute: uuid(310), cleanRoute: uuid(311),
  happyInvoice: uuid(400), overdueInvoice: uuid(401), cleanInvoice: uuid(402),
  happyPayment: uuid(410), cleanPayment: uuid(411),
  happySite: uuid(500), cleanSite: uuid(501),
  happyLocalStorage: uuid(534), cleanLocalStorage: uuid(535),
} as const;

export const seedUserIds = {
  happyOwner: "demo-happy-owner", happyManager: "demo-happy-manager", happyTech: "demo-happy-tech",
  happySecondTech: "demo-happy-second-tech", happyCustomer: "demo-happy-customer",
  cleanOwner: "demo-clean-owner", cleanTech: "demo-clean-tech", cleanCustomer: "demo-clean-customer",
} as const;
export type SeedActorKey = keyof typeof seedUserIds;

const day = (offset: number) => {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const at = (offset: number, hour = 14) => new Date(`${day(offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);

const permissionCatalog: Record<string, string[]> = {
  tenant: ["read", "update", "billing_manage", "security_manage", "audit_read", "delete"],
  organization: ["read", "update", "locations_manage", "franchise_manage", "rollup_reports_read"],
  staff: ["read", "invite", "update", "deactivate"], roles: ["read", "manage"], compensation: ["read", "manage"],
  leads: ["read", "create", "update", "convert", "archive", "export"],
  customers: ["read", "create", "update", "status_manage", "archive", "export", "sensitive_access_read"],
  estimates: ["read", "create", "update_draft", "send", "cancel"], services: ["read", "manage"],
  pricing: ["read", "manage"], promotions: ["manage"],
  service_plans: ["read", "create", "update", "pause", "cancel"], schedule: ["read", "manage"],
  jobs: ["read", "create", "update", "assign", "dispatch", "start", "complete", "skip", "cancel", "reopen", "forms_submit", "files_add"],
  routes: ["read", "create", "optimize", "reorder", "publish", "reoptimize_live", "close"],
  invoices: ["read", "create", "issue", "adjust", "void"], payments: ["read", "collect", "record_manual", "refund"],
  billing: ["settings_manage", "export"], tax: ["manage"],
  communications: ["read", "send", "templates_manage", "settings_manage"],
  tickets: ["read", "create", "update", "assign", "close", "configure"],
  time: ["own_read", "own_create", "own_correct_request", "all_read", "correct", "approve"],
  mileage: ["own_manage", "all_read"], payroll: ["read", "calculate", "review", "approve", "export"],
  inventory: ["read", "manage_catalog", "receive", "transfer", "adjust", "consume", "reorder_manage"],
  automations: ["read", "create", "update", "activate", "archive", "runs_read", "runs_retry"],
  connectors: ["read", "install", "configure", "disconnect", "sync_manage", "logs_read"],
  website: ["read", "content_manage", "forms_manage", "preview", "publish", "domains_manage"],
  reports: ["operational_read", "financial_read", "staff_read", "payroll_read", "inventory_read", "franchise_read", "export"],
};

/** Idempotent, development-only business fixtures. Password accounts are created by the auth package. */
export async function seedDevelopment(db: Database, actorIds: Partial<Record<SeedActorKey, string>> = {}) {
  const actors = { ...seedUserIds, ...actorIds };
  await db.transaction(async (tx) => {
    await tx.insert(user).values([
      { id: actors.happyOwner, name: "Olivia Owner", email: "owner@happyyards.test", emailVerified: true },
      { id: actors.happyManager, name: "Morgan Manager", email: "manager@happyyards.test", emailVerified: true },
      { id: actors.happyTech, name: "Terry Tech", email: "tech@happyyards.test", emailVerified: true },
      { id: actors.happySecondTech, name: "Casey Tech", email: "casey@happyyards.test", emailVerified: true },
      { id: actors.happyCustomer, name: "Alex Carter", email: "customer@happyyards.test", emailVerified: true },
      { id: actors.cleanOwner, name: "Taylor Owner", email: "owner@cleanpaws.test", emailVerified: true },
      { id: actors.cleanTech, name: "Riley Tech", email: "tech@cleanpaws.test", emailVerified: true },
      { id: actors.cleanCustomer, name: "Jamie Carter", email: "customer@cleanpaws.test", emailVerified: true },
    ]).onConflictDoNothing();

    await tx.insert(tenants).values([
      { id: seedIds.happyTenant, name: "Happy Yards Pet Waste", slug: "happy-yards", status: "active", industryPackKey: "pet-waste-removal", industryPackVersion: "1.0.0" },
      { id: seedIds.cleanTenant, name: "CleanPaws Route Service", slug: "cleanpaws", status: "active", industryPackKey: "pet-waste-removal", industryPackVersion: "1.0.0" },
    ]).onConflictDoNothing();
    await tx.insert(organizations).values([
      { id: seedIds.happyOrganization, tenantId: seedIds.happyTenant, organizationType: "business", legalName: "Happy Yards Pet Waste LLC", displayName: "Happy Yards Pet Waste", email: "hello@happyyards.local" },
      { id: seedIds.cleanOrganization, tenantId: seedIds.cleanTenant, organizationType: "business", legalName: "CleanPaws Route Service LLC", displayName: "CleanPaws Route Service", email: "hello@cleanpaws.local" },
    ]).onConflictDoNothing();
    await tx.insert(organizationLocations).values([
      { id: seedIds.augusta, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, name: "Augusta Branch", code: "AUG", city: "Augusta", region: "GA", postalCode: "30901", addressLine1: "125 Broad Street" },
      { id: seedIds.northAugusta, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, name: "North Augusta Branch", code: "NAUG", city: "North Augusta", region: "SC", postalCode: "29841", addressLine1: "20 Georgia Avenue" },
      { id: seedIds.cleanBranch, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, name: "Main Branch", code: "MAIN", city: "Augusta", region: "GA", postalCode: "30901", addressLine1: "8 Broad Street" },
    ]).onConflictDoNothing();

    await tx.insert(roleTemplates).values([
      { id: seedIds.happyOwnerRole, tenantId: seedIds.happyTenant, key: "owner", name: "Owner / Admin", system: true },
      { id: seedIds.happyOfficeRole, tenantId: seedIds.happyTenant, key: "office", name: "Office / Manager", system: true },
      { id: seedIds.happyTechRole, tenantId: seedIds.happyTenant, key: "technician", name: "Field Technician", system: true },
      { id: seedIds.cleanOwnerRole, tenantId: seedIds.cleanTenant, key: "owner", name: "Owner / Admin", system: true },
      { id: seedIds.cleanTechRole, tenantId: seedIds.cleanTenant, key: "technician", name: "Field Technician", system: true },
    ]).onConflictDoNothing();
    const allPermissionKeys = Object.entries(permissionCatalog).flatMap(([category, actions]) => actions.map((action) => ({ key: `${category}.${action}`, category, description: `${category} ${action.replaceAll("_", " ")}` })));
    await tx.insert(permissions).values(allPermissionKeys).onConflictDoNothing();
    const officeCategories = new Set(["leads", "customers", "estimates", "schedule", "jobs", "routes", "invoices", "payments", "communications", "tickets", "time", "mileage", "inventory", "reports"]);
    const technicianKeys = new Set(["customers.read", "schedule.read", "jobs.read", "jobs.start", "jobs.complete", "jobs.skip", "jobs.forms_submit", "jobs.files_add", "routes.read", "tickets.read", "tickets.create", "time.own_read", "time.own_create", "time.own_correct_request", "mileage.own_manage", "inventory.read", "inventory.consume"]);
    await tx.insert(rolePermissions).values(allPermissionKeys.flatMap(({ key, category }) => [
      { roleTemplateId: seedIds.happyOwnerRole, permissionKey: key, allowed: true },
      { roleTemplateId: seedIds.cleanOwnerRole, permissionKey: key, allowed: true },
      { roleTemplateId: seedIds.happyOfficeRole, permissionKey: key, allowed: officeCategories.has(category) },
      { roleTemplateId: seedIds.happyTechRole, permissionKey: key, allowed: technicianKeys.has(key) },
      { roleTemplateId: seedIds.cleanTechRole, permissionKey: key, allowed: technicianKeys.has(key) },
    ])).onConflictDoNothing();

    await tx.insert(memberships).values([
      { id: seedIds.oliviaMembership, tenantId: seedIds.happyTenant, userId: actors.happyOwner, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta, roleTemplateId: seedIds.happyOwnerRole, status: "active", joinedAt: at(-30) },
      { id: seedIds.morganMembership, tenantId: seedIds.happyTenant, userId: actors.happyManager, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta, roleTemplateId: seedIds.happyOfficeRole, status: "active", joinedAt: at(-25) },
      { id: seedIds.terryMembership, tenantId: seedIds.happyTenant, userId: actors.happyTech, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta, roleTemplateId: seedIds.happyTechRole, status: "active", joinedAt: at(-20) },
      { id: seedIds.caseyMembership, tenantId: seedIds.happyTenant, userId: actors.happySecondTech, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.northAugusta, roleTemplateId: seedIds.happyTechRole, status: "active", joinedAt: at(-20) },
      { id: seedIds.cleanOwnerMembership, tenantId: seedIds.cleanTenant, userId: actors.cleanOwner, organizationId: seedIds.cleanOrganization, defaultLocationId: seedIds.cleanBranch, roleTemplateId: seedIds.cleanOwnerRole, status: "active", joinedAt: at(-30) },
      { id: seedIds.cleanTechMembership, tenantId: seedIds.cleanTenant, userId: actors.cleanTech, organizationId: seedIds.cleanOrganization, defaultLocationId: seedIds.cleanBranch, roleTemplateId: seedIds.cleanTechRole, status: "active", joinedAt: at(-20) },
    ]).onConflictDoNothing();
    await tx.insert(membershipLocationScopes).values([
      { tenantId: seedIds.happyTenant, membershipId: seedIds.oliviaMembership, locationId: seedIds.augusta }, { tenantId: seedIds.happyTenant, membershipId: seedIds.oliviaMembership, locationId: seedIds.northAugusta },
      { tenantId: seedIds.happyTenant, membershipId: seedIds.morganMembership, locationId: seedIds.augusta }, { tenantId: seedIds.happyTenant, membershipId: seedIds.terryMembership, locationId: seedIds.augusta },
      { tenantId: seedIds.happyTenant, membershipId: seedIds.caseyMembership, locationId: seedIds.northAugusta },
      { tenantId: seedIds.cleanTenant, membershipId: seedIds.cleanOwnerMembership, locationId: seedIds.cleanBranch }, { tenantId: seedIds.cleanTenant, membershipId: seedIds.cleanTechMembership, locationId: seedIds.cleanBranch },
    ]).onConflictDoNothing();

    await tx.insert(leadSources).values([
      { id: uuid(80), tenantId: seedIds.happyTenant, name: "Website", category: "online" },
      { id: uuid(81), tenantId: seedIds.happyTenant, name: "Referral", category: "referral" },
      { id: uuid(82), tenantId: seedIds.cleanTenant, name: "Website", category: "online" },
    ]).onConflictDoNothing();
    await tx.insert(customers).values([
      { id: seedIds.carter, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, owningLocationId: seedIds.augusta, displayName: "Carter Household", customerType: "residential", status: "active", billingEmail: "carter@example.test", billingPhone: "555-0101", customFields: { petCount: 2, autopay: true } },
      { id: seedIds.nguyen, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, owningLocationId: seedIds.augusta, displayName: "Nguyen Household", customerType: "residential", status: "paused", billingEmail: "nguyen@example.test", billingPhone: "555-0102", customFields: { petCount: 1, safetyFlag: true } },
      { id: seedIds.riverfront, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, owningLocationId: seedIds.northAugusta, displayName: "Riverfront Apartments", customerType: "commercial", status: "active", companyName: "Riverfront Apartments", billingEmail: "accounts@riverfront.test", paymentTermsDays: 30 },
      { id: seedIds.cleanCarter, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, owningLocationId: seedIds.cleanBranch, displayName: "Carter Household", customerType: "residential", status: "active", billingEmail: "carter@example.test", billingPhone: "555-0101" },
      { id: seedIds.cleanRivera, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, owningLocationId: seedIds.cleanBranch, displayName: "Rivera Household", customerType: "residential", status: "active", billingEmail: "rivera@example.test" },
    ]).onConflictDoNothing();
    await tx.insert(customerContacts).values([
      { id: uuid(120), tenantId: seedIds.happyTenant, customerId: seedIds.carter, firstName: "Alex", lastName: "Carter", email: "carter@example.test", phone: "555-0101", isPrimary: true, billingContact: true, serviceContact: true },
      { id: uuid(121), tenantId: seedIds.happyTenant, customerId: seedIds.nguyen, firstName: "Mina", lastName: "Nguyen", email: "nguyen@example.test", isPrimary: true, billingContact: true, serviceContact: true },
      { id: uuid(122), tenantId: seedIds.happyTenant, customerId: seedIds.riverfront, firstName: "Pat", lastName: "Manager", email: "manager@riverfront.test", isPrimary: true, serviceContact: true },
      { id: uuid(123), tenantId: seedIds.happyTenant, customerId: seedIds.riverfront, firstName: "Lee", lastName: "Accounts", email: "accounts@riverfront.test", billingContact: true },
      { id: uuid(124), tenantId: seedIds.cleanTenant, customerId: seedIds.cleanCarter, firstName: "Jamie", lastName: "Carter", email: "carter@example.test", isPrimary: true, billingContact: true },
      { id: uuid(125), tenantId: seedIds.cleanTenant, customerId: seedIds.cleanRivera, firstName: "Sam", lastName: "Rivera", email: "rivera@example.test", isPrimary: true },
    ]).onConflictDoNothing();
    await tx.insert(serviceLocations).values([
      { id: seedIds.carterLocation, tenantId: seedIds.happyTenant, customerId: seedIds.carter, organizationLocationId: seedIds.augusta, name: "Home", addressLine1: "42 Oak Lane", city: "Augusta", region: "GA", postalCode: "30909", geocodeStatus: "verified", latitude: "33.4735000", longitude: "-82.0105000", accessInstructionsEncrypted: "demo-encrypted-gate-code", customFields: { yardSize: "medium" } },
      { id: seedIds.nguyenLocation, tenantId: seedIds.happyTenant, customerId: seedIds.nguyen, organizationLocationId: seedIds.augusta, name: "Home", addressLine1: "83 Maple Drive", city: "Augusta", region: "GA", postalCode: "30909", geocodeStatus: "verified", latitude: "33.4740000", longitude: "-82.0110000" },
      { id: seedIds.riverfrontLocation, tenantId: seedIds.happyTenant, customerId: seedIds.riverfront, organizationLocationId: seedIds.northAugusta, name: "Main grounds", addressLine1: "500 Riverfront Drive", city: "North Augusta", region: "SC", postalCode: "29841", geocodeStatus: "verified", customFields: { workAreas: ["North lawn", "Dog run"] } },
      { id: seedIds.cleanCarterLocation, tenantId: seedIds.cleanTenant, customerId: seedIds.cleanCarter, organizationLocationId: seedIds.cleanBranch, name: "Home", addressLine1: "42 Oak Lane", city: "Augusta", region: "GA", postalCode: "30909", geocodeStatus: "verified" },
      { id: seedIds.cleanRiveraLocation, tenantId: seedIds.cleanTenant, customerId: seedIds.cleanRivera, organizationLocationId: seedIds.cleanBranch, name: "Home", addressLine1: "12 Pine Street", city: "Augusta", region: "GA", postalCode: "30909", geocodeStatus: "verified" },
    ]).onConflictDoNothing();
    await tx.insert(customerAssets).values([
      { id: uuid(130), tenantId: seedIds.happyTenant, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, assetTypeKey: "pet", name: "Buddy", status: "active", customFields: { species: "dog", size: "medium" } },
      { id: uuid(131), tenantId: seedIds.happyTenant, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, assetTypeKey: "pet", name: "Luna", status: "active", customFields: { species: "dog", size: "small" } },
      { id: uuid(132), tenantId: seedIds.happyTenant, customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, assetTypeKey: "pet", name: "Max", status: "active", customFields: { species: "dog", safetyFlag: "Reactive near gate" } },
    ]).onConflictDoNothing();
    await tx.insert(customerPreferences).values([
      { id: uuid(135), tenantId: seedIds.happyTenant, customerId: seedIds.carter, preferenceKey: "autopay", value: true },
      { id: uuid(136), tenantId: seedIds.happyTenant, customerId: seedIds.carter, preferenceKey: "service_notifications", value: { email: true, sms: true } },
    ]).onConflictDoNothing();
    await tx.insert(portalAccess).values([
      { id: uuid(140), tenantId: seedIds.happyTenant, userId: actors.happyCustomer, customerId: seedIds.carter, status: "active", activatedAt: at(-20) },
      { id: uuid(141), tenantId: seedIds.cleanTenant, userId: actors.cleanCustomer, customerId: seedIds.cleanCarter, status: "active", activatedAt: at(-20) },
    ]).onConflictDoNothing();
    await tx.insert(portalLocationAccess).values([
      { tenantId: seedIds.happyTenant, portalAccessId: uuid(140), serviceLocationId: seedIds.carterLocation },
      { tenantId: seedIds.cleanTenant, portalAccessId: uuid(141), serviceLocationId: seedIds.cleanCarterLocation },
    ]).onConflictDoNothing();

    await tx.insert(leads).values([
      { id: uuid(150), tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, owningLocationId: seedIds.augusta, status: "estimate_pending", firstName: "Jordan", lastName: "Johnson", email: "jordan@example.test", phone: "555-0110", sourceId: uuid(80), sourceDetail: "Website signup", address: { line1: "101 Hill Road", city: "Evans", region: "GA", postalCode: "30809" }, customFields: { pricingConfidence: "low", petCount: 4 } },
      { id: uuid(151), tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, owningLocationId: seedIds.cleanBranch, status: "new", firstName: "Taylor", lastName: "Prospect", email: "prospect@cleanpaws.test", sourceId: uuid(82) },
    ]).onConflictDoNothing();
    await tx.insert(services).values([
      { id: seedIds.weeklyService, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, key: "yard-cleanup", name: "Yard cleanup", serviceType: "recurring", defaultDurationMinutes: 25, configuration: { units: "yard" } },
      { id: seedIds.commercialService, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, key: "commercial-cleanup", name: "Commercial grounds cleanup", serviceType: "recurring", defaultDurationMinutes: 60 },
      { id: seedIds.cleanService, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, key: "yard-cleanup", name: "Yard cleanup", serviceType: "recurring", defaultDurationMinutes: 25 },
    ]).onConflictDoNothing();
    await tx.insert(serviceZones).values([
      { id: uuid(205), tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, name: "Augusta core", zoneType: "postal_codes", definition: { postalCodes: ["30901", "30909", "29841"] }, pricingPriority: 1 },
      { id: uuid(206), tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, name: "Augusta route", zoneType: "postal_codes", definition: { postalCodes: ["30901", "30909"] }, pricingPriority: 1 },
    ]).onConflictDoNothing();
    await tx.insert(priceRules).values([
      { id: uuid(207), tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, name: "Weekly yard cleanup", priority: 10, conditions: { serviceKey: "yard-cleanup", frequency: "weekly" }, effects: { baseMinor: 2500 }, source: "industry_pack" },
      { id: uuid(208), tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, name: "Weekly yard cleanup", priority: 10, conditions: { serviceKey: "yard-cleanup", frequency: "weekly" }, effects: { baseMinor: 2700 }, source: "industry_pack" },
    ]).onConflictDoNothing();

    await tx.insert(estimates).values([
      { id: uuid(160), tenantId: seedIds.happyTenant, leadId: uuid(150), organizationLocationId: seedIds.augusta, status: "sent", currentRevision: 1, expiresAt: at(14), currency: "USD", totalMinor: 4500n, createdByMembershipId: seedIds.morganMembership },
      { id: uuid(161), tenantId: seedIds.happyTenant, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, organizationLocationId: seedIds.augusta, status: "approved", currentRevision: 1, approvedAt: at(-90), currency: "USD", totalMinor: 2500n, createdByMembershipId: seedIds.morganMembership },
    ]).onConflictDoNothing();
    await tx.insert(estimateRevisions).values([
      { id: uuid(162), tenantId: seedIds.happyTenant, estimateId: uuid(160), revisionNumber: 1, subtotalMinor: 4500n, totalMinor: 4500n, termsText: "Price subject to a site review", termsVersion: "1", snapshot: { leadName: "Jordan Johnson", service: "Yard cleanup", pricingConfidence: "manual_review" }, sentAt: at(-1) },
      { id: uuid(163), tenantId: seedIds.happyTenant, estimateId: uuid(161), revisionNumber: 1, subtotalMinor: 2500n, totalMinor: 2500n, termsText: "Weekly cleanup", termsVersion: "1", snapshot: { customerName: "Carter Household", service: "Yard cleanup" }, sentAt: at(-91) },
    ]).onConflictDoNothing();
    await tx.insert(estimateItems).values([
      { id: uuid(164), tenantId: seedIds.happyTenant, estimateRevisionId: uuid(162), serviceId: seedIds.weeklyService, description: "Yard cleanup quote", quantity: "1", unitAmountMinor: 4500n, totalMinor: 4500n },
      { id: uuid(165), tenantId: seedIds.happyTenant, estimateRevisionId: uuid(163), serviceId: seedIds.weeklyService, description: "Weekly yard cleanup", quantity: "1", unitAmountMinor: 2500n, totalMinor: 2500n },
    ]).onConflictDoNothing();
    await tx.insert(estimateApprovals).values([
      { id: uuid(166), tenantId: seedIds.happyTenant, estimateId: uuid(161), estimateRevisionId: uuid(163), decision: "approved", actorType: "customer", actorUserId: actors.happyCustomer, occurredAt: at(-90), termsVersion: "1" },
    ]).onConflictDoNothing();

    await tx.insert(recurrenceRules).values([
      { id: seedIds.weeklyRule, tenantId: seedIds.happyTenant, frequencyType: "weekly", interval: 1, daysOfWeek: [2], timezone: "America/New_York" },
      { id: seedIds.fortnightRule, tenantId: seedIds.happyTenant, frequencyType: "weekly", interval: 2, daysOfWeek: [4], timezone: "America/New_York" },
      { id: seedIds.cleanWeeklyRule, tenantId: seedIds.cleanTenant, frequencyType: "weekly", interval: 1, daysOfWeek: [3], timezone: "America/New_York" },
    ]).onConflictDoNothing();
    await tx.insert(servicePlans).values([
      { id: seedIds.carterPlan, tenantId: seedIds.happyTenant, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, organizationLocationId: seedIds.augusta, serviceId: seedIds.weeklyService, status: "active", effectiveFrom: day(-90), pricingSnapshot: { amountMinor: 2500, currency: "USD" }, billingConfiguration: { timing: "on_completion", autopay: true }, recurrenceRuleId: seedIds.weeklyRule },
      { id: seedIds.nguyenPlan, tenantId: seedIds.happyTenant, customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, organizationLocationId: seedIds.augusta, serviceId: seedIds.weeklyService, status: "paused", effectiveFrom: day(-90), pricingSnapshot: { amountMinor: 3000, currency: "USD" }, billingConfiguration: { timing: "on_completion", autopay: false }, recurrenceRuleId: seedIds.fortnightRule, pauseFrom: day(-1), pauseUntil: day(14) },
      { id: seedIds.riverfrontPlan, tenantId: seedIds.happyTenant, customerId: seedIds.riverfront, serviceLocationId: seedIds.riverfrontLocation, organizationLocationId: seedIds.northAugusta, serviceId: seedIds.commercialService, status: "active", effectiveFrom: day(-90), pricingSnapshot: { amountMinor: 8500, currency: "USD" }, billingConfiguration: { timing: "monthly", netDays: 30 }, recurrenceRuleId: seedIds.weeklyRule },
      { id: seedIds.cleanCarterPlan, tenantId: seedIds.cleanTenant, customerId: seedIds.cleanCarter, serviceLocationId: seedIds.cleanCarterLocation, organizationLocationId: seedIds.cleanBranch, serviceId: seedIds.cleanService, status: "active", effectiveFrom: day(-30), pricingSnapshot: { amountMinor: 2700, currency: "USD" }, billingConfiguration: { timing: "on_completion" }, recurrenceRuleId: seedIds.cleanWeeklyRule },
    ]).onConflictDoNothing();

    await tx.insert(jobs).values([
      { id: seedIds.completedJob, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, servicePlanId: seedIds.carterPlan, serviceId: seedIds.weeklyService, status: "completed", scheduledDate: day(-7), actualStartedAt: at(-7, 14), actualCompletedAt: at(-7, 15), priceSnapshot: { amountMinor: 2500, currency: "USD" }, customerSummary: "Yard cleanup completed" },
      { id: seedIds.upcomingJob, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, servicePlanId: seedIds.carterPlan, serviceId: seedIds.weeklyService, status: "scheduled", scheduledDate: day(2), serviceWindowStart: at(2, 13), serviceWindowEnd: at(2, 17), priceSnapshot: { amountMinor: 2500, currency: "USD" } },
      { id: seedIds.skippedJob, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, servicePlanId: seedIds.nguyenPlan, serviceId: seedIds.weeklyService, status: "skipped", scheduledDate: day(-5), billable: false, skipReasonCode: "unsafe_pet", customerSummary: "Visit skipped because access was unsafe" },
      { id: seedIds.recleanJob, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, serviceId: seedIds.weeklyService, parentJobId: seedIds.completedJob, relationType: "reclean", status: "scheduled", scheduledDate: day(2), billable: false },
      { id: seedIds.cleanJob, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, organizationLocationId: seedIds.cleanBranch, customerId: seedIds.cleanCarter, serviceLocationId: seedIds.cleanCarterLocation, servicePlanId: seedIds.cleanCarterPlan, serviceId: seedIds.cleanService, status: "scheduled", scheduledDate: day(2), priceSnapshot: { amountMinor: 2700, currency: "USD" } },
    ]).onConflictDoNothing();
    await tx.insert(jobAssignments).values([
      { id: uuid(320), tenantId: seedIds.happyTenant, jobId: seedIds.completedJob, membershipId: seedIds.terryMembership, assignmentRole: "primary", assignedAt: at(-8) },
      { id: uuid(321), tenantId: seedIds.happyTenant, jobId: seedIds.upcomingJob, membershipId: seedIds.terryMembership, assignmentRole: "primary", assignedAt: at(-1) },
      { id: uuid(322), tenantId: seedIds.happyTenant, jobId: seedIds.skippedJob, membershipId: seedIds.terryMembership, assignmentRole: "primary", assignedAt: at(-6) },
      { id: uuid(323), tenantId: seedIds.happyTenant, jobId: seedIds.recleanJob, membershipId: seedIds.terryMembership, assignmentRole: "primary", assignedAt: at(-1) },
      { id: uuid(324), tenantId: seedIds.cleanTenant, jobId: seedIds.cleanJob, membershipId: seedIds.cleanTechMembership, assignmentRole: "primary", assignedAt: at(-1) },
    ]).onConflictDoNothing();
    await tx.insert(jobStatusEvents).values([
      { id: uuid(330), tenantId: seedIds.happyTenant, jobId: seedIds.completedJob, fromStatus: "scheduled", toStatus: "started", actorType: "staff", actorId: seedIds.terryMembership, occurredAt: at(-7, 14) },
      { id: uuid(331), tenantId: seedIds.happyTenant, jobId: seedIds.completedJob, fromStatus: "started", toStatus: "completed", actorType: "staff", actorId: seedIds.terryMembership, occurredAt: at(-7, 15) },
      { id: uuid(332), tenantId: seedIds.happyTenant, jobId: seedIds.skippedJob, fromStatus: "scheduled", toStatus: "skipped", reasonCode: "unsafe_pet", actorType: "staff", actorId: seedIds.terryMembership, occurredAt: at(-5, 14) },
    ]).onConflictDoNothing();
    await tx.insert(routePlans).values([
      { id: seedIds.happyRoute, tenantId: seedIds.happyTenant, organizationLocationId: seedIds.augusta, membershipId: seedIds.terryMembership, routeDate: day(2), status: "published", startLocation: { label: "Augusta Branch" }, endLocation: { label: "Augusta Branch" }, plannedStartAt: at(2, 13), estimatedDistanceMeters: 14500, estimatedDriveSeconds: 2700, estimatedServiceSeconds: 3000, publishedAt: at(-1) },
      { id: seedIds.cleanRoute, tenantId: seedIds.cleanTenant, organizationLocationId: seedIds.cleanBranch, membershipId: seedIds.cleanTechMembership, routeDate: day(2), status: "published", startLocation: { label: "Main Branch" }, endLocation: { label: "Main Branch" }, plannedStartAt: at(2, 13), estimatedDistanceMeters: 8400, estimatedDriveSeconds: 1800, estimatedServiceSeconds: 1800, publishedAt: at(-1) },
    ]).onConflictDoNothing();
    await tx.insert(routeStops).values([
      { id: uuid(340), tenantId: seedIds.happyTenant, routePlanId: seedIds.happyRoute, jobId: seedIds.upcomingJob, sequence: 1, status: "pending", plannedArrivalAt: at(2, 14) },
      { id: uuid(341), tenantId: seedIds.happyTenant, routePlanId: seedIds.happyRoute, jobId: seedIds.recleanJob, sequence: 2, status: "pending", plannedArrivalAt: at(2, 15) },
      { id: uuid(342), tenantId: seedIds.cleanTenant, routePlanId: seedIds.cleanRoute, jobId: seedIds.cleanJob, sequence: 1, status: "pending", plannedArrivalAt: at(2, 14) },
    ]).onConflictDoNothing();
    await tx.insert(completionProofs).values([
      { id: uuid(350), tenantId: seedIds.happyTenant, jobId: seedIds.completedJob, completedAt: at(-7, 15), completedByMembershipId: seedIds.terryMembership, summary: "Front and back yard cleaned; gate secured", snapshot: { checklist: ["Yard swept", "Gate secured"], photoCount: 0 } },
    ]).onConflictDoNothing();

    await tx.insert(invoices).values([
      { id: seedIds.happyInvoice, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, status: "paid", invoiceNumber: "HY-1001", currency: "USD", issuedAt: at(-7), dueAt: at(-1), subtotalMinor: 2500n, totalMinor: 2500n, paidMinor: 2500n, balanceMinor: 0n, billingSnapshot: { customerName: "Carter Household", service: "Yard cleanup" } },
      { id: seedIds.overdueInvoice, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.nguyen, status: "overdue", invoiceNumber: "HY-1002", currency: "USD", issuedAt: at(-30), dueAt: at(-15), subtotalMinor: 3000n, totalMinor: 3000n, paidMinor: 0n, balanceMinor: 3000n, billingSnapshot: { customerName: "Nguyen Household", service: "Yard cleanup" } },
      { id: seedIds.cleanInvoice, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, organizationLocationId: seedIds.cleanBranch, customerId: seedIds.cleanCarter, status: "paid", invoiceNumber: "CP-1001", currency: "USD", issuedAt: at(-10), dueAt: at(-3), subtotalMinor: 2700n, totalMinor: 2700n, paidMinor: 2700n, balanceMinor: 0n, billingSnapshot: { customerName: "Carter Household", service: "Yard cleanup" } },
    ]).onConflictDoNothing();
    await tx.insert(invoiceItems).values([
      { id: uuid(420), tenantId: seedIds.happyTenant, invoiceId: seedIds.happyInvoice, jobId: seedIds.completedJob, serviceId: seedIds.weeklyService, description: "Weekly yard cleanup", quantity: "1", unitAmountMinor: 2500n, totalMinor: 2500n },
      { id: uuid(421), tenantId: seedIds.happyTenant, invoiceId: seedIds.overdueInvoice, serviceId: seedIds.weeklyService, description: "Yard cleanup", quantity: "1", unitAmountMinor: 3000n, totalMinor: 3000n },
      { id: uuid(422), tenantId: seedIds.cleanTenant, invoiceId: seedIds.cleanInvoice, serviceId: seedIds.cleanService, description: "Weekly yard cleanup", quantity: "1", unitAmountMinor: 2700n, totalMinor: 2700n },
    ]).onConflictDoNothing();
    await tx.insert(payments).values([
      { id: seedIds.happyPayment, tenantId: seedIds.happyTenant, customerId: seedIds.carter, status: "succeeded", sourceType: "mock", amountMinor: 2500n, currency: "USD", receivedAt: at(-6), idempotencyKey: "seed-happy-payment", recordedByActorType: "connector" },
      { id: seedIds.cleanPayment, tenantId: seedIds.cleanTenant, customerId: seedIds.cleanCarter, status: "succeeded", sourceType: "mock", amountMinor: 2700n, currency: "USD", receivedAt: at(-9), idempotencyKey: "seed-clean-payment", recordedByActorType: "connector" },
      { id: uuid(412), tenantId: seedIds.happyTenant, customerId: seedIds.nguyen, status: "failed", sourceType: "mock", amountMinor: 3000n, currency: "USD", idempotencyKey: "seed-nguyen-failed", failureCode: "mock_card_declined", failureMessage: "Mock payment declined", recordedByActorType: "connector" },
      { id: uuid(413), tenantId: seedIds.happyTenant, customerId: seedIds.carter, status: "refunded", sourceType: "mock", amountMinor: 500n, currency: "USD", receivedAt: at(-5), idempotencyKey: "seed-refunded-overpayment", recordedByActorType: "connector" },
      { id: uuid(414), tenantId: seedIds.happyTenant, customerId: seedIds.carter, status: "succeeded", sourceType: "mock", amountMinor: 500n, currency: "USD", receivedAt: at(-6), idempotencyKey: "seed-carter-tip", recordedByActorType: "connector" },
    ]).onConflictDoNothing();
    await tx.insert(paymentAllocations).values([
      { id: uuid(430), tenantId: seedIds.happyTenant, paymentId: seedIds.happyPayment, invoiceId: seedIds.happyInvoice, amountMinor: 2500n },
      { id: uuid(431), tenantId: seedIds.cleanTenant, paymentId: seedIds.cleanPayment, invoiceId: seedIds.cleanInvoice, amountMinor: 2700n },
    ]).onConflictDoNothing();
    await tx.insert(refunds).values([
      { id: uuid(432), tenantId: seedIds.happyTenant, paymentId: uuid(413), amountMinor: 500n, currency: "USD", status: "succeeded", reason: "Duplicate charge returned", createdAt: at(-5), completedAt: at(-5) },
    ]).onConflictDoNothing();
    await tx.insert(tips).values([
      { id: uuid(433), tenantId: seedIds.happyTenant, customerId: seedIds.carter, jobId: seedIds.completedJob, membershipId: seedIds.terryMembership, paymentId: uuid(414), amountMinor: 500n, currency: "USD", tipType: "one_time" },
    ]).onConflictDoNothing();

    await tx.insert(ticketTypeDefinitions).values([
      { id: uuid(440), tenantId: seedIds.happyTenant, key: "reclean", name: "Reclean request" },
      { id: uuid(441), tenantId: seedIds.happyTenant, key: "general", name: "General question" },
      { id: uuid(442), tenantId: seedIds.cleanTenant, key: "general", name: "General question" },
    ]).onConflictDoNothing();
    await tx.insert(ticketStatusDefinitions).values([
      { id: uuid(445), tenantId: seedIds.happyTenant, key: "open", name: "Open", normalizedCategory: "open", sortOrder: 1 },
      { id: uuid(446), tenantId: seedIds.happyTenant, key: "closed", name: "Closed", normalizedCategory: "closed", sortOrder: 9 },
      { id: uuid(447), tenantId: seedIds.cleanTenant, key: "open", name: "Open", normalizedCategory: "open", sortOrder: 1 },
    ]).onConflictDoNothing();
    await tx.insert(tickets).values([
      { id: uuid(450), tenantId: seedIds.happyTenant, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, jobId: seedIds.completedJob, ticketTypeId: uuid(440), statusDefinitionId: uuid(445), priority: "normal", title: "Small area missed near shed", description: "Customer asked for a quick reclean near the shed.", customerVisible: true, assignedMembershipId: seedIds.morganMembership, createdByActorType: "customer", createdByActorId: actors.happyCustomer },
      { id: uuid(451), tenantId: seedIds.cleanTenant, customerId: seedIds.cleanRivera, serviceLocationId: seedIds.cleanRiveraLocation, ticketTypeId: uuid(442), statusDefinitionId: uuid(447), priority: "normal", title: "Billing question", description: "Please confirm the next billing date.", customerVisible: true, createdByActorType: "customer", createdByActorId: actors.cleanCustomer },
    ]).onConflictDoNothing();
    await tx.insert(ticketComments).values([
      { id: uuid(452), tenantId: seedIds.happyTenant, ticketId: uuid(450), visibility: "customer", body: "We have scheduled a return visit.", actorType: "staff", actorId: seedIds.morganMembership },
    ]).onConflictDoNothing();

    await tx.insert(sites).values([
      { id: seedIds.happySite, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, status: "published", templateKey: "service-home", templateVersion: "1", slug: "happy-yards", branding: { businessName: "Happy Yards", accentColor: "#2f8659", tagline: "A cleaner yard, every week" }, settings: { serviceArea: "Augusta and North Augusta" }, publishedAt: at(-15) },
      { id: seedIds.cleanSite, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, status: "published", templateKey: "service-home", templateVersion: "1", slug: "cleanpaws", branding: { businessName: "CleanPaws", accentColor: "#2766aa", tagline: "Dependable pet waste removal" }, settings: { serviceArea: "Augusta" }, publishedAt: at(-12) },
    ]).onConflictDoNothing();
    await tx.insert(domains).values([
      { id: uuid(510), tenantId: seedIds.happyTenant, siteId: seedIds.happySite, hostname: "happy-yards.localhost", domainType: "platform", verificationStatus: "verified", isPrimary: true, verifiedAt: at(-15) },
      { id: uuid(511), tenantId: seedIds.cleanTenant, siteId: seedIds.cleanSite, hostname: "cleanpaws.localhost", domainType: "platform", verificationStatus: "verified", isPrimary: true, verifiedAt: at(-12) },
    ]).onConflictDoNothing();
    await tx.insert(siteContents).values([
      { id: uuid(520), tenantId: seedIds.happyTenant, siteId: seedIds.happySite, contentKey: "home", content: { headline: "Enjoy your yard again", description: "Reliable cleanup in Augusta and North Augusta", cta: "Get started" }, version: 1 },
      { id: uuid(521), tenantId: seedIds.cleanTenant, siteId: seedIds.cleanSite, contentKey: "home", content: { headline: "Clean yard, happy paws", description: "Weekly cleanup from your local route team", cta: "Request service" }, version: 1 },
    ]).onConflictDoNothing();
    await tx.insert(siteForms).values([
      { id: uuid(522), tenantId: seedIds.happyTenant, siteId: seedIds.happySite, formType: "signup", name: "Get started", schema: { fields: ["name", "email", "address", "petCount"] }, behavior: { create: "lead" } },
      { id: uuid(523), tenantId: seedIds.cleanTenant, siteId: seedIds.cleanSite, formType: "lead", name: "Request service", schema: { fields: ["name", "email", "address"] }, behavior: { create: "lead" } },
    ]).onConflictDoNothing();

    await tx.insert(connectorInstallations).values([
      { id: uuid(530), tenantId: seedIds.happyTenant, connectorKey: "mock-payments", status: "connected", displayName: "Test payments", providerAccountId: "happy-test-payments", settings: { mode: "test" } },
      { id: uuid(531), tenantId: seedIds.happyTenant, connectorKey: "mock-communication", status: "connected", displayName: "Test messages", providerAccountId: "happy-test-messaging", settings: { mode: "test" } },
      { id: uuid(532), tenantId: seedIds.happyTenant, connectorKey: "mock-routing", status: "connected", displayName: "Test routes", providerAccountId: "happy-test-routing", settings: { mode: "test" } },
      { id: uuid(533), tenantId: seedIds.cleanTenant, connectorKey: "mock-payments", status: "connected", displayName: "Test payments", providerAccountId: "clean-test-payments", settings: { mode: "test" } },
      { id: seedIds.happyLocalStorage, tenantId: seedIds.happyTenant, connectorKey: "local-storage", status: "connected", displayName: "Local files", providerAccountId: "happy-local-files", settings: { mode: "local" } },
      { id: seedIds.cleanLocalStorage, tenantId: seedIds.cleanTenant, connectorKey: "local-storage", status: "connected", displayName: "Local files", providerAccountId: "clean-local-files", settings: { mode: "local" } },
    ]).onConflictDoNothing();

    await tx.insert(shifts).values([
      { id: uuid(600), tenantId: seedIds.happyTenant, membershipId: seedIds.terryMembership, organizationLocationId: seedIds.augusta, status: "approved", clockInAt: at(-7, 13), clockOutAt: at(-7, 21), approvedByMembershipId: seedIds.morganMembership },
    ]).onConflictDoNothing();
    await tx.insert(breaks).values([
      { id: uuid(601), tenantId: seedIds.happyTenant, shiftId: uuid(600), breakType: "meal", startedAt: at(-7, 17), endedAt: at(-7, 18), paid: false },
    ]).onConflictDoNothing();
    await tx.insert(timeEntries).values([
      { id: uuid(602), tenantId: seedIds.happyTenant, membershipId: seedIds.terryMembership, shiftId: uuid(600), jobId: seedIds.completedJob, source: "field", startsAt: at(-7, 14), endsAt: at(-7, 15), durationSeconds: 3600, approvalStatus: "approved" },
    ]).onConflictDoNothing();
    await tx.insert(mileageRecords).values([
      { id: uuid(603), tenantId: seedIds.happyTenant, membershipId: seedIds.terryMembership, shiftId: uuid(600), source: "manual", distanceMeters: 18200, personalVehicle: true, occurredOn: day(-7) },
    ]).onConflictDoNothing();
    await tx.insert(compensationProfiles).values([
      { id: uuid(610), tenantId: seedIds.happyTenant, membershipId: seedIds.terryMembership, effectiveFrom: day(-90), hourlyRateMinor: 1800n, mileageRateMinorPerUnit: 67n, currency: "USD", bonusConfiguration: { completionBonusMinor: 200 } },
    ]).onConflictDoNothing();
    await tx.insert(payrollPeriods).values([
      { id: uuid(611), tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, periodStart: day(-14), periodEnd: day(-1), status: "reviewed", reviewedAt: at(-1) },
    ]).onConflictDoNothing();
    await tx.insert(payrollCalculations).values([
      { id: uuid(612), tenantId: seedIds.happyTenant, payrollPeriodId: uuid(611), membershipId: seedIds.terryMembership, version: 1, grossAmountMinor: 13570n, currency: "USD", calculationSnapshot: { hours: 7, hourlyMinor: 1800, mileageMinor: 470, tipMinor: 500 }, calculatedAt: at(-1) },
    ]).onConflictDoNothing();
    await tx.insert(payrollComponents).values([
      { id: uuid(613), tenantId: seedIds.happyTenant, payrollCalculationId: uuid(612), componentType: "hourly", description: "7 paid hours", quantity: "7", rateMinor: 1800n, amountMinor: 12600n },
      { id: uuid(614), tenantId: seedIds.happyTenant, payrollCalculationId: uuid(612), componentType: "mileage", description: "Mileage reimbursement", amountMinor: 470n },
      { id: uuid(615), tenantId: seedIds.happyTenant, payrollCalculationId: uuid(612), componentType: "tip", description: "Customer tip", amountMinor: 500n },
    ]).onConflictDoNothing();

    await tx.insert(inventoryItems).values([
      { id: uuid(700), tenantId: seedIds.happyTenant, sku: "BAGS-100", name: "Waste bags", unit: "roll", tracked: true, serialized: false, defaultCostMinor: 450n, currency: "USD" },
      { id: uuid(701), tenantId: seedIds.cleanTenant, sku: "BAGS-100", name: "Waste bags", unit: "roll", tracked: true, serialized: false, defaultCostMinor: 500n, currency: "USD" },
    ]).onConflictDoNothing();
    await tx.insert(inventoryLocations).values([
      { id: uuid(710), tenantId: seedIds.happyTenant, organizationLocationId: seedIds.augusta, name: "Augusta stock", locationType: "branch" },
      { id: uuid(711), tenantId: seedIds.happyTenant, membershipId: seedIds.terryMembership, name: "Terry vehicle", locationType: "vehicle" },
      { id: uuid(712), tenantId: seedIds.cleanTenant, organizationLocationId: seedIds.cleanBranch, name: "Main stock", locationType: "branch" },
    ]).onConflictDoNothing();
    await tx.insert(stockMovements).values([
      { id: uuid(720), tenantId: seedIds.happyTenant, inventoryItemId: uuid(700), inventoryLocationId: uuid(710), movementType: "receive", quantity: "20", unitCostMinor: 450n, currency: "USD", occurredAt: at(-14) },
      { id: uuid(721), tenantId: seedIds.happyTenant, inventoryItemId: uuid(700), inventoryLocationId: uuid(710), linkedMovementId: uuid(722), movementType: "transfer_out", quantity: "5", occurredAt: at(-8) },
      { id: uuid(722), tenantId: seedIds.happyTenant, inventoryItemId: uuid(700), inventoryLocationId: uuid(711), linkedMovementId: uuid(721), movementType: "transfer_in", quantity: "5", occurredAt: at(-8) },
      { id: uuid(723), tenantId: seedIds.happyTenant, inventoryItemId: uuid(700), inventoryLocationId: uuid(711), movementType: "consume", quantity: "1", jobId: seedIds.completedJob, occurredAt: at(-7) },
      { id: uuid(724), tenantId: seedIds.cleanTenant, inventoryItemId: uuid(701), inventoryLocationId: uuid(712), movementType: "receive", quantity: "15", unitCostMinor: 500n, currency: "USD", occurredAt: at(-10) },
    ]).onConflictDoNothing();
    await tx.insert(vendors).values([
      { id: uuid(730), tenantId: seedIds.happyTenant, name: "Regional Supply Co.", email: "orders@supply.test" },
    ]).onConflictDoNothing();
    await tx.insert(purchaseOrders).values([
      { id: uuid(731), tenantId: seedIds.happyTenant, vendorId: uuid(730), organizationLocationId: seedIds.augusta, status: "partially_received", orderNumber: "PO-1001", orderedAt: at(-14), expectedAt: at(-10), subtotalMinor: 9000n, totalMinor: 9000n, currency: "USD" },
    ]).onConflictDoNothing();
    await tx.insert(purchaseOrderItems).values([
      { id: uuid(732), tenantId: seedIds.happyTenant, purchaseOrderId: uuid(731), inventoryItemId: uuid(700), description: "Waste bag rolls", quantityOrdered: "20", quantityReceived: "10", unitCostMinor: 450n, totalMinor: 9000n },
    ]).onConflictDoNothing();

    await tx.insert(automationRules).values([
      { id: uuid(800), tenantId: seedIds.happyTenant, name: "Completion thank-you", source: "industry_pack", sourceKey: "completion-thank-you", status: "active", version: 1, triggerConfig: { event: "job.completed" }, conditions: { field: "job.status", operator: "equals", value: "completed" }, actions: [{ actionType: "send_email", configuration: { templateKey: "completion" } }], activeFrom: at(-30) },
    ]).onConflictDoNothing();
    await tx.insert(domainEvents).values([
      { id: uuid(801), tenantId: seedIds.happyTenant, eventType: "job.completed", eventVersion: 1, actorType: "staff", actorId: seedIds.terryMembership, entityType: "job", entityId: seedIds.completedJob, organizationId: seedIds.happyOrganization, locationId: seedIds.augusta, payload: { customerId: seedIds.carter }, occurredAt: at(-7, 15), publishedAt: at(-7, 15) },
    ]).onConflictDoNothing();
    await tx.insert(automationRuns).values([
      { id: uuid(802), tenantId: seedIds.happyTenant, automationRuleId: uuid(800), ruleVersion: 1, triggeringEventId: uuid(801), idempotencyKey: "seed-completion-thank-you", status: "completed", attempts: 1, startedAt: at(-7, 15), completedAt: at(-7, 15), contextSnapshot: { customerId: seedIds.carter } },
    ]).onConflictDoNothing();
    await tx.insert(auditEvents).values([
      { id: uuid(803), tenantId: seedIds.happyTenant, actorType: "staff", actorId: seedIds.morganMembership, action: "invoice.issued", entityType: "invoice", entityId: seedIds.happyInvoice, afterData: { invoiceNumber: "HY-1001", totalMinor: "2500" }, createdAt: at(-7) },
    ]).onConflictDoNothing();
    await tx.insert(notificationPreferences).values([
      { id: uuid(810), tenantId: seedIds.happyTenant, customerId: seedIds.carter, eventKey: "job_completed", emailEnabled: true, smsEnabled: true },
    ]).onConflictDoNothing();
    await tx.insert(consentRecords).values([
      { id: uuid(811), tenantId: seedIds.happyTenant, customerId: seedIds.carter, channel: "sms", category: "transactional", state: "opted_in", source: "portal", actorType: "customer", actorId: actors.happyCustomer, capturedAt: at(-20) },
    ]).onConflictDoNothing();
  });
  return { ids: seedIds, actors };
}
