import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "./client.ts";
import {
  capabilityFeatureDependencies,
  capabilityFeatures,
  capabilityModuleDependencies,
  capabilityModuleFeatures,
  capabilityModules,
  tenantCapabilityGrants,
} from "./schema/capabilities.ts";

type CatalogTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ModuleDefinition = Readonly<{
  key: string;
  name: string;
  description: string;
  required?: boolean;
  featureKeys: readonly string[];
}>;

const catalogIdentity = { key: "initial", revision: 1 } as const;

const modules: readonly ModuleDefinition[] = [
  {
    key: "core-platform",
    name: "Core CRM",
    description: "The shared business foundation every workspace needs.",
    required: true,
    featureKeys: [
      "tenant_account_management",
      "staff_access_management",
      "customer_records",
      "service_locations",
      "activity_history",
      "service_catalog",
      "lead_management",
      "industry_pack_setup",
      "data_import_export",
      "platform_settings",
      "basic_reporting",
    ],
  },
  {
    key: "sales-and-booking",
    name: "Sales and Booking",
    description: "Help new customers discover services, request work, and approve estimates.",
    featureKeys: ["estimate_management", "online_booking", "website_publishing"],
  },
  {
    key: "scheduling-and-recurring",
    name: "Scheduling and Recurring Service",
    description: "Plan one-time work and manage repeat service relationships.",
    featureKeys: ["service_scheduling", "recurring_service_management"],
  },
  {
    key: "billing-and-payments",
    name: "Billing and Payments",
    description: "Create invoices, collect payments, and keep payment history with customer work.",
    featureKeys: ["invoicing", "payment_collection"],
  },
  {
    key: "customer-experience",
    name: "Customer Experience",
    description: "Keep customers informed and make common service actions easier to handle.",
    featureKeys: ["customer_notifications", "customer_self_service", "automation_workflows"],
  },
  {
    key: "field-operations",
    name: "Field Operations",
    description: "Give crews the job details and completion tools they need on site.",
    featureKeys: ["field_job_tracking"],
  },
  {
    key: "route-planning",
    name: "Route Planning",
    description: "Sequence visits and plan travel between service locations.",
    featureKeys: ["route_planning"],
  },
  {
    key: "workforce-and-payroll",
    name: "Workforce and Payroll Inputs",
    description: "Track working time and prepare labor details for payroll workflows.",
    featureKeys: ["time_tracking", "payroll_inputs"],
  },
  {
    key: "inventory-and-supplies",
    name: "Inventory and Supplies",
    description: "Track parts and supplies across business and field locations.",
    featureKeys: ["inventory_tracking"],
  },
  {
    key: "locations-and-insights",
    name: "Locations and Insights",
    description: "Coordinate multiple business locations and compare detailed operating results.",
    featureKeys: ["multi_location_management", "advanced_reporting"],
  },
];

const features = [
  ["tenant_account_management", "Business account", "Manage the tenant workspace and essential account details."],
  ["staff_access_management", "Staff access", "Manage staff membership, roles, and permissions."],
  ["customer_records", "Customer records", "Keep customer and contact records in one shared workspace."],
  ["service_locations", "Service locations", "Store customer service addresses and location details."],
  ["activity_history", "Business activity history", "Keep a shared history of important customer and operating activity."],
  ["service_catalog", "Service catalog", "Define the services a business offers."],
  ["lead_management", "Lead management", "Record and follow up with prospective customers."],
  ["industry_pack_setup", "Industry setup", "Configure terminology and operating defaults for the selected industry."],
  ["data_import_export", "Data import and export", "Bring business data into the platform and take it back out."],
  ["platform_settings", "Workspace settings", "Manage essential settings for the business workspace."],
  ["basic_reporting", "Basic business reporting", "See a useful summary of current business activity."],
  ["recurring_service_management", "Recurring service management", "Manage repeat service plans and their changes over time."],
  ["service_scheduling", "Service scheduling", "Schedule one-time and recurring customer work."],
  ["payment_collection", "Payment collection", "Collect and record customer payments."],
  ["invoicing", "Invoicing", "Create and manage invoices for completed or planned work."],
  ["customer_notifications", "Customer notifications", "Send useful updates and reminders to customers."],
  ["customer_self_service", "Customer self-service", "Let customers review information and complete supported service actions themselves."],
  ["estimate_management", "Estimate management", "Prepare, send, and track estimates and customer approvals."],
  ["online_booking", "Online booking", "Accept customer service requests through an online booking flow."],
  ["website_publishing", "Business website", "Publish a service-business website using platform content and templates."],
  ["automation_workflows", "Automation workflows", "Run event-based business follow-ups and repeatable workflows."],
  ["field_job_tracking", "Field job tracking", "Give field staff job details and record work progress and completion."],
  ["route_planning", "Route planning", "Plan and sequence travel between scheduled service stops."],
  ["time_tracking", "Time tracking", "Record staff working time against business activity."],
  ["payroll_inputs", "Payroll inputs", "Prepare hours and related labor details for payroll processing."],
  ["inventory_tracking", "Inventory tracking", "Track supplies and parts, including movement between locations."],
  ["multi_location_management", "Multi-location management", "Manage operations across more than one business location."],
  ["advanced_reporting", "Advanced reporting", "Compare operational, financial, staff, and location results in detail."],
] as const;

const moduleDependencies = [
  ...modules.filter((module) => module.required !== true).map((module) => ({ moduleKey: module.key, dependsOnModuleKey: "core-platform" })),
  { moduleKey: "field-operations", dependsOnModuleKey: "scheduling-and-recurring" },
  { moduleKey: "route-planning", dependsOnModuleKey: "field-operations" },
  { moduleKey: "route-planning", dependsOnModuleKey: "scheduling-and-recurring" },
] as const;

const featureDependencies = [
  { featureKey: "route_planning", dependsOnFeatureKey: "service_scheduling" },
  { featureKey: "route_planning", dependsOnFeatureKey: "field_job_tracking" },
  { featureKey: "payroll_inputs", dependsOnFeatureKey: "time_tracking" },
] as const;

export const INITIAL_CAPABILITY_CATALOG_REVISION = catalogIdentity.revision;
export const INITIAL_CAPABILITY_MODULE_KEYS = modules.map(({ key }) => key) as readonly string[];
export const INITIAL_CAPABILITY_FEATURE_KEYS = features.map(([key]) => key) as readonly string[];

export type CapabilityGrantOptions = Readonly<{
  source: string;
  sourceReference?: string;
  effectiveFrom?: Date;
}>;

/** Upserts the revisioned, provider-neutral V1 capability definitions and relationships. */
export async function installInitialCapabilityCatalog(tx: CatalogTransaction): Promise<void> {
  const featureKeys = features.map(([key]) => key);
  const moduleKeys = modules.map(({ key }) => key);
  const [previousFeatures, previousModules] = await Promise.all([
    tx.select({ id: capabilityFeatures.id, key: capabilityFeatures.key, metadata: capabilityFeatures.metadata }).from(capabilityFeatures).where(inArray(capabilityFeatures.key, featureKeys)),
    tx.select({ id: capabilityModules.id, key: capabilityModules.key, metadata: capabilityModules.metadata }).from(capabilityModules).where(inArray(capabilityModules.key, moduleKeys)),
  ]);
  const olderFeatureIds = previousFeatures.filter((row) => belongsToOlderCatalogRevision(row.metadata)).map((row) => row.id);
  const olderModuleIds = previousModules.filter((row) => belongsToOlderCatalogRevision(row.metadata)).map((row) => row.id);

  await tx.insert(capabilityFeatures).values(features.map(([key, name, description], sortOrder) => ({
    key,
    name,
    description,
    lifecycleState: "active",
    availability: {},
    metadata: { catalog: catalogIdentity, sortOrder },
  }))).onConflictDoUpdate({
    target: capabilityFeatures.key,
    set: {
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      lifecycleState: sql`excluded.lifecycle_state`,
      availability: sql`excluded.availability`,
      metadata: sql`excluded.metadata`,
    },
    setWhere: olderCatalogRevisionCondition(capabilityFeatures.metadata),
  });
  await tx.insert(capabilityModules).values(modules.map((module, sortOrder) => ({
    key: module.key,
    name: module.name,
    description: module.description,
    lifecycleState: "active",
    availability: {},
    compatibility: {},
    metadata: { catalog: catalogIdentity, sortOrder, ...(module.required ? { required: true } : {}) },
  }))).onConflictDoUpdate({
    target: capabilityModules.key,
    set: {
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      lifecycleState: sql`excluded.lifecycle_state`,
      availability: sql`excluded.availability`,
      compatibility: sql`excluded.compatibility`,
      metadata: sql`excluded.metadata`,
    },
    setWhere: olderCatalogRevisionCondition(capabilityModules.metadata),
  });

  const [featureRows, moduleRows] = await Promise.all([
    tx.select({ id: capabilityFeatures.id, key: capabilityFeatures.key }).from(capabilityFeatures).where(inArray(capabilityFeatures.key, featureKeys)),
    tx.select({ id: capabilityModules.id, key: capabilityModules.key }).from(capabilityModules).where(inArray(capabilityModules.key, moduleKeys)),
  ]);
  const featureIds = new Map(featureRows.map((row) => [row.key, row.id]));
  const moduleIds = new Map(moduleRows.map((row) => [row.key, row.id]));

  // Refresh relationships only when a catalog-owned definition moves to a newer revision.
  if (olderModuleIds.length > 0) {
    await tx.delete(capabilityModuleFeatures).where(inArray(capabilityModuleFeatures.moduleId, olderModuleIds));
    await tx.delete(capabilityModuleDependencies).where(inArray(capabilityModuleDependencies.moduleId, olderModuleIds));
  }
  if (olderFeatureIds.length > 0) {
    await tx.delete(capabilityFeatureDependencies).where(inArray(capabilityFeatureDependencies.featureId, olderFeatureIds));
  }

  const memberships = modules.flatMap((module) => module.featureKeys.map((featureKey, sortOrder) => ({
    moduleId: requiredId(moduleIds, module.key, "module"),
    featureId: requiredId(featureIds, featureKey, "feature"),
    sortOrder,
    required: true,
  })));
  await tx.insert(capabilityModuleFeatures).values(memberships).onConflictDoNothing();

  const moduleDependencyRows = moduleDependencies.map(({ moduleKey, dependsOnModuleKey }) => ({
    moduleId: requiredId(moduleIds, moduleKey, "module"),
    dependsOnModuleId: requiredId(moduleIds, dependsOnModuleKey, "module"),
    dependencyType: "requires",
    conditions: {},
  }));
  await tx.insert(capabilityModuleDependencies).values(moduleDependencyRows).onConflictDoNothing();

  const featureDependencyRows = featureDependencies.map(({ featureKey, dependsOnFeatureKey }) => ({
    featureId: requiredId(featureIds, featureKey, "feature"),
    dependsOnFeatureId: requiredId(featureIds, dependsOnFeatureKey, "feature"),
    dependencyType: "requires",
    conditions: {},
  }));
  await tx.insert(capabilityFeatureDependencies).values(featureDependencyRows).onConflictDoNothing();
}

/** Resolve pack feature recommendations into modules, required setup, and dependency closure. */
export async function resolveInitialCapabilityModuleKeys(
  tx: CatalogTransaction,
  recommendedFeatureKeys: readonly string[],
): Promise<string[]> {
  const [moduleRows, featureRows, memberships, moduleDeps, featureDeps] = await Promise.all([
    tx.select({ id: capabilityModules.id, key: capabilityModules.key, lifecycleState: capabilityModules.lifecycleState, metadata: capabilityModules.metadata }).from(capabilityModules),
    tx.select({ id: capabilityFeatures.id, key: capabilityFeatures.key, lifecycleState: capabilityFeatures.lifecycleState }).from(capabilityFeatures),
    tx.select({ moduleId: capabilityModuleFeatures.moduleId, featureId: capabilityModuleFeatures.featureId }).from(capabilityModuleFeatures),
    tx.select({ moduleId: capabilityModuleDependencies.moduleId, dependsOnModuleId: capabilityModuleDependencies.dependsOnModuleId, dependencyType: capabilityModuleDependencies.dependencyType }).from(capabilityModuleDependencies),
    tx.select({ featureId: capabilityFeatureDependencies.featureId, dependsOnFeatureId: capabilityFeatureDependencies.dependsOnFeatureId, dependencyType: capabilityFeatureDependencies.dependencyType }).from(capabilityFeatureDependencies),
  ]);
  const activeModules = moduleRows.filter((row) => row.lifecycleState === "active");
  const activeModuleIds = new Set(activeModules.map((row) => row.id));
  const activeFeatures = featureRows.filter((row) => row.lifecycleState === "active");
  const featureIdByKey = new Map(activeFeatures.map((row) => [row.key, row.id]));
  const membershipsByFeature = indexBy(memberships.filter((row) => activeModuleIds.has(row.moduleId)), (row) => row.featureId);
  const moduleById = new Map(activeModules.map((row) => [row.id, row]));
  const selectedModuleIds = new Set(activeModules.filter((module) => module.metadata.required === true).map((module) => module.id));

  for (const featureKey of new Set(recommendedFeatureKeys)) {
    const featureId = featureIdByKey.get(featureKey);
    if (!featureId) throw new Error(`Unknown or inactive recommended capability feature: ${featureKey}`);
    const providers = membershipsByFeature.get(featureId) ?? [];
    if (providers.length === 0) throw new Error(`Recommended capability feature has no module: ${featureKey}`);
    for (const provider of providers) selectedModuleIds.add(provider.moduleId);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of moduleDeps) {
      if (dependency.dependencyType === "requires" && selectedModuleIds.has(dependency.moduleId) && activeModuleIds.has(dependency.dependsOnModuleId) && !selectedModuleIds.has(dependency.dependsOnModuleId)) {
        selectedModuleIds.add(dependency.dependsOnModuleId);
        changed = true;
      }
    }

    const includedFeatureIds = new Set(memberships.filter((row) => selectedModuleIds.has(row.moduleId)).map((row) => row.featureId));
    for (const dependency of featureDeps) {
      if (dependency.dependencyType !== "requires" || !includedFeatureIds.has(dependency.featureId)) continue;
      const providers = membershipsByFeature.get(dependency.dependsOnFeatureId) ?? [];
      if (providers.length === 0) {
        const dependentKey = activeFeatures.find((feature) => feature.id === dependency.featureId)?.key ?? dependency.featureId;
        const requiredKey = activeFeatures.find((feature) => feature.id === dependency.dependsOnFeatureId)?.key ?? dependency.dependsOnFeatureId;
        throw new Error(`Capability feature ${dependentKey} requires an unmapped feature: ${requiredKey}`);
      }
      for (const provider of providers) {
        if (!selectedModuleIds.has(provider.moduleId)) {
          selectedModuleIds.add(provider.moduleId);
          changed = true;
        }
      }
    }
  }

  return [...selectedModuleIds]
    .map((id) => moduleById.get(id)!)
    .sort((left, right) => moduleSortOrder(left.metadata) - moduleSortOrder(right.metadata) || left.key.localeCompare(right.key))
    .map((module) => module.key);
}

/** Adds explicit active grants while leaving existing grants and tenant settings intact. */
export async function grantTenantCapabilityModules(
  tx: CatalogTransaction,
  tenantId: string,
  requestedModuleKeys: readonly string[],
  options: CapabilityGrantOptions,
): Promise<string[]> {
  if (!options.source.trim()) throw new Error("Capability grant source cannot be empty");
  const requestedKeys = [...new Set(requestedModuleKeys)];
  if (requestedKeys.length === 0) return [];

  const modulesForGrant = await tx.select({ id: capabilityModules.id, key: capabilityModules.key })
    .from(capabilityModules)
    .where(and(eq(capabilityModules.lifecycleState, "active"), inArray(capabilityModules.key, requestedKeys)));
  const moduleIdByKey = new Map(modulesForGrant.map((module) => [module.key, module.id]));
  const unknownKeys = requestedKeys.filter((key) => !moduleIdByKey.has(key));
  if (unknownKeys.length > 0) throw new Error(`Unknown or inactive capability modules: ${unknownKeys.join(", ")}`);

  const effectiveFrom = options.effectiveFrom ?? new Date();
  const moduleIds = modulesForGrant.map(({ id }) => id);
  const activeGrants = await tx.select({ moduleId: tenantCapabilityGrants.moduleId })
    .from(tenantCapabilityGrants)
    .where(and(
      eq(tenantCapabilityGrants.tenantId, tenantId),
      inArray(tenantCapabilityGrants.moduleId, moduleIds),
      isNull(tenantCapabilityGrants.revokedAt),
      lte(tenantCapabilityGrants.effectiveFrom, effectiveFrom),
      or(isNull(tenantCapabilityGrants.effectiveUntil), gt(tenantCapabilityGrants.effectiveUntil, effectiveFrom)),
    ));
  const activeModuleIds = new Set(activeGrants.map((grant) => grant.moduleId));
  const missing = modulesForGrant.filter(({ id }) => !activeModuleIds.has(id));
  if (missing.length > 0) {
    await tx.insert(tenantCapabilityGrants).values(missing.map(({ id }) => ({
      tenantId,
      moduleId: id,
      source: options.source,
      sourceReference: options.sourceReference,
      effectiveFrom,
      grantDetails: { catalogRevision: INITIAL_CAPABILITY_CATALOG_REVISION },
    })));
  }
  return requestedKeys;
}

/** Signup entry point: grant the tenant-required foundation plus pack-recommended features. */
export async function grantRecommendedCapabilitySetup(
  tx: CatalogTransaction,
  tenantId: string,
  recommendedFeatureKeys: readonly string[],
  options: CapabilityGrantOptions,
): Promise<string[]> {
  const moduleKeys = await resolveInitialCapabilityModuleKeys(tx, recommendedFeatureKeys);
  await grantTenantCapabilityModules(tx, tenantId, moduleKeys, options);
  return moduleKeys;
}

function requiredId(map: ReadonlyMap<string, string>, key: string, kind: string): string {
  const id = map.get(key);
  if (!id) throw new Error(`Initial capability catalog ${kind} was not installed: ${key}`);
  return id;
}

function belongsToOlderCatalogRevision(metadata: Record<string, unknown>): boolean {
  const catalog = metadata.catalog;
  if (catalog === null || typeof catalog !== "object") return false;
  const value = catalog as Record<string, unknown>;
  return value.key === catalogIdentity.key && typeof value.revision === "number" && value.revision < catalogIdentity.revision;
}

function olderCatalogRevisionCondition(metadataColumn: typeof capabilityModules.metadata | typeof capabilityFeatures.metadata) {
  return sql`${metadataColumn}->'catalog'->>'key' = ${catalogIdentity.key}
    AND COALESCE((${metadataColumn}->'catalog'->>'revision')::integer, 0) < ${catalogIdentity.revision}`;
}

function moduleSortOrder(metadata: Record<string, unknown>): number {
  const value = metadata.sortOrder;
  return typeof value === "number" ? value : Number.MAX_SAFE_INTEGER;
}

function indexBy<T, K>(items: readonly T[], getKey: (item: T) => K): Map<K, T[]> {
  const index = new Map<K, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const values = index.get(key) ?? [];
    values.push(item);
    index.set(key, values);
  }
  return index;
}
