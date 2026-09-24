import { and, asc, eq } from "drizzle-orm";
import {
  auditEvents, connectorInstallations, domains, domainEvents, organizationLocations, organizations,
  priceRules, serviceZones, services, siteContents, sites, tenants,
} from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { getIndustryPack } from "@modular-crm/industry-packs";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { json, readBody } from "./http";
import { requireTenantFeature } from "./capability-enforcement";

const blankable = (max: number) => z.string().trim().max(max).optional().default("");
const serviceInput = z.object({ enabled: z.boolean().optional(), price: z.string().max(20).optional() });
const areaStepSchema = z.object({ areaType: z.enum(["zip", "radius", "later"]).default("later"), zips: blankable(2000), radiusMiles: z.number().int().min(1).max(500).optional() })
  .superRefine((data, context) => {
    if (data.areaType === "radius" && data.radiusMiles === undefined) context.addIssue({ code: "custom", path: ["radiusMiles"], message: "Enter a service radius from 1 to 500 miles." });
  });
const serviceStepSchema = z.object({ services: z.record(z.string(), serviceInput).optional().default({}), additionalPetPricing: z.enum(["yes", "no", "quote"]).default("yes") });
const stepSchemas: Record<number, z.ZodTypeAny> = {
  0: z.object({ packKey: z.string().min(1).max(80).optional() }),
  1: z.object({ businessName: z.string().trim().min(2).max(160), phone: blankable(40), email: z.union([z.email().max(254), z.literal("")]).optional().default(""), address: blankable(250), timezone: z.enum(["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"]).default("America/New_York"), brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }),
  2: areaStepSchema,
  3: serviceStepSchema,
  4: z.object({ paymentMode: z.enum(["demo", "manual", "connect"]).default("demo") }),
  5: z.object({ email: z.enum(["demo", "connect", "off"]).default("demo"), sms: z.enum(["demo", "connect", "off"]).default("demo") }),
  6: z.object({ importChoice: z.enum(["fresh", "csv", "later"]).default("fresh") }),
  7: z.object({ workDays: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])).max(7).optional().default(["Mon", "Tue", "Wed", "Thu", "Fri"]), technicianCount: z.number().int().min(0).max(500).default(1), ownerFieldWorker: z.boolean().default(false) }),
  8: z.object({ tagline: blankable(180), description: blankable(2000), hours: blankable(180), publish: z.boolean().default(false) }),
  9: z.object({}).passthrough(),
};

const patchOnboardingSchema = z.object({ step: z.number().int().min(0).max(9), data: z.record(z.string(), z.unknown()) });
const completeSchema = z.object({ publishWebsite: z.boolean().default(false) });
const websitePatchSchema = z.object({
  businessName: z.string().trim().min(2).max(160), tagline: blankable(180), description: blankable(2000),
  phone: blankable(40), email: z.union([z.email().max(254), z.literal("")]).optional().default(""),
  serviceArea: blankable(500), template: z.enum(["fresh", "classic"]).default("fresh"),
});

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;
type SiteRow = typeof sites.$inferSelect;
type OrgRow = typeof organizations.$inferSelect;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }

function ownerScope(actor: SessionActor): asserts actor is SessionActor & { kind: "staff"; organizationId: string } {
  requireStaff(actor);
  if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Only the business owner can complete onboarding.", 403);
  if (!actor.organizationId) throw new DomainError("FORBIDDEN", "A business workspace is required.", 403);
}

async function scopeRows(actor: SessionActor, tx: Executor = getDb()) {
  requireStaff(actor);
  if (!actor.organizationId) throw new DomainError("FORBIDDEN", "A business workspace is required.", 403);
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
  const [organization] = await tx.select().from(organizations).where(and(eq(organizations.id, actor.organizationId), eq(organizations.tenantId, actor.tenantId))).limit(1);
  const [site] = await tx.select().from(sites).where(and(eq(sites.tenantId, actor.tenantId), eq(sites.organizationId, actor.organizationId))).orderBy(asc(sites.createdAt)).limit(1);
  if (!tenant || !organization || !site) throw new DomainError("NOT_FOUND", "Business setup not found.", 404);
  return { tenant, organization, site };
}

async function recordStaffEvent(tx: Tx, actor: SessionActor, input: {
  type: string; action: string; entityType: string; entityId: string;
  before?: Record<string, unknown>; after?: Record<string, unknown>;
}) {
  await tx.insert(domainEvents).values({
    tenantId: actor.tenantId, eventType: input.type, actorType: "staff", actorId: actor.userId,
    entityType: input.entityType, entityId: input.entityId, organizationId: actor.kind === "staff" ? actor.organizationId : null,
    payload: input.after ?? {},
  });
  await tx.insert(auditEvents).values({
    tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId, action: input.action,
    entityType: input.entityType, entityId: input.entityId, beforeData: input.before, afterData: input.after ?? {},
  });
}

function postalCodes(raw: string): string[] {
  const entries = raw.split(/[\s,;]+/).map((part) => part.trim().toUpperCase()).filter(Boolean);
  if (entries.some((part) => !/^\d{5}(?:-\d{4})?$/.test(part))) {
    throw new DomainError("VALIDATION_ERROR", "Enter valid five-digit ZIP codes.", 422);
  }
  return [...new Set(entries)];
}

function priceInMinor(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new DomainError("VALIDATION_ERROR", "Enter a valid starting price.", 422);
  return Math.round(amount * 100);
}

async function ensureMockConnector(tx: Tx, actor: SessionActor, key: string, enabled: boolean) {
  if (!actor.organizationId) return;
  const providerAccountId = "local-demo";
  const [existing] = await tx.select().from(connectorInstallations).where(and(
    eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, key), eq(connectorInstallations.providerAccountId, providerAccountId),
  )).limit(1);
  if (existing) {
    const status = enabled ? "connected" : "disconnected";
    if (existing.status !== status) await tx.update(connectorInstallations).set({ status, settings: { ...object(existing.settings), mode: "test" } }).where(eq(connectorInstallations.id, existing.id));
    return;
  }
  if (!enabled) return;
  await tx.insert(connectorInstallations).values({ tenantId: actor.tenantId, organizationId: actor.organizationId, connectorKey: key, status: "connected", displayName: key === "mock-payments" ? "Demo payments" : "Demo messages", providerAccountId, settings: { mode: "test" } }).onConflictDoNothing();
}

async function applyServiceSetup(tx: Tx, actor: SessionActor, organization: OrgRow, data: z.infer<typeof serviceStepSchema>) {
  const aliases: Record<string, string> = {
    recurring: "recurring-cleanup", one_time: "one-time-cleanup", initial: "initial-cleanup",
    deodorizer: "deodorizer", commercial: "commercial-property-cleanup",
  };
  const defaults: Record<string, boolean> = { recurring: true, one_time: true, initial: true, deodorizer: false, commercial: false };
  const catalog = await tx.select().from(services).where(and(eq(services.tenantId, actor.tenantId), eq(services.organizationId, organization.id)));
  const selected = Object.entries(aliases).filter(([uiKey]) => data.services[uiKey]?.enabled ?? defaults[uiKey]);
  if (!selected.length) throw new DomainError("VALIDATION_ERROR", "Choose at least one service to continue.", 422);
  for (const [uiKey, serviceKey] of Object.entries(aliases)) {
    const service = catalog.find((item) => item.key === serviceKey);
    if (!service) continue;
    const enabled = data.services[uiKey]?.enabled ?? defaults[uiKey];
    await tx.update(services).set({ active: enabled }).where(and(eq(services.tenantId, actor.tenantId), eq(services.id, service.id)));
    const amountMinor = enabled ? priceInMinor(data.services[uiKey]?.price) : null;
    const ruleName = `Onboarding starting price: ${service.name}`;
    const [priorRule] = await tx.select().from(priceRules).where(and(eq(priceRules.tenantId, actor.tenantId), eq(priceRules.organizationId, organization.id), eq(priceRules.name, ruleName))).limit(1);
    if (amountMinor !== null) {
      const values = {
        tenantId: actor.tenantId, organizationId: organization.id, name: ruleName, priority: 50,
        conditions: { serviceId: service.id, serviceKey: service.key }, effects: { type: "set_base_amount", amountMinor }, active: true, source: "tenant",
      };
      if (priorRule) await tx.update(priceRules).set({ priority: 50, conditions: values.conditions, effects: values.effects, active: true }).where(eq(priceRules.id, priorRule.id));
      else await tx.insert(priceRules).values(values);
    } else if (priorRule?.active) await tx.update(priceRules).set({ active: false }).where(eq(priceRules.id, priorRule.id));
  }
  const petRuleName = "Onboarding additional-pet price review";
  const [petRule] = await tx.select().from(priceRules).where(and(eq(priceRules.tenantId, actor.tenantId), eq(priceRules.organizationId, organization.id), eq(priceRules.name, petRuleName))).limit(1);
  const mode = data.additionalPetPricing;
  const effects = { type: "mark_quote_required", reason: "Additional pets need a service-price review." };
  const conditions = mode === "yes" ? { field: "fields.petCount", operator: "greater_than", value: 1 } : {};
  if (mode === "quote" || mode === "yes") {
    if (petRule) await tx.update(priceRules).set({ conditions, effects, active: true }).where(eq(priceRules.id, petRule.id));
    else await tx.insert(priceRules).values({ tenantId: actor.tenantId, organizationId: organization.id, name: petRuleName, priority: 60, conditions, effects, active: true, source: "tenant" });
  } else if (petRule?.active) await tx.update(priceRules).set({ active: false }).where(eq(priceRules.id, petRule.id));
}

async function applyAreaSetup(tx: Tx, actor: SessionActor, site: SiteRow, data: z.infer<typeof areaStepSchema>, settings: Record<string, unknown>) {
  const zips = data.areaType === "zip" ? postalCodes(data.zips) : [];
  if (data.areaType === "zip" && !zips.length) throw new DomainError("VALIDATION_ERROR", "Enter at least one ZIP code or choose another service area option.", 422);
  const nextSettings = { ...settings, servicePostalCodes: zips, serviceAreaType: data.areaType };
  const areaSummary = data.areaType === "zip" && zips.length ? `ZIP codes ${zips.join(", ")}`
    : data.areaType === "radius" ? `Within ${data.radiusMiles ?? 0} miles of the business` : "";
  await tx.update(tenants).set({ settings: nextSettings }).where(eq(tenants.id, actor.tenantId));
  let [zone] = await tx.select().from(serviceZones).where(and(eq(serviceZones.tenantId, actor.tenantId), eq(serviceZones.organizationId, site.organizationId), eq(serviceZones.name, "Onboarding service area"))).limit(1);
  if (data.areaType === "later") {
    if (zone?.active) await tx.update(serviceZones).set({ active: false }).where(eq(serviceZones.id, zone.id));
  } else {
    const values = {
      zoneType: data.areaType === "zip" ? "postal_codes" : "radius",
      definition: data.areaType === "zip" ? { postalCodes: zips } : { radiusMiles: data.radiusMiles ?? 0, requiresAddressReview: true },
      active: true,
    };
    if (zone) await tx.update(serviceZones).set(values).where(eq(serviceZones.id, zone.id));
    else [zone] = await tx.insert(serviceZones).values({ tenantId: actor.tenantId, organizationId: site.organizationId, name: "Onboarding service area", ...values }).returning();
  }
  const siteSettings = { ...object(site.settings), serviceArea: areaSummary, serviceAreaType: data.areaType };
  await tx.update(sites).set({ settings: siteSettings }).where(and(eq(sites.id, site.id), eq(sites.tenantId, actor.tenantId)));
}

async function applyStep(tx: Tx, actor: SessionActor, step: number, rawData: Record<string, unknown>) {
  const data = stepSchemas[step]!.parse(rawData) as Record<string, unknown>;
  const scoped = await scopeRows(actor, tx);
  const { site, organization, tenant } = scoped;
  const settings = object(tenant.settings);
  const priorOnboarding = object(settings.onboarding);
  const savedData = object(priorOnboarding.data);
  const mergedData = { ...savedData, [step]: data } as Record<string, Record<string, unknown>>;
  if (step === 0) {
    const packKey = stringValue(data.packKey) || tenant.industryPackKey || "pet-waste-removal";
    const pack = getIndustryPack(packKey);
    if (!pack) throw new DomainError("VALIDATION_ERROR", "Choose an available industry to continue.", 422);
    await tx.update(tenants).set({ industryPackKey: pack.key, industryPackVersion: pack.version }).where(eq(tenants.id, actor.tenantId));
  } else if (step === 1) {
    const businessName = stringValue(data.businessName);
    const timezone = stringValue(data.timezone) || "America/New_York";
    await tx.update(organizations).set({ displayName: businessName, legalName: businessName, phone: stringValue(data.phone) || null, email: stringValue(data.email).toLowerCase() || null, timezone }).where(and(eq(organizations.id, organization.id), eq(organizations.tenantId, actor.tenantId)));
    await tx.update(tenants).set({ name: businessName, defaultTimezone: timezone }).where(eq(tenants.id, actor.tenantId));
    if (actor.defaultLocationId) {
      const [location] = await tx.select().from(organizationLocations).where(and(eq(organizationLocations.id, actor.defaultLocationId), eq(organizationLocations.organizationId, organization.id), eq(organizationLocations.tenantId, actor.tenantId))).limit(1);
      if (location) await tx.update(organizationLocations).set({ addressLine1: stringValue(data.address) || null, timezone, phone: stringValue(data.phone) || null, email: stringValue(data.email).toLowerCase() || null }).where(eq(organizationLocations.id, location.id));
    }
    const branding = { ...object(site.branding), businessName, accentColor: stringValue(data.brandColor) || "#173d35" };
    await tx.update(sites).set({ branding }).where(and(eq(sites.id, site.id), eq(sites.tenantId, actor.tenantId)));
  } else if (step === 2) {
    await applyAreaSetup(tx, actor, site, areaStepSchema.parse(rawData), settings);
  } else if (step === 3) {
    await applyServiceSetup(tx, actor, organization, serviceStepSchema.parse(rawData));
  } else if (step === 4) {
    const paymentMode = stringValue(data.paymentMode) || "demo";
    await ensureMockConnector(tx, actor, "mock-payments", paymentMode === "demo");
    await tx.update(tenants).set({ settings: { ...settings, paymentMode, demoMode: paymentMode === "demo", onboarding: { ...priorOnboarding, data: mergedData } } }).where(eq(tenants.id, actor.tenantId));
  } else if (step === 5) {
    const email = stringValue(data.email) || "demo";
    const sms = stringValue(data.sms) || "demo";
    await ensureMockConnector(tx, actor, "mock-communication", email === "demo" || sms === "demo");
    await tx.update(tenants).set({ settings: { ...settings, communicationModes: { email, sms } } }).where(eq(tenants.id, actor.tenantId));
  } else if (step === 7) {
    await tx.update(tenants).set({ settings: { ...settings, workDays: data.workDays, technicianCount: data.technicianCount, ownerFieldWorker: data.ownerFieldWorker } }).where(eq(tenants.id, actor.tenantId));
  } else if (step === 8) {
    const [content] = await tx.select().from(siteContents).where(and(eq(siteContents.tenantId, actor.tenantId), eq(siteContents.siteId, site.id), eq(siteContents.contentKey, "home"))).limit(1);
    const currentContent = object(content?.content);
    const nextContent = { ...currentContent, tagline: stringValue(data.tagline), headline: stringValue(data.tagline), description: stringValue(data.description), hours: stringValue(data.hours) };
    if (content) await tx.update(siteContents).set({ content: nextContent, version: content.version + 1 }).where(eq(siteContents.id, content.id));
    else await tx.insert(siteContents).values({ tenantId: actor.tenantId, siteId: site.id, contentKey: "home", content: nextContent });
    await tx.update(sites).set({ branding: { ...object(site.branding), tagline: stringValue(data.tagline) } }).where(and(eq(sites.id, site.id), eq(sites.tenantId, actor.tenantId)));
  }
  const currentOnboarding = object(object(tenant.settings).onboarding);
  const currentSaved = object(currentOnboarding.data);
  const nextAnswers = { ...currentSaved, [step]: data };
  const nextStep = Math.max(Number(currentOnboarding.step) || 0, Math.min(9, step + 1));
  const updatedSettings = { ...object((await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1))[0]?.settings), onboarding: { ...currentOnboarding, data: nextAnswers, step: nextStep, completed: false } };
  await tx.update(tenants).set({ settings: updatedSettings }).where(eq(tenants.id, actor.tenantId));
  return { item: { step: nextStep, data: nextAnswers } };
}

async function snapshotFromDraft(tx: Tx, site: SiteRow, organization: OrgRow, tenantSettings: Record<string, unknown>) {
  const [contentRow] = await tx.select().from(siteContents).where(and(eq(siteContents.tenantId, site.tenantId), eq(siteContents.siteId, site.id), eq(siteContents.contentKey, "home"))).limit(1);
  const content = object(contentRow?.content);
  const branding = object(site.branding);
  const siteSettings = object(site.settings);
  const serviceRows = await tx.select().from(services).where(and(eq(services.tenantId, site.tenantId), eq(services.organizationId, site.organizationId), eq(services.active, true))).orderBy(asc(services.name));
  const priceRows = await tx.select().from(priceRules).where(and(eq(priceRules.tenantId, site.tenantId), eq(priceRules.organizationId, site.organizationId), eq(priceRules.active, true)));
  const publicServices = serviceRows.filter((service) => service.serviceType !== "add_on" && service.serviceType !== "recovery").map((service) => {
    const matching = priceRows.filter((rule) => {
      const conditions = object(rule.conditions);
      return (conditions.serviceId === service.id || conditions.serviceKey === service.key) && conditions.frequency === undefined;
    }).sort((a, b) => b.priority - a.priority);
    const effect = object(matching[0]?.effects);
    const price = effect.type === "set_base_amount" && Number.isSafeInteger(effect.amountMinor) ? Number(effect.amountMinor)
      : Number.isSafeInteger(effect.baseMinor) ? Number(effect.baseMinor) : null;
    return { id: service.id, key: service.key, name: service.name, description: service.description ?? "", basePriceCents: price };
  });
  const zips = Array.isArray(tenantSettings.servicePostalCodes) ? tenantSettings.servicePostalCodes.filter((zip): zip is string => typeof zip === "string") : [];
  const area = stringValue(siteSettings.serviceArea) || (zips.length ? `ZIP codes ${zips.join(", ")}` : "your local community");
  return {
    businessName: stringValue(branding.businessName) || organization.displayName,
    tagline: stringValue(content.tagline) || stringValue(content.headline) || stringValue(branding.tagline),
    description: stringValue(content.description), phone: organization.phone ?? "", email: organization.email ?? "",
    serviceArea: area, faqs: Array.isArray(content.faqs) ? content.faqs : [], services: publicServices,
    termsVersion: stringValue(siteSettings.termsVersion) || "v1",
  };
}

async function publishWithinTransaction(tx: Tx, actor: SessionActor, site: SiteRow, organization: OrgRow, tenantSettings: Record<string, unknown>) {
  const snapshot = await snapshotFromDraft(tx, site, organization, tenantSettings);
  const now = new Date();
  const priorSettings = object(site.settings);
  await tx.update(sites).set({ status: "published", publishedAt: now, settings: { ...priorSettings, publishedSnapshot: snapshot } }).where(and(eq(sites.id, site.id), eq(sites.tenantId, actor.tenantId)));
  const [platformDomain] = await tx.select().from(domains).where(and(eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.domainType, "platform"))).limit(1);
  if (!platformDomain) await tx.insert(domains).values({ tenantId: actor.tenantId, siteId: site.id, hostname: `${site.slug}.modular.local`, domainType: "platform", verificationStatus: "verified", isPrimary: true, verifiedAt: now });
  else if (!platformDomain.isPrimary) await tx.update(domains).set({ isPrimary: true, verificationStatus: "verified", verifiedAt: now }).where(eq(domains.id, platformDomain.id));
  await recordStaffEvent(tx, actor, { type: "site.published", action: "site.publish", entityType: "site", entityId: site.id, before: { status: site.status }, after: { status: "published", slug: site.slug } });
}

async function websiteItem(actor: SessionActor) {
  const { site, organization } = await scopeRows(actor);
  const [contentRow] = await getDb().select().from(siteContents).where(and(eq(siteContents.tenantId, actor.tenantId), eq(siteContents.siteId, site.id), eq(siteContents.contentKey, "home"))).limit(1);
  const content = object(contentRow?.content);
  const settings = object(site.settings);
  const branding = object(site.branding);
  const [domain] = await getDb().select().from(domains).where(and(eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.isPrimary, true))).limit(1);
  return {
    id: site.id, status: site.status, slug: site.slug, domain: domain?.hostname ?? `${site.slug}.modular.local`,
    businessName: organization.displayName, phone: organization.phone ?? "", email: organization.email ?? "",
    tagline: stringValue(content.tagline) || stringValue(content.headline) || stringValue(branding.tagline),
    description: stringValue(content.description), serviceArea: stringValue(settings.serviceArea),
    template: site.templateKey === "classic" ? "classic" : "fresh", publishedAt: site.publishedAt?.toISOString() ?? null,
  };
}

async function patchWebsite(actor: SessionActor, values: z.infer<typeof websitePatchSchema>) {
  const db = getDb();
  const item = await db.transaction(async (tx) => {
    const { site, organization, tenant } = await scopeRows(actor, tx);
    const priorSettings = object(site.settings);
    const tenantSettings = object(tenant.settings);
    let nextSettings = { ...priorSettings };
    if (site.status === "published" && !priorSettings.publishedSnapshot) {
      nextSettings.publishedSnapshot = await snapshotFromDraft(tx, site, organization, tenantSettings);
    }
    const [contentRow] = await tx.select().from(siteContents).where(and(eq(siteContents.tenantId, actor.tenantId), eq(siteContents.siteId, site.id), eq(siteContents.contentKey, "home"))).limit(1);
    const content = object(contentRow?.content);
    const nextContent = { ...content, tagline: values.tagline, headline: values.tagline, description: values.description };
    const nextBranding = { ...object(site.branding), businessName: values.businessName, tagline: values.tagline };
    const before = { businessName: organization.displayName, phone: organization.phone, email: organization.email, tagline: content.tagline ?? content.headline, description: content.description, serviceArea: priorSettings.serviceArea, template: site.templateKey };
    await tx.update(organizations).set({ displayName: values.businessName, legalName: values.businessName, phone: values.phone || null, email: values.email.toLowerCase() || null }).where(and(eq(organizations.id, organization.id), eq(organizations.tenantId, actor.tenantId)));
    if (contentRow) await tx.update(siteContents).set({ content: nextContent, version: contentRow.version + 1 }).where(eq(siteContents.id, contentRow.id));
    else await tx.insert(siteContents).values({ tenantId: actor.tenantId, siteId: site.id, contentKey: "home", content: nextContent });
    const nextStatus = site.status === "published" ? "draft" : site.status;
    nextSettings = { ...nextSettings, serviceArea: values.serviceArea };
    await tx.update(sites).set({ branding: nextBranding, settings: nextSettings, templateKey: values.template, status: nextStatus }).where(and(eq(sites.id, site.id), eq(sites.tenantId, actor.tenantId)));
    const after = { businessName: values.businessName, phone: values.phone, email: values.email, tagline: values.tagline, description: values.description, serviceArea: values.serviceArea, template: values.template, status: nextStatus };
    await recordStaffEvent(tx, actor, { type: "site.content_updated", action: "site.content_update", entityType: "site", entityId: site.id, before, after });
    return { ...after, id: site.id, slug: site.slug, domain: `${site.slug}.modular.local`, publishedAt: site.publishedAt?.toISOString() ?? null };
  });
  return item;
}

async function completeOnboarding(actor: SessionActor, publishWebsite: boolean) {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const { tenant, organization, site } = await scopeRows(actor, tx);
    const settings = object(tenant.settings);
    const onboarding = object(settings.onboarding);
    const savedData = object(onboarding.data);
    const businessStep = object(savedData["1"]);
    if (!organization.displayName.trim() || !stringValue(businessStep.businessName).trim()) throw new DomainError("VALIDATION_ERROR", "Add your business name before finishing setup.", 422);
    const activeServices = await tx.select({ id: services.id }).from(services).where(and(eq(services.tenantId, actor.tenantId), eq(services.organizationId, organization.id), eq(services.active, true))).limit(1);
    if (!activeServices.length) throw new DomainError("VALIDATION_ERROR", "Choose at least one service before finishing setup.", 422);
    const updatedSettings = { ...settings, onboardingComplete: true, onboarding: { ...onboarding, step: 9, completed: true, completedAt: new Date().toISOString() } };
    await tx.update(tenants).set({ settings: updatedSettings }).where(eq(tenants.id, actor.tenantId));
    if (publishWebsite) await publishWithinTransaction(tx, actor, site, organization, updatedSettings);
    await recordStaffEvent(tx, actor, { type: "onboarding.completed", action: "onboarding.complete", entityType: "tenant", entityId: tenant.id, before: { onboardingComplete: settings.onboardingComplete === true }, after: { onboardingComplete: true, websitePublished: publishWebsite } });
    return { onboardingComplete: true, websiteStatus: publishWebsite ? "published" : site.status };
  });
  return result;
}

/** Handles authenticated owner setup and website editing/publishing APIs. */
export async function handleOnboardingSite(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] === "onboarding") {
    ownerScope(actor);
    if (path.length === 1 && request.method === "GET") {
      const { tenant } = await scopeRows(actor);
      const onboarding = object(object(tenant.settings).onboarding);
      return json({ item: { step: Number.isInteger(onboarding.step) ? Math.min(9, Math.max(0, Number(onboarding.step))) : 0, data: object(onboarding.data), complete: onboarding.completed === true } });
    }
    if (path.length === 1 && request.method === "PATCH") {
      const input = await readBody(request, patchOnboardingSchema);
      const data = (stepSchemas[input.step] as z.ZodTypeAny).parse(input.data) as Record<string, unknown>;
      const db = getDb();
      const result = await db.transaction(async (tx) => applyStep(tx, actor, input.step, data));
      return json(result);
    }
    if (path[1] === "complete" && path.length === 2 && request.method === "POST") {
      const input = await readBody(request, completeSchema);
      if (input.publishWebsite) await requireTenantFeature(actor.tenantId, "website_publishing");
      return json({ item: await completeOnboarding(actor, input.publishWebsite) });
    }
    throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  }
  if (path[0] !== "website") return null;
  requireStaff(actor);
  if (path.length === 1 && request.method === "GET") {
    requirePermission(actor, "website.read");
    return json({ item: await websiteItem(actor) });
  }
  if (path.length === 1 && request.method === "PATCH") {
    requirePermission(actor, "website.content_manage");
    const input = await readBody(request, websitePatchSchema);
    return json({ item: await patchWebsite(actor, input) });
  }
  if (path[1] === "publish" && path.length === 2 && request.method === "POST") {
    requirePermission(actor, "website.publish");
    const db = getDb();
    const published = await db.transaction(async (tx) => {
      const { site, organization, tenant } = await scopeRows(actor, tx);
      await publishWithinTransaction(tx, actor, site, organization, object(tenant.settings));
      return { id: site.id, status: "published", slug: site.slug, publishedAt: new Date().toISOString() };
    });
    return json({ item: published });
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
