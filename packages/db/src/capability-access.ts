import { eq } from "drizzle-orm";
import type { Database } from "./client.ts";
import {
  capabilityFeatureDependencies, capabilityFeatures, capabilityModuleDependencies, capabilityModuleFeatures,
  capabilityModules, tenantCapabilityGrants, tenantCapabilitySettings,
} from "./schema/index.ts";

type Module = typeof capabilityModules.$inferSelect;
type Feature = typeof capabilityFeatures.$inferSelect;
type ModuleFeature = typeof capabilityModuleFeatures.$inferSelect;
type ModuleDependency = typeof capabilityModuleDependencies.$inferSelect;
type FeatureDependency = typeof capabilityFeatureDependencies.$inferSelect;
type Grant = typeof tenantCapabilityGrants.$inferSelect;
type Setting = typeof tenantCapabilitySettings.$inferSelect;

export type CapabilityCatalogRows = {
  modules: readonly Module[];
  features: readonly Feature[];
  moduleFeatures: readonly ModuleFeature[];
  moduleDependencies: readonly ModuleDependency[];
  featureDependencies: readonly FeatureDependency[];
  grants: readonly Grant[];
  settings: readonly Setting[];
};

export type ModuleCapabilityState = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  entitled: boolean;
  enabled: boolean;
  available: boolean;
  usable: boolean;
  uiProminence: string;
  configuration: Record<string, unknown>;
  featureKeys: string[];
  blockedBy: string[];
};

export type FeatureCapabilityState = {
  id: string;
  key: string;
  name: string;
  entitled: boolean;
  enabled: boolean;
  available: boolean;
  usable: boolean;
  visible: boolean;
  providedBy: string[];
  blockedBy: string[];
};

export type TenantCapabilityState = {
  tenantId: string;
  asOf: string;
  modules: Record<string, ModuleCapabilityState>;
  features: Record<string, FeatureCapabilityState>;
};

function isAvailable(row: { lifecycleState: string; availability: Record<string, unknown> }): boolean {
  return row.lifecycleState === "active" && row.availability.disabled !== true
    && row.availability.available !== false && row.availability.status !== "unavailable";
}

function effectiveGrant(grant: Grant, tenantId: string, at: Date): boolean {
  return grant.tenantId === tenantId && grant.effectiveFrom <= at
    && (!grant.effectiveUntil || grant.effectiveUntil > at)
    && (!grant.revokedAt || grant.revokedAt > at);
}

/** Resolve catalog data without inferring entitlement from pack recommendations or UI visibility. */
export function evaluateTenantCapabilities(tenantId: string, rows: CapabilityCatalogRows, at = new Date()): TenantCapabilityState {
  const moduleById = new Map(rows.modules.map((module) => [module.id, module]));
  const featureById = new Map(rows.features.map((feature) => [feature.id, feature]));
  const settingByModule = new Map(rows.settings.filter((setting) => setting.tenantId === tenantId).map((setting) => [setting.moduleId, setting]));
  const grantedModuleIds = new Set(rows.grants.filter((grant) => effectiveGrant(grant, tenantId, at)).map((grant) => grant.moduleId));
  const membersByModule = new Map<string, ModuleFeature[]>();
  const membersByFeature = new Map<string, ModuleFeature[]>();
  for (const member of rows.moduleFeatures) {
    if (!moduleById.has(member.moduleId) || !featureById.has(member.featureId)) continue;
    membersByModule.set(member.moduleId, [...(membersByModule.get(member.moduleId) ?? []), member]);
    membersByFeature.set(member.featureId, [...(membersByFeature.get(member.featureId) ?? []), member]);
  }
  const moduleDependenciesById = new Map<string, ModuleDependency[]>();
  for (const dependency of rows.moduleDependencies) {
    moduleDependenciesById.set(dependency.moduleId, [...(moduleDependenciesById.get(dependency.moduleId) ?? []), dependency]);
  }
  const featureDependenciesById = new Map<string, FeatureDependency[]>();
  for (const dependency of rows.featureDependencies) {
    featureDependenciesById.set(dependency.featureId, [...(featureDependenciesById.get(dependency.featureId) ?? []), dependency]);
  }

  const modulesById = new Map<string, ModuleCapabilityState>();
  const resolvingModules = new Set<string>();
  function resolveModule(id: string): ModuleCapabilityState | undefined {
    const existing = modulesById.get(id);
    if (existing) return existing;
    const module = moduleById.get(id);
    if (!module) return undefined;
    const setting = settingByModule.get(id);
    const state: ModuleCapabilityState = {
      id, key: module.key, name: module.name, description: module.description,
      entitled: grantedModuleIds.has(id), enabled: setting?.enabled ?? true,
      available: isAvailable(module), usable: false,
      uiProminence: setting?.uiProminence ?? "standard", configuration: setting?.configuration ?? {},
      featureKeys: (membersByModule.get(id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)
        .map((member) => featureById.get(member.featureId)!.key),
      blockedBy: [],
    };
    if (resolvingModules.has(id)) {
      state.blockedBy.push("dependency_cycle");
      return state;
    }
    resolvingModules.add(id);
    if (!state.entitled) state.blockedBy.push("not_entitled");
    if (!state.enabled) state.blockedBy.push("disabled");
    if (!state.available) state.blockedBy.push("unavailable");
    for (const dependency of moduleDependenciesById.get(id) ?? []) {
      if (Object.keys(dependency.conditions).length > 0) {
        state.blockedBy.push("conditional_dependency_unsupported");
        continue;
      }
      const target = resolveModule(dependency.dependsOnModuleId);
      if (dependency.dependencyType === "requires") {
        if (!target?.usable) state.blockedBy.push(`requires:${target?.key ?? dependency.dependsOnModuleId}`);
      } else if (dependency.dependencyType === "excludes") {
        if (target?.usable) state.blockedBy.push(`excludes:${target.key}`);
      } else {
        state.blockedBy.push(`unsupported_dependency:${dependency.dependencyType}`);
      }
    }
    resolvingModules.delete(id);
    state.usable = state.blockedBy.length === 0;
    modulesById.set(id, state);
    return state;
  }
  for (const module of rows.modules) resolveModule(module.id);

  const featuresById = new Map<string, FeatureCapabilityState>();
  const resolvingFeatures = new Set<string>();
  function resolveFeature(id: string): FeatureCapabilityState | undefined {
    const existing = featuresById.get(id);
    if (existing) return existing;
    const feature = featureById.get(id);
    if (!feature) return undefined;
    const providers = (membersByFeature.get(id) ?? []).map((member) => modulesById.get(member.moduleId)).filter((item): item is ModuleCapabilityState => !!item);
    const state: FeatureCapabilityState = {
      id, key: feature.key, name: feature.name,
      entitled: providers.some((provider) => provider.entitled),
      enabled: providers.some((provider) => provider.enabled),
      available: isAvailable(feature),
      usable: false, visible: false,
      providedBy: providers.map((provider) => provider.key),
      blockedBy: [],
    };
    if (resolvingFeatures.has(id)) {
      state.blockedBy.push("dependency_cycle");
      return state;
    }
    resolvingFeatures.add(id);
    if (!state.entitled) state.blockedBy.push("not_entitled");
    if (!state.available) state.blockedBy.push("unavailable");
    if (!providers.some((provider) => provider.usable)) state.blockedBy.push("module_unusable");
    for (const dependency of featureDependenciesById.get(id) ?? []) {
      if (Object.keys(dependency.conditions).length > 0) {
        state.blockedBy.push("conditional_dependency_unsupported");
        continue;
      }
      const target = resolveFeature(dependency.dependsOnFeatureId);
      if (dependency.dependencyType === "requires") {
        if (!target?.usable) state.blockedBy.push(`requires:${target?.key ?? dependency.dependsOnFeatureId}`);
      } else if (dependency.dependencyType === "excludes") {
        if (target?.usable) state.blockedBy.push(`excludes:${target.key}`);
      } else {
        state.blockedBy.push(`unsupported_dependency:${dependency.dependencyType}`);
      }
    }
    resolvingFeatures.delete(id);
    state.usable = state.blockedBy.length === 0;
    state.visible = state.usable && providers.some((provider) => provider.usable && provider.uiProminence !== "hidden");
    featuresById.set(id, state);
    return state;
  }
  for (const feature of rows.features) resolveFeature(feature.id);
  return {
    tenantId, asOf: at.toISOString(),
    modules: Object.fromEntries([...modulesById.values()].map((module) => [module.key, module])),
    features: Object.fromEntries([...featuresById.values()].map((feature) => [feature.key, feature])),
  };
}

export async function loadTenantCapabilities(db: Database, tenantId: string, at = new Date()): Promise<TenantCapabilityState> {
  const [modules, features, moduleFeatures, moduleDependencies, featureDependencies, grants, settings] = await Promise.all([
    db.select().from(capabilityModules),
    db.select().from(capabilityFeatures),
    db.select().from(capabilityModuleFeatures),
    db.select().from(capabilityModuleDependencies),
    db.select().from(capabilityFeatureDependencies),
    db.select().from(tenantCapabilityGrants).where(eq(tenantCapabilityGrants.tenantId, tenantId)),
    db.select().from(tenantCapabilitySettings).where(eq(tenantCapabilitySettings.tenantId, tenantId)),
  ]);
  return evaluateTenantCapabilities(tenantId, { modules, features, moduleFeatures, moduleDependencies, featureDependencies, grants, settings }, at);
}

export function hasUsableFeature(state: TenantCapabilityState, featureKey: string): boolean {
  return state.features[featureKey]?.usable === true;
}
