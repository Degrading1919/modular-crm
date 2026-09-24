import { and, eq, isNull, or, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  capabilityModuleDependencies, capabilityModules, loadTenantCapabilities,
  tenantCapabilityGrants, tenantCapabilitySettings, tenants, type TenantCapabilityState,
} from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import {
  evaluateProductCapabilityRecommendations, getIndustryPack,
  type EvaluatedProductCapabilityRecommendation, type PackOnboardingAnswers,
} from "@modular-crm/industry-packs";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";

const answerValue = z.union([z.string().max(100), z.number().finite(), z.boolean()]);
const answersSchema = z.record(z.string().max(100), answerValue)
  .refine((answers) => Object.keys(answers).length <= 40, "Too many setup answers.");
const recommendationBody = z.object({ answers: answersSchema }).strict();
const setupBody = z.discriminatedUnion("selection", [
  z.object({ selection: z.literal("recommended"), answers: answersSchema }).strict(),
  z.object({ selection: z.literal("custom"), answers: answersSchema, moduleKeys: z.array(z.string().min(1).max(100)).max(50) }).strict(),
]);
const settingBody = z.object({
  enabled: z.boolean().optional(),
  uiProminence: z.enum(["featured", "standard", "hidden"]).optional(),
}).strict().refine((value) => value.enabled !== undefined || value.uiProminence !== undefined, "Choose a setting to change.");
const SELF_SERVICE_SOURCES = ["owner_selection", "signup_recommendation", "development_seed"];

function requireSetupOwner(actor: SessionActor): void {
  requireStaff(actor);
  requirePermission(actor, "tenant.billing_manage");
}

function isRequiredModule(metadata: Record<string, unknown>): boolean {
  return metadata.required === true;
}

async function catalog(actor: SessionActor) {
  const db = getDb();
  const [state, modules, dependencies, tenant] = await Promise.all([
    loadTenantCapabilities(db, actor.tenantId),
    db.select().from(capabilityModules),
    db.select().from(capabilityModuleDependencies),
    db.select({ settings: tenants.settings, industryPackKey: tenants.industryPackKey }).from(tenants)
      .where(eq(tenants.id, actor.tenantId)).limit(1).then((rows) => rows[0]),
  ]);
  if (!tenant) throw new DomainError("NOT_FOUND", "Business not found.", 404);
  return { state, modules, dependencies, tenant };
}

function answersFromSettings(settings: Record<string, unknown>): PackOnboardingAnswers {
  const stored = settings.capabilityAnswers;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const parsed = answersSchema.safeParse(stored);
  return parsed.success ? parsed.data : {};
}

function recommendations(packKey: string | null, answers: PackOnboardingAnswers): readonly EvaluatedProductCapabilityRecommendation[] {
  const pack = packKey ? getIndustryPack(packKey) : undefined;
  return pack ? evaluateProductCapabilityRecommendations(pack, answers) : [];
}

function recommendedModuleKeys(
  state: TenantCapabilityState,
  modules: readonly (typeof capabilityModules.$inferSelect)[],
  dependencies: readonly (typeof capabilityModuleDependencies.$inferSelect)[],
  items: readonly EvaluatedProductCapabilityRecommendation[],
): string[] {
  const recommendedFeatures = new Set(items.filter((item) => item.recommendation === "normally_recommended").map((item) => item.featureKey));
  const byId = new Map(modules.map((module) => [module.id, module]));
  const selected = new Set(modules.filter((module) =>
    isRequiredModule(module.metadata)
    || state.modules[module.key]?.featureKeys.some((feature) => recommendedFeatures.has(feature)),
  ).map((module) => module.key));
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of dependencies) {
      const module = byId.get(dependency.moduleId);
      const required = byId.get(dependency.dependsOnModuleId);
      if (dependency.dependencyType === "requires" && module && required && selected.has(module.key) && !selected.has(required.key)) {
        selected.add(required.key);
        changed = true;
      }
    }
  }
  return [...selected];
}

function presentCatalog(
  state: TenantCapabilityState,
  modules: readonly (typeof capabilityModules.$inferSelect)[],
  dependencies: readonly (typeof capabilityModuleDependencies.$inferSelect)[],
  packKey: string | null,
  answers: PackOnboardingAnswers,
  setupComplete = false,
) {
  const pack = packKey ? getIndustryPack(packKey) : undefined;
  const items = recommendations(packKey, answers);
  const recommendationByFeature = new Map(items.map((item) => [item.featureKey, item]));
  const recommendedKeys = recommendedModuleKeys(state, modules, dependencies, items);
  const moduleKeysById = new Map(modules.map((module) => [module.id, module.key]));
  return {
    modules: modules.map((module) => ({
      ...state.modules[module.key],
      required: isRequiredModule(module.metadata),
      recommended: recommendedKeys.includes(module.key),
      dependsOnKeys: dependencies.filter((dependency) => dependency.moduleId === module.id && dependency.dependencyType === "requires")
        .map((dependency) => moduleKeysById.get(dependency.dependsOnModuleId)).filter((key): key is string => !!key),
      recommendations: (state.modules[module.key]?.featureKeys ?? []).map((key) => recommendationByFeature.get(key)).filter(Boolean),
    })),
    features: state.features,
    questions: pack?.recommendationQuestions ?? [],
    answers,
    recommendedModuleKeys: recommendedKeys,
    packName: pack?.displayName ?? null,
    setupComplete,
    commercialTermsConfigured: false,
  };
}

function expandSelection(
  keys: readonly string[],
  state: TenantCapabilityState,
  modules: readonly (typeof capabilityModules.$inferSelect)[],
  dependencies: readonly (typeof capabilityModuleDependencies.$inferSelect)[],
): string[] {
  const byKey = new Map(modules.map((module) => [module.key, module]));
  const byId = new Map(modules.map((module) => [module.id, module]));
  const selected = new Set<string>();
  for (const key of keys) {
    const module = byKey.get(key);
    if (!module || !state.modules[key]?.available) throw new DomainError("VALIDATION_ERROR", "One selected capability is unavailable.", 422);
    selected.add(key);
  }
  for (const module of modules) if (isRequiredModule(module.metadata)) selected.add(module.key);
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of dependencies) {
      const module = byId.get(dependency.moduleId);
      const required = byId.get(dependency.dependsOnModuleId);
      if (module && selected.has(module.key)) {
        if (Object.keys(dependency.conditions).length > 0) {
          throw new DomainError("CONFLICT", "This capability has a conditional dependency that this setup flow cannot evaluate.", 409);
        }
        if (dependency.dependencyType === "excludes") {
          if (required && selected.has(required.key)) throw new DomainError("VALIDATION_ERROR", "These capabilities cannot be used together.", 422);
          continue;
        }
        if (dependency.dependencyType !== "requires") {
          throw new DomainError("CONFLICT", "This capability has an unsupported catalog dependency.", 409);
        }
        if (!required || !state.modules[required.key]?.available) {
          throw new DomainError("CONFLICT", "A required capability is unavailable.", 409);
        }
        if (!selected.has(required.key)) { selected.add(required.key); changed = true; }
      }
    }
  }
  return [...selected];
}

async function saveSetup(actor: SessionActor, requested: string[], answers: PackOnboardingAnswers): Promise<string[]> {
  requireSetupOwner(actor);
  const { state, modules, dependencies } = await catalog(actor);
  const selected = expandSelection(requested, state, modules, dependencies);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from tenants where id = ${actor.tenantId} for update`);
    const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants)
      .where(eq(tenants.id, actor.tenantId)).limit(1);
    if (!tenant) throw new DomainError("NOT_FOUND", "Business not found.", 404);
    const now = new Date();
    const moduleById = new Map(modules.map((module) => [module.id, module]));
    const selectedIds = new Set(modules.filter((module) => selected.includes(module.key)).map((module) => module.id));
    const activeGrants = await tx.select().from(tenantCapabilityGrants).where(and(
      eq(tenantCapabilityGrants.tenantId, actor.tenantId),
      isNull(tenantCapabilityGrants.revokedAt),
      lte(tenantCapabilityGrants.effectiveFrom, now),
      or(isNull(tenantCapabilityGrants.effectiveUntil), gt(tenantCapabilityGrants.effectiveUntil, now)),
    ));
    const selfServiceGrants = activeGrants.filter((grant) => SELF_SERVICE_SOURCES.includes(grant.source));
    const selfServiceIds = new Set(selfServiceGrants.map((grant) => grant.moduleId));
    const managedIds = new Set(activeGrants.filter((grant) => !SELF_SERVICE_SOURCES.includes(grant.source)).map((grant) => grant.moduleId));
    for (const module of modules) {
      if (!selectedIds.has(module.id) && managedIds.has(module.id) && !isRequiredModule(module.metadata)) {
        throw new DomainError("CONFLICT", "This capability is included through a managed grant and cannot be removed here.", 409);
      }
    }
    for (const grant of selfServiceGrants) {
      if (!selectedIds.has(grant.moduleId) && !isRequiredModule(moduleById.get(grant.moduleId)!.metadata)) {
        await tx.update(tenantCapabilityGrants).set({ revokedAt: now, updatedAt: now })
          .where(and(eq(tenantCapabilityGrants.id, grant.id), eq(tenantCapabilityGrants.tenantId, actor.tenantId)));
      }
    }
    const activeIds = selfServiceIds;
    for (const module of modules) {
      if (selectedIds.has(module.id) && !activeIds.has(module.id) && !state.modules[module.key]?.entitled) {
        await tx.insert(tenantCapabilityGrants).values({
          tenantId: actor.tenantId, moduleId: module.id, source: "owner_selection",
          sourceReference: actor.membershipId ?? actor.userId, effectiveFrom: now,
          grantDetails: { selection: "self_service" },
        });
      }
      if (selectedIds.has(module.id)) {
        await tx.insert(tenantCapabilitySettings).values({
          tenantId: actor.tenantId, moduleId: module.id, enabled: true, uiProminence: "standard",
        }).onConflictDoUpdate({
          target: [tenantCapabilitySettings.tenantId, tenantCapabilitySettings.moduleId],
          set: { enabled: true, updatedAt: now },
        });
      } else if (activeIds.has(module.id)) {
        await tx.update(tenantCapabilitySettings).set({ enabled: false, updatedAt: now })
          .where(and(eq(tenantCapabilitySettings.tenantId, actor.tenantId), eq(tenantCapabilitySettings.moduleId, module.id)));
      }
    }
    await tx.update(tenants).set({ settings: { ...tenant.settings, capabilityAnswers: answers, capabilitySetupComplete: true }, updatedAt: now })
      .where(eq(tenants.id, actor.tenantId));
    await recordEvent(actor, {
      type: "tenant.capabilities_changed", entityType: "tenant", entityId: actor.tenantId,
      auditAction: "tenant.capabilities_change", after: { moduleKeys: selected, answers },
    }, tx);
  });
  return selected;
}

export async function handleTenantCapabilities(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "capabilities") return null;
  requireStaff(actor);
  if (path.length === 1 && request.method === "GET") {
    requirePermission(actor, "tenant.read");
    const { state, modules, dependencies, tenant } = await catalog(actor);
    return json({ item: presentCatalog(state, modules, dependencies, tenant.industryPackKey, answersFromSettings(tenant.settings), tenant.settings.capabilitySetupComplete === true) });
  }
  if (path.length === 2 && path[1] === "recommendations" && request.method === "POST") {
    requireSetupOwner(actor);
    const input = await readBody(request, recommendationBody);
    const { state, modules, dependencies, tenant } = await catalog(actor);
    return json({ item: presentCatalog(state, modules, dependencies, tenant.industryPackKey, input.answers, tenant.settings.capabilitySetupComplete === true) });
  }
  if (path.length === 2 && path[1] === "setup" && request.method === "POST") {
    requireSetupOwner(actor);
    const input = await readBody(request, setupBody);
    const { state, modules, dependencies, tenant } = await catalog(actor);
    const moduleKeys = input.selection === "recommended"
      ? recommendedModuleKeys(state, modules, dependencies, recommendations(tenant.industryPackKey, input.answers))
      : input.moduleKeys;
    const selected = await saveSetup(actor, moduleKeys, input.answers);
    const updated = await catalog(actor);
    return json({ item: { ...presentCatalog(updated.state, updated.modules, updated.dependencies, updated.tenant.industryPackKey, input.answers, true), selectedModuleKeys: selected } });
  }
  if (path.length === 2 && request.method === "PATCH") {
    requireSetupOwner(actor);
    const key = path[1]!;
    const body = await readBody(request, settingBody);
    const { state, modules } = await catalog(actor);
    const module = modules.find((item) => item.key === key);
    if (!module) throw new DomainError("NOT_FOUND", "Capability not found.", 404);
    if (body.enabled === false && isRequiredModule(module.metadata)) {
      throw new DomainError("VALIDATION_ERROR", "The business foundation must remain enabled.", 422);
    }
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.insert(tenantCapabilitySettings).values({
        tenantId: actor.tenantId, moduleId: module.id,
        enabled: body.enabled ?? state.modules[key]!.enabled,
        uiProminence: body.uiProminence ?? state.modules[key]!.uiProminence,
      }).onConflictDoUpdate({
        target: [tenantCapabilitySettings.tenantId, tenantCapabilitySettings.moduleId],
        set: {
          enabled: body.enabled ?? state.modules[key]!.enabled,
          uiProminence: body.uiProminence ?? state.modules[key]!.uiProminence,
          updatedAt: new Date(),
        },
      });
      await recordEvent(actor, {
        type: "tenant.capability_setting_changed", entityType: "capability_module", entityId: module.id,
        auditAction: "tenant.capability_setting_change",
        before: { enabled: state.modules[key]!.enabled, uiProminence: state.modules[key]!.uiProminence },
        after: {
          enabled: body.enabled ?? state.modules[key]!.enabled,
          uiProminence: body.uiProminence ?? state.modules[key]!.uiProminence,
        },
      }, tx);
    });
    const updated = await loadTenantCapabilities(db, actor.tenantId);
    return json({ item: updated.modules[key] });
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
