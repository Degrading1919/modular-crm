import { createHash, createHmac, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import {
  auditEvents, consentRecords, connectorInstallations, customerAssets, customerContacts, customers, hasUsableFeature, loadTenantCapabilities,
  domainEvents, leads, notificationPreferences, organizations, paymentMethodReferences, priceRules, recurrenceRules, serviceLocations,
  servicePlans, services, serviceZones, siteContents, siteForms, siteSubmissions, sites, taxRules,
  termsAcceptances, termsVersions, tenants,
} from "@modular-crm/db";
import { DomainError } from "@modular-crm/domain";
import { evaluatePrice, snapshotPriceResult, type PriceResult, type PriceRule, type PricingEffect } from "@modular-crm/pricing";
import { evaluateConditions, type Condition } from "@modular-crm/config";
import { validatePackIntakeValues } from "@modular-crm/industry-packs";
import { z } from "zod";
import { getDb } from "../db";
import { json } from "./http";
import { requireTenantFeature } from "./capability-enforcement";
import { encryptServiceAccessInstructions } from "./service-access";
import { recurrencePresetSchedule, resolveTenantIndustryPack } from "./industry-pack-runtime";
import { authSigningSecret } from "../runtime-secret";

const PUBLIC_BODY_LIMIT = 64 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_SERVICE_TERMS_CONTENT = "I agree to be contacted about this request and accept the service terms.";
// Local V1 fixed-window limits are per web process. A multi-instance deployment should move this key/window policy to shared storage.
const rateWindows = new Map<string, { startedAt: number; count: number }>();

const slugSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i);
const addressSchema = z.string().trim().min(3).max(250);
const zipSchema = z.string().trim().min(3).max(16);
const eligibilitySchema = z.object({ slug: slugSchema, address: addressSchema, zip: zipSchema });
const quoteSchema = eligibilitySchema.extend({
  serviceId: z.string().min(1).max(100), serviceKey: z.string().min(1).max(100).optional(),
  frequency: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_-]*$/),
  industryData: z.unknown().optional(),
  preferredDay: z.string().max(80).optional(),
  requestDetails: z.string().trim().max(4000).optional(),
});
const contactSchema = z.object({
  slug: slugSchema, name: z.string().trim().min(2).max(160), email: z.email().max(254),
  phone: z.string().trim().max(40).optional().default(""), message: z.string().trim().min(1).max(4000),
});
const signupSchema = eligibilitySchema.extend({
  contact: z.object({ name: z.string().trim().min(2).max(160), email: z.email().max(254), phone: z.string().trim().min(5).max(40) }),
  service: z.object({ id: z.string().min(1).max(100), key: z.string().min(1).max(100).optional(), frequency: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_-]*$/) }),
  industryData: z.unknown().optional(),
  requestDetails: z.string().trim().max(4000).optional().default(""),
  preferredDay: z.string().max(40).optional().default(""), quoteId: z.string().max(100).optional(),
  paymentMethod: z.enum(["demo"]).optional(),
  notificationPreferences: z.object({ email: z.boolean().default(true), sms: z.boolean().default(true) }).default({ email: true, sms: true }),
  termsAccepted: z.literal(true), termsVersion: z.string().trim().min(1).max(40).default("v1"),
  idempotencyKey: z.string().trim().min(8).max(200),
});

type PublicSiteRow = {
  site: typeof sites.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  organization: typeof organizations.$inferSelect;
};

type EligibilityResult = { eligible: boolean; message: string; zoneId?: string; reason?: string };
type SiteSnapshot = Record<string, unknown> & {
  businessName?: string; tagline?: string; description?: string; phone?: string; email?: string;
  serviceArea?: string; faqs?: unknown[]; services?: Record<string, unknown>[]; termsVersion?: string;
};

function publicError(status: number, code: string, message: string, retryAfterSeconds?: number): Response {
  return json({ error: { code, message } }, status, retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : undefined);
}

function remoteIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(raw.slice(0, 160)).digest("hex").slice(0, 24);
}

function rateLimit(request: Request, slug: string, action: string, limit: number): Response | null {
  const now = Date.now();
  const key = `${action}:${slug}:${remoteIp(request)}`;
  let window = rateWindows.get(key);
  if (!window || now - window.startedAt >= RATE_WINDOW_MS) {
    window = { startedAt: now, count: 0 };
    rateWindows.set(key, window);
  }
  if (window.count >= limit) return publicError(429, "RATE_LIMITED", "Too many requests. Please try again in a few minutes.", Math.ceil((window.startedAt + RATE_WINDOW_MS - now) / 1000));
  window.count += 1;
  if (rateWindows.size > 5000) {
    for (const [entry, value] of rateWindows) if (now - value.startedAt >= RATE_WINDOW_MS) rateWindows.delete(entry);
    while (rateWindows.size > 7500) rateWindows.delete(rateWindows.keys().next().value!);
  }
  return null;
}

async function readPublicBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const announcedSize = Number(request.headers.get("content-length") ?? 0);
  if (announcedSize > PUBLIC_BODY_LIMIT) throw new DomainError("VALIDATION_ERROR", "Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing request body");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > PUBLIC_BODY_LIMIT) {
      await reader.cancel();
      throw new DomainError("VALIDATION_ERROR", "Request is too large.", 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

async function findSite(slug: string, publicOnly = true): Promise<PublicSiteRow> {
  const db = getDb();
  const [row] = await db.select({ site: sites, tenant: tenants, organization: organizations })
    .from(sites).innerJoin(tenants, eq(sites.tenantId, tenants.id)).innerJoin(organizations, and(eq(sites.organizationId, organizations.id), eq(sites.tenantId, organizations.tenantId)))
    .where(and(eq(sites.slug, slug), eq(tenants.status, "active"))).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "Website not found.", 404);
  if (publicOnly && !isPubliclyAvailable(row.site)) throw new DomainError("NOT_FOUND", "Website not found.", 404);
  return row;
}

function settingsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function siteSnapshot(site: typeof sites.$inferSelect): SiteSnapshot | null {
  const stored = settingsObject(site.settings).publishedSnapshot;
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored as SiteSnapshot : null;
}

function publicTermsVersion(site: typeof sites.$inferSelect): string {
  return stringValue(siteSnapshot(site)?.termsVersion) || stringValue(settingsObject(site.settings).termsVersion) || "v1";
}

function isPubliclyAvailable(site: typeof sites.$inferSelect): boolean {
  return site.status !== "disabled" && (site.status === "published" || (site.publishedAt !== null && siteSnapshot(site) !== null));
}

function conditionForEngine(raw: unknown): Condition | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.field === "string" && typeof value.operator === "string") return raw as Condition;
  if (Array.isArray(value.all) || Array.isArray(value.any) || value.not) return raw as Condition;
  const comparisons = Object.entries(value).map(([field, target]) => ({ field, operator: "equals" as const, value: target }));
  if (comparisons.length === 0) return undefined;
  return comparisons.length === 1 ? comparisons[0] : { all: comparisons };
}

function effectForEngine(raw: unknown): PricingEffect | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const effect = raw as Record<string, unknown>;
  if (typeof effect.type === "string") return effect as PricingEffect;
  // Older seed records store a base price as { baseMinor }.
  if (Number.isSafeInteger(effect.baseMinor) && Number(effect.baseMinor) >= 0) return { type: "set_base_amount", amountMinor: Number(effect.baseMinor) };
  return null;
}

function toPriceRule(rule: typeof priceRules.$inferSelect): PriceRule | null {
  const effect = effectForEngine(rule.effects);
  if (!effect) return null;
  const source = rule.source === "core" || rule.source === "industry_pack" ? rule.source : "tenant";
  const conditions = conditionForEngine(rule.conditions);
  return {
    id: rule.id, name: rule.name, priority: rule.priority, active: rule.active, source, effect,
    ...(conditions ? { conditions } : {}),
    ...(rule.effectiveFrom ? { effectiveFrom: rule.effectiveFrom } : {}),
    ...(rule.effectiveTo ? { effectiveTo: rule.effectiveTo } : {}),
  };
}

async function listSiteServices(site: typeof sites.$inferSelect) {
  const db = getDb();
  const records = await db.select().from(services).where(and(eq(services.tenantId, site.tenantId), eq(services.active, true), or(eq(services.organizationId, site.organizationId), isNull(services.organizationId)))).orderBy(asc(services.name));
  const ruleRecords = await db.select().from(priceRules).where(and(eq(priceRules.tenantId, site.tenantId), eq(priceRules.organizationId, site.organizationId), eq(priceRules.active, true)));
  return records.filter((service) => service.serviceType !== "add_on" && service.serviceType !== "recovery").map((service) => {
    const matching = ruleRecords.filter((rule) => {
      const conditions = settingsObject(rule.conditions);
      return (conditions.serviceId === service.id || conditions.serviceKey === service.key)
        && conditions.frequency === undefined;
    }).sort((a, b) => b.priority - a.priority);
    const effect = matching[0] ? effectForEngine(matching[0].effects) : null;
    const basePriceCents = effect?.type === "set_base_amount" ? effect.amountMinor : null;
    return { id: service.id, key: service.key, name: service.name, description: service.description ?? "", serviceType: service.serviceType, basePriceCents };
  });
}

async function liveSiteContent(site: typeof sites.$inferSelect, organization: typeof organizations.$inferSelect) {
  const db = getDb();
  const [entry] = await db.select().from(siteContents).where(and(eq(siteContents.tenantId, site.tenantId), eq(siteContents.siteId, site.id), eq(siteContents.contentKey, "home"))).limit(1);
  const content = settingsObject(entry?.content);
  const branding = settingsObject(site.branding);
  const settings = settingsObject(site.settings);
  const services = await listSiteServices(site);
  const area = await serviceAreaSummary(site);
  return {
    businessName: stringValue(branding.businessName) || organization.displayName,
    tagline: stringValue(content.tagline) || stringValue(content.headline) || stringValue(branding.tagline),
    description: stringValue(content.description),
    phone: organization.phone ?? "", email: organization.email ?? "",
    serviceArea: stringValue(settings.serviceArea) || area,
    faqs: Array.isArray(content.faqs) ? content.faqs : [], services,
    termsVersion: stringValue(settings.termsVersion) || "v1",
  } satisfies SiteSnapshot;
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }

async function publicSiteView(row: PublicSiteRow): Promise<SiteSnapshot & { slug: string; template: string }> {
  const published = siteSnapshot(row.site);
  const data = published ?? await liveSiteContent(row.site, row.organization);
  const resolved = resolveTenantIndustryPack(row.tenant.industryPackKey, row.tenant.settings);
  const pack = resolved?.pack;
  const legacyHeadlines = new Set(["A cleaner yard. A better day.", "A cleaner yard, every week"]);
  const hasLegacyPackCopy = !!pack && typeof data.tagline === "string" && legacyHeadlines.has(data.tagline.trim());
  return {
    ...data,
    ...(resolved && pack ? {
      industryPackKey: pack.key,
      industryName: pack.displayName,
      terminology: pack.terminology,
      serviceLocationTerm: pack.terminology.serviceLocation,
      websiteDefaults: { headline: pack.website.heroHeadline, description: pack.website.heroDescription },
      websiteSections: pack.website.sections,
      signupBehavior: pack.website.signupBehavior ?? "review",
      industryIntake: {
        formSteps: pack.formSteps,
        locationFields: resolved.locationFields.filter((field) => field.type !== "media"),
        assets: resolved.assets.map((asset) => ({ ...asset, fields: asset.fields.filter((field) => field.type !== "media") })),
        recurrencePresets: resolved.recurrencePresets,
      },
    } : {}),
    ...(hasLegacyPackCopy && pack ? { tagline: pack.website.heroHeadline, description: pack.website.heroDescription } : {}),
    slug: row.site.slug, template: row.site.templateKey,
  };
}

async function serviceAreaSummary(site: typeof sites.$inferSelect): Promise<string> {
  const db = getDb();
  const zones = await db.select().from(serviceZones).where(and(eq(serviceZones.tenantId, site.tenantId), eq(serviceZones.organizationId, site.organizationId), eq(serviceZones.active, true))).orderBy(asc(serviceZones.pricingPriority));
  const postalCodes = zones.flatMap((zone) => {
    const definition = settingsObject(zone.definition);
    const values = definition.postalCodes ?? definition.postal_codes;
    return Array.isArray(values) ? values.filter((item): item is string => typeof item === "string") : [];
  });
  return postalCodes.length ? `ZIP codes ${[...new Set(postalCodes)].join(", ")}` : "your local community";
}

async function checkEligibility(site: typeof sites.$inferSelect, zip: string): Promise<EligibilityResult> {
  const db = getDb();
  const normalizedZip = zip.trim().toUpperCase();
  const zones = await db.select().from(serviceZones).where(and(eq(serviceZones.tenantId, site.tenantId), eq(serviceZones.organizationId, site.organizationId), eq(serviceZones.active, true))).orderBy(asc(serviceZones.pricingPriority));
  let hasPostalCoverage = false;
  for (const zone of zones) {
    const definition = settingsObject(zone.definition);
    const postalCodes = definition.postalCodes ?? definition.postal_codes ?? definition.postalCode;
    if (Array.isArray(postalCodes)) {
      hasPostalCoverage = true;
      if (postalCodes.some((item) => typeof item === "string" && item.trim().toUpperCase() === normalizedZip)) return { eligible: true, message: "Good news—we serve your area.", zoneId: zone.id };
    } else if (typeof postalCodes === "string") {
      hasPostalCoverage = true;
      if (postalCodes.trim().toUpperCase() === normalizedZip) return { eligible: true, message: "Good news—we serve your area.", zoneId: zone.id };
    }
  }
  if (hasPostalCoverage) return { eligible: false, message: "We don’t currently list this ZIP code. Send your request and our team can review it.", reason: "outside_service_area" };
  const tenant = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, site.tenantId)).limit(1);
  const configured = settingsObject(tenant[0]?.settings).servicePostalCodes;
  if (Array.isArray(configured) && configured.length) {
    const matches = configured.some((item) => typeof item === "string" && item.trim().toUpperCase() === normalizedZip);
    return matches
      ? { eligible: true, message: "Good news—we serve your area." }
      : { eligible: false, message: "We don’t currently list this ZIP code. Send your request and our team can review it.", reason: "outside_service_area" };
  }
  return { eligible: false, message: "We’ll confirm service for your address with you.", reason: "service_area_needs_review" };
}

async function loadTaxRate(site: typeof sites.$inferSelect, service: typeof services.$inferSelect, context: Record<string, unknown>): Promise<number> {
  if (!service.taxable) return 0;
  const rules = await getDb().select().from(taxRules).where(and(eq(taxRules.tenantId, site.tenantId), eq(taxRules.active, true)));
  const matching = rules.filter((rule) => {
    if (rule.organizationLocationId && rule.organizationLocationId !== site.organizationLocationId) return false;
    const condition = conditionForEngine(rule.conditions);
    return evaluateConditions(condition, { current: context, now: new Date().toISOString() });
  }).sort((a, b) => b.priority - a.priority);
  return Math.max(0, Math.min(100_000, matching[0]?.rateBasisPoints ?? 0));
}

function camelFieldKey(key: string): string { return key.replace(/[-_]([a-z0-9])/g, (_, char: string) => char.toUpperCase()); }

function pricingFields(resolved: ReturnType<typeof resolveTenantIndustryPack>, intake: ReturnType<typeof validatePackIntakeValues>, requestDetails: string): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...intake.location, requestDetails };
  for (const [key, value] of Object.entries(intake.location)) fields[camelFieldKey(key)] = value;
  let assetCount = 0;
  for (const [assetKey, rows] of Object.entries(intake.assets)) {
    fields[`${camelFieldKey(assetKey)}Count`] = rows.length;
    const definition = resolved?.assets.find((asset) => asset.key === assetKey);
    if (definition) fields[definition.pluralLabel.replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase()).replace(/^[A-Z]/, (char) => char.toLowerCase())] = rows.length;
    assetCount += rows.length;
    for (const [index, asset] of rows.entries()) for (const [fieldKey, value] of Object.entries(asset)) {
      fields[`${camelFieldKey(assetKey)}.${camelFieldKey(fieldKey)}`] = value;
      if (index === 0 && !(camelFieldKey(fieldKey) in fields)) fields[camelFieldKey(fieldKey)] = value;
    }
  }
  fields.assetCount = assetCount;
  return fields;
}

function parsePackIntake(row: PublicSiteRow, raw: unknown) {
  const resolved = resolveTenantIndustryPack(row.tenant.industryPackKey, row.tenant.settings);
  if (!resolved) return { resolved: undefined, intake: { location: {}, assets: {}, sensitive: { location: {}, assets: {} } } };
  try { return { resolved, intake: validatePackIntakeValues(resolved, raw ?? { location: {}, assets: {} }) }; }
  catch (error) { throw new DomainError("VALIDATION_ERROR", error instanceof Error ? error.message : "Check the industry-specific service details.", 422); }
}

async function calculatePublicQuote(row: PublicSiteRow, input: z.infer<typeof quoteSchema>) {
  const site = row.site;
  const { intake, resolved } = parsePackIntake(row, input.industryData);
  const db = getDb();
  const [service] = await db.select().from(services).where(and(
    eq(services.tenantId, site.tenantId), eq(services.active, true),
    or(eq(services.organizationId, site.organizationId), isNull(services.organizationId)),
    z.uuid().safeParse(input.serviceId).success ? eq(services.id, input.serviceId) : eq(services.key, input.serviceKey ?? input.serviceId),
  )).limit(1);
  if (!service || service.serviceType === "add_on" || service.serviceType === "recovery") throw new DomainError("VALIDATION_ERROR", "Choose an available service.", 422);
  const eligibility = await checkEligibility(site, input.zip);
  const tenantRow = await db.select({ defaultCurrency: tenants.defaultCurrency }).from(tenants).where(eq(tenants.id, site.tenantId)).limit(1);
  const currency = tenantRow[0]?.defaultCurrency || "USD";
  const zoneId = eligibility.zoneId;
  const context = {
    tenantId: site.tenantId, currency, at: new Date().toISOString(), serviceId: service.id, serviceKey: service.key,
    frequency: input.frequency, quantity: Math.max(1, Object.values(intake.assets).reduce((sum, rows) => sum + rows.length, 0)), zoneId,
    fields: pricingFields(resolved, intake, input.requestDetails ?? ""),
    postalCode: input.zip,
  };
  const dbRules = await db.select().from(priceRules).where(and(eq(priceRules.tenantId, site.tenantId), eq(priceRules.organizationId, site.organizationId), eq(priceRules.active, true)));
  const rules = dbRules.map(toPriceRule).filter((rule): rule is PriceRule => !!rule);
  const rateBps = await loadTaxRate(site, service, context);
  let result: PriceResult;
  try {
    result = evaluatePrice({ context, rules, tax: { rateBps } });
  } catch {
    // A malformed or unresolved price rule must go to the team for review.
    result = evaluatePrice({ context, rules: [], tax: { rateBps } });
  }
  const quoteRequired = !eligibility.eligible || result.quoteRequired;
  const warnings = [...result.warnings, ...(eligibility.eligible ? [] : [eligibility.reason ?? "service_area_needs_review"] )];
  const quoteId = createHmac("sha256", authSigningSecret()).update(JSON.stringify({
    siteId: site.id, serviceId: service.id, frequency: input.frequency, zip: input.zip.trim().toUpperCase(),
    intake, requestDetails: input.requestDetails ?? "", total: result.totalMinor,
    quoteRequired, rules: result.appliedRules.map((rule) => rule.ruleId),
  })).digest("hex").slice(0, 40);
  return {
    service, eligibility, quoteRequired, quoteId, result, warnings,
    item: {
      id: quoteId, amountCents: quoteRequired ? null : result.totalMinor, subtotalCents: result.subtotalMinor,
      taxCents: result.taxMinor, currency, quoteRequired, warnings,
      message: quoteRequired ? (eligibility.eligible ? "Our team will review your details and confirm a price." : eligibility.message) : "Your configured service price is ready.",
      intervalLabel: input.frequency === "one_time" ? "One-time service" : `${input.frequency.replaceAll("_", " ")} service`,
      appliedRules: result.appliedRules,
    },
  };
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

function requestIp(request: Request): string | null {
  const raw = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim();
  return raw ? raw.slice(0, 80) : null;
}

async function ensureForm(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], site: typeof sites.$inferSelect, formType: "contact" | "signup", pack?: NonNullable<ReturnType<typeof resolveTenantIndustryPack>>["pack"]) {
  const [existing] = await tx.select().from(siteForms).where(and(eq(siteForms.tenantId, site.tenantId), eq(siteForms.siteId, site.id), eq(siteForms.formType, formType), eq(siteForms.active, true))).limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(siteForms).values({
    tenantId: site.tenantId, siteId: site.id, formType, name: formType === "signup" ? "Service signup" : "Contact us",
    schema: formType === "signup" ? { fields: ["address", "contact", "service", "industryData", "termsAccepted"], industryPackKey: pack?.key, industryPackVersion: pack?.version } : { fields: ["name", "email", "phone", "message"] },
    behavior: { create: formType === "signup" ? "lead_or_customer" : "lead" }, active: true,
  }).returning();
  if (!created) throw new Error("Could not prepare the website form.");
  return created;
}

async function recordPublicEvent(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], input: {
  tenantId: string; organizationId: string; type: string; entityType: string; entityId: string;
  payload?: Record<string, unknown>; auditAction?: string; ipAddress?: string | null; userAgent?: string | null;
}) {
  await tx.insert(domainEvents).values({ tenantId: input.tenantId, eventType: input.type, actorType: "public", actorId: null, entityType: input.entityType, entityId: input.entityId, organizationId: input.organizationId, payload: input.payload ?? {} });
  if (input.auditAction) await tx.insert(auditEvents).values({ tenantId: input.tenantId, actorType: "public", actorId: null, action: input.auditAction, entityType: input.entityType, entityId: input.entityId, ipAddress: input.ipAddress ?? null, userAgent: input.userAgent ?? null, afterData: input.payload ?? {} });
}

async function ensureServiceTerms(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], tenantId: string, version: string) {
  let [terms] = await tx.select().from(termsVersions).where(and(eq(termsVersions.tenantId, tenantId), eq(termsVersions.documentType, "service"), eq(termsVersions.version, version))).limit(1);
  if (terms) return terms;
  const [created] = await tx.insert(termsVersions).values({ tenantId, documentType: "service", version, content: DEFAULT_SERVICE_TERMS_CONTENT, effectiveAt: new Date(), active: true })
    .onConflictDoNothing({ target: [termsVersions.tenantId, termsVersions.documentType, termsVersions.version] }).returning();
  if (created) return created;
  [terms] = await tx.select().from(termsVersions).where(and(eq(termsVersions.tenantId, tenantId), eq(termsVersions.documentType, "service"), eq(termsVersions.version, version))).limit(1);
  if (!terms) throw new Error("Could not record the service-terms version.");
  return terms;
}

function normalizeAddressLine(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, " "); }
function normalizePostalCode(value: string): string { return value.trim().toUpperCase().replace(/\s+/g, ""); }

async function hasExistingCustomerMatch(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], tenantId: string, input: z.infer<typeof signupSchema>): Promise<boolean> {
  const normalizedEmail = input.contact.email.trim().toLowerCase();
  const normalizedAddress = normalizeAddressLine(input.address);
  const normalizedZip = normalizePostalCode(input.zip);
  const matchesBillingAddress = and(
    sql`lower(regexp_replace(trim(coalesce(${customers.billingAddress} ->> 'line1', '')), '\\s+', ' ', 'g')) = ${normalizedAddress}`,
    sql`upper(regexp_replace(trim(coalesce(${customers.billingAddress} ->> 'postalCode', '')), '\\s+', '', 'g')) = ${normalizedZip}`,
  );
  const matchesServiceAddress = and(
    sql`lower(regexp_replace(trim(coalesce(${serviceLocations.addressLine1}, '')), '\\s+', ' ', 'g')) = ${normalizedAddress}`,
    sql`upper(regexp_replace(trim(coalesce(${serviceLocations.postalCode}, '')), '\\s+', '', 'g')) = ${normalizedZip}`,
  );
  const [match] = await tx.select({ id: customers.id }).from(customers)
    .leftJoin(customerContacts, and(eq(customerContacts.tenantId, customers.tenantId), eq(customerContacts.customerId, customers.id), eq(customerContacts.active, true)))
    .leftJoin(serviceLocations, and(eq(serviceLocations.tenantId, customers.tenantId), eq(serviceLocations.customerId, customers.id)))
    .where(and(eq(customers.tenantId, tenantId), or(
      sql`lower(trim(coalesce(${customers.billingEmail}, ''))) = ${normalizedEmail}`,
      sql`lower(trim(coalesce(${customerContacts.email}, ''))) = ${normalizedEmail}`,
      matchesBillingAddress,
      matchesServiceAddress,
    ))).limit(1);
  return !!match;
}

function sanitizedSubmission(input: z.infer<typeof signupSchema>, intake: ReturnType<typeof validatePackIntakeValues>, visible = { location: intake.location, assets: intake.assets }) {
  return {
    address: input.address, zip: input.zip, contact: input.contact, service: input.service,
    industryData: visible,
    industryDataFingerprint: createHmac("sha256", authSigningSecret()).update(JSON.stringify(intake)).digest("hex"),
    requestDetails: input.requestDetails,
    preferredDay: input.preferredDay, quoteId: input.quoteId, paymentMethod: input.paymentMethod,
    notificationPreferences: input.notificationPreferences, termsAccepted: true, termsVersion: input.termsVersion,
  };
}

function splitPackIntakeForStorage(resolved: ReturnType<typeof resolveTenantIndustryPack>, intake: ReturnType<typeof validatePackIntakeValues>) {
  const visibleAssets: Record<string, Array<Record<string, unknown>>> = {};
  const assetRecords: Record<string, Array<{ id: string; name: string; customFields: Record<string, unknown> }>> = {};
  const hiddenAssets: Record<string, Record<string, unknown>> = {};
  if (resolved) for (const [assetKey, rows] of Object.entries(intake.assets)) {
    const definition = resolved.assets.find((asset) => asset.key === assetKey);
    if (!definition) continue;
    const values: Record<string, unknown>[] = [];
    const records: Array<{ id: string; name: string; customFields: Record<string, unknown> }> = [];
    for (const [index, row] of rows.entries()) {
      const id = randomUUID();
      const visible: Record<string, unknown> = {};
      const hidden: Record<string, unknown> = { ...(intake.sensitive.assets[assetKey]?.[index] ?? {}) };
      for (const [fieldKey, value] of Object.entries(row)) {
        const field = definition.fields.find((item) => item.key === fieldKey);
        if (field?.sensitive || field?.customerVisible === false) hidden[fieldKey] = value;
        else visible[fieldKey] = value;
      }
      if (Object.keys(hidden).length) hiddenAssets[id] = hidden;
      const name = typeof visible.name === "string" && visible.name.trim() ? visible.name : `${definition.label} ${index + 1}`;
      values.push(visible);
      records.push({ id, name, customFields: visible });
    }
    if (values.length) { visibleAssets[assetKey] = values; assetRecords[assetKey] = records; }
  }
  return {
    visible: { location: intake.location, assets: visibleAssets },
    assetRecords,
    encrypted: { location: intake.sensitive.location, assets: hiddenAssets },
  };
}

function duplicateSignupResult(submission: typeof siteSubmissions.$inferSelect) {
  if (submission.customerId) return { item: { id: submission.customerId, kind: "customer", status: "active", message: "Your service plan is set up. Contact the business if you need help accessing a customer account." } };
  return { item: { id: submission.leadId ?? submission.id, kind: "lead", status: "review", message: "Thanks, we’ve received your request. Our team will review it and be in touch." } };
}

async function saveContact(request: Request, site: typeof sites.$inferSelect, input: z.infer<typeof contactSchema>): Promise<Response> {
  const hash = createHash("sha256").update(JSON.stringify({
    ip: remoteIp(request), email: input.email.trim().toLowerCase(), name: input.name.trim(), phone: input.phone.trim(), message: input.message.trim(),
  })).digest("hex");
  const idempotencyKey = request.headers.get("idempotency-key")?.trim().slice(0, 200) || `contact:${hash}`;
  const db = getDb();
  const response = await db.transaction(async (tx) => {
    const form = await ensureForm(tx, site, "contact");
    const [submission] = await tx.insert(siteSubmissions).values({
      tenantId: site.tenantId, siteId: site.id, siteFormId: form.id, idempotencyKey,
      payload: { name: input.name, email: input.email, phone: input.phone, message: input.message }, status: "processing",
    }).onConflictDoNothing({ target: [siteSubmissions.siteId, siteSubmissions.idempotencyKey] }).returning();
    if (!submission) {
      const [prior] = await tx.select().from(siteSubmissions).where(and(eq(siteSubmissions.siteId, site.id), eq(siteSubmissions.idempotencyKey, idempotencyKey))).limit(1);
      if (prior && !isDeepStrictEqual(prior.payload, { name: input.name, email: input.email, phone: input.phone, message: input.message })) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This contact request key was already used for different information.", 409);
      }
      return { duplicate: prior };
    }
    const { firstName, lastName } = splitName(input.name);
    const [lead] = await tx.insert(leads).values({
      tenantId: site.tenantId, organizationId: site.organizationId, owningLocationId: site.organizationLocationId,
      status: "new", firstName, lastName, email: input.email.trim().toLowerCase(), phone: input.phone || null,
      sourceDetail: "Website contact form", customFields: { websiteMessage: input.message },
    }).returning();
    if (!lead) throw new Error("Could not record the contact request.");
    await tx.update(siteSubmissions).set({ leadId: lead.id, status: "processed", processedAt: new Date() }).where(eq(siteSubmissions.id, submission.id));
    await recordPublicEvent(tx, { tenantId: site.tenantId, organizationId: site.organizationId, type: "site_submission.created", entityType: "site_submission", entityId: submission.id, payload: { formType: "contact", leadId: lead.id }, auditAction: "site_submission.contact", ipAddress: requestIp(request), userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
    await recordPublicEvent(tx, { tenantId: site.tenantId, organizationId: site.organizationId, type: "lead.created", entityType: "lead", entityId: lead.id, payload: { source: "website_contact", siteId: site.id }, auditAction: "lead.create", ipAddress: requestIp(request), userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
    return { duplicate: null, item: { id: lead.id, kind: "lead", status: "new" } };
  });
  return json({ item: response.duplicate ? { id: response.duplicate.leadId ?? response.duplicate.id, kind: "lead", status: "received" } : response.item }, response.duplicate ? 200 : 201);
}

async function createSignup(request: Request, row: PublicSiteRow, input: z.infer<typeof signupSchema>): Promise<Response> {
  const db = getDb();
  const { resolved, intake } = parsePackIntake(row, input.industryData);
  const pack = resolved?.pack;
  const serviceFilter = z.uuid().safeParse(input.service.id).success
    ? eq(services.id, input.service.id)
    : eq(services.key, input.service.key ?? input.service.id);
  const [requestedService] = await db.select({ id: services.id, key: services.key, serviceType: services.serviceType }).from(services).where(and(
    eq(services.tenantId, row.site.tenantId), eq(services.active, true),
    or(eq(services.organizationId, row.site.organizationId), isNull(services.organizationId)), serviceFilter,
  )).limit(1);
  if (!requestedService || requestedService.serviceType === "add_on" || requestedService.serviceType === "recovery"
    || (input.service.key !== undefined && input.service.key !== requestedService.key)) {
    throw new DomainError("VALIDATION_ERROR", "Choose an available service.", 422);
  }
  const oneTime = input.service.frequency === "one_time" || requestedService.serviceType === "one_time";
  const selectedPreset = resolved?.recurrencePresets.find((preset) => preset.key === input.service.frequency);
  if (!oneTime && resolved && !selectedPreset) throw new DomainError("VALIDATION_ERROR", "Choose an available service schedule.", 422);
  if (requestedService.serviceType === "one_time" && input.service.frequency !== "one_time") throw new DomainError("VALIDATION_ERROR", "This service is scheduled as a one-time visit.", 422);
  const recurrence = selectedPreset && resolved ? recurrencePresetSchedule(resolved, selectedPreset.key) ?? null : null;
  const termsVersion = publicTermsVersion(row.site);
  const quoteInput = {
    slug: input.slug, address: input.address, zip: input.zip,
    serviceId: input.service.id, serviceKey: input.service.key, frequency: input.service.frequency,
    industryData: input.industryData, preferredDay: input.preferredDay, requestDetails: input.requestDetails,
  };
  let quote: Awaited<ReturnType<typeof calculatePublicQuote>> | null = null;
  try { quote = await calculatePublicQuote(row, quoteSchema.parse(quoteInput)); } catch { quote = null; }
  const confident = !!quote && quote.eligibility.eligible && !quote.quoteRequired && !!input.quoteId && input.quoteId === quote.quoteId;
  const recurring = !oneTime && quote?.service.serviceType !== "one_time";
  const recurringEnabled = recurring && hasUsableFeature(await loadTenantCapabilities(db, row.site.tenantId), "recurring_service_management");
  const paymentMode = stringValue(settingsObject(row.tenant.settings).paymentMode) || stringValue(settingsObject(settingsObject(row.tenant.settings).onboarding).paymentMode) || "demo";
  // A request-provided demo method cannot stand in for a provider the business has not connected.
  // Industry packs may request activation, but unsupported or custom schedules still require office review.
  const canAutoActivate = pack?.website.signupBehavior === "activate_recurring" && !!recurrence && confident && recurringEnabled && paymentMode !== "connect";
  const storedIntake = splitPackIntakeForStorage(resolved, intake);
  const hasSensitiveData = Object.keys(storedIntake.encrypted.location).length > 0 || Object.keys(storedIntake.encrypted.assets).length > 0;
  const detailsToEncrypt = hasSensitiveData ? JSON.stringify({ kind: "industry_intake", ...storedIntake.encrypted }) : "";
  const encryptedAccess = encryptServiceAccessInstructions(detailsToEncrypt);
  const idempotencyKey = `signup:${input.idempotencyKey}`;
  const response = await db.transaction(async (tx) => {
    const form = await ensureForm(tx, row.site, "signup", pack);
    const [createdSubmission] = await tx.insert(siteSubmissions).values({
      tenantId: row.site.tenantId, siteId: row.site.id, siteFormId: form.id, idempotencyKey,
      payload: sanitizedSubmission(input, intake, storedIntake.visible), status: "processing",
    }).onConflictDoNothing({ target: [siteSubmissions.siteId, siteSubmissions.idempotencyKey] }).returning();
    if (!createdSubmission) {
      const [prior] = await tx.select().from(siteSubmissions).where(and(eq(siteSubmissions.siteId, row.site.id), eq(siteSubmissions.idempotencyKey, idempotencyKey))).limit(1);
      if (!prior) throw new Error("Could not load the prior signup request.");
      if (!isDeepStrictEqual(prior.payload, sanitizedSubmission(input, intake, storedIntake.visible))) throw new DomainError("IDEMPOTENCY_CONFLICT", "This signup request key was already used for different information.", 409);
      return { duplicate: prior };
    }

    const existingCustomerMatch = canAutoActivate && await hasExistingCustomerMatch(tx, row.site.tenantId, input);
    if (canAutoActivate && !existingCustomerMatch && quote) {
      const { firstName, lastName } = splitName(input.contact.name);
      const [customer] = await tx.insert(customers).values({
        tenantId: row.site.tenantId, organizationId: row.site.organizationId, owningLocationId: row.site.organizationLocationId,
        customerType: "residential", status: "active", displayName: input.contact.name.trim(), billingEmail: input.contact.email.trim().toLowerCase(),
        billingPhone: input.contact.phone.trim(), billingAddress: { line1: input.address.trim(), postalCode: input.zip.trim(), countryCode: "US" }, defaultCurrency: quote.result.currency,
        customFields: { source: "website_signup" },
      }).returning();
      if (!customer) throw new Error("Could not set up the customer record.");
      const [contact] = await tx.insert(customerContacts).values({ tenantId: row.site.tenantId, customerId: customer.id, firstName, lastName, email: input.contact.email.trim().toLowerCase(), phone: input.contact.phone.trim(), role: "primary", isPrimary: true, billingContact: true, serviceContact: true }).returning();
      if (!contact) throw new Error("Could not save the customer contact.");
      const [location] = await tx.insert(serviceLocations).values({
        tenantId: row.site.tenantId, customerId: customer.id, organizationLocationId: row.site.organizationLocationId,
        name: "Service address", addressLine1: input.address.trim(), addressLine2: null, city: "", region: "", postalCode: input.zip.trim(), countryCode: "US",
        serviceZoneId: quote.eligibility.zoneId ?? null, accessInstructionsEncrypted: encryptedAccess,
        customFields: { ...storedIntake.visible.location, preferredDay: input.preferredDay || "", industryPackKey: pack?.key ?? null, industryPackVersion: pack?.version ?? null },
      }).returning();
      if (!location) throw new Error("Could not save the service address.");
      const assetValues = Object.entries(storedIntake.assetRecords).flatMap(([assetTypeKey, assets]) => assets.map((asset) => ({
        id: asset.id, tenantId: row.site.tenantId, customerId: customer.id, serviceLocationId: location.id,
        assetTypeKey, name: asset.name, status: "active", customerVisible: true, customFields: asset.customFields,
      })));
      if (assetValues.length) await tx.insert(customerAssets).values(assetValues);
      await tx.insert(notificationPreferences).values({ tenantId: row.site.tenantId, customerId: customer.id, eventKey: "general", emailEnabled: input.notificationPreferences.email, smsEnabled: input.notificationPreferences.sms }).onConflictDoNothing();
      for (const channel of ["email", "sms"] as const) await tx.insert(consentRecords).values({
        tenantId: row.site.tenantId, customerId: customer.id, channel, category: "transactional",
        state: input.notificationPreferences[channel] ? "opted_in" : "opted_out", source: "website_signup",
        actorType: "public", evidence: { statement: DEFAULT_SERVICE_TERMS_CONTENT, termsVersion },
      });
      const terms = await ensureServiceTerms(tx, row.site.tenantId, termsVersion);
      await tx.insert(termsAcceptances).values({ tenantId: row.site.tenantId, termsVersionId: terms.id, actorType: "public", actorId: null, relatedEntityType: "customer", relatedEntityId: customer.id, ipAddress: requestIp(request), userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });

      let paymentInstallationId: string | null = null;
      if (input.paymentMethod === "demo" && paymentMode === "demo") {
        let [installation] = await tx.select().from(connectorInstallations).where(and(eq(connectorInstallations.tenantId, row.site.tenantId), eq(connectorInstallations.connectorKey, "mock-payments"), eq(connectorInstallations.providerAccountId, "local-demo"))).limit(1);
        if (!installation) [installation] = await tx.insert(connectorInstallations).values({ tenantId: row.site.tenantId, organizationId: row.site.organizationId, connectorKey: "mock-payments", status: "connected", displayName: "Demo payments", providerAccountId: "local-demo", settings: { mode: "test" } }).onConflictDoNothing().returning();
        if (!installation) [installation] = await tx.select().from(connectorInstallations).where(and(eq(connectorInstallations.tenantId, row.site.tenantId), eq(connectorInstallations.connectorKey, "mock-payments"), eq(connectorInstallations.providerAccountId, "local-demo"))).limit(1);
        paymentInstallationId = installation?.id ?? null;
        if (!paymentInstallationId) throw new Error("Demo payments could not be prepared.");
        // References only: this path does not collect or retain card data and never creates a charge.
        await tx.insert(paymentMethodReferences).values({ tenantId: row.site.tenantId, customerId: customer.id, connectorInstallationId: paymentInstallationId, providerCustomerRef: `demo-customer:${customer.id}`, providerMethodRef: `demo-method:${createdSubmission.id}`, methodType: "demo", brand: "Demo", isDefault: true, status: "active" });
      }

      const [recurrenceRule] = await tx.insert(recurrenceRules).values({ tenantId: row.site.tenantId, frequencyType: recurrence!.frequencyType, interval: recurrence!.interval, daysOfWeek: recurrence!.daysOfWeek, timezone: row.organization.timezone || row.tenant.defaultTimezone, configuration: { publicSignupFrequency: input.service.frequency, rrule: selectedPreset?.rrule, industryPackKey: pack?.key, industryPackVersion: pack?.version } }).returning();
      if (!recurrenceRule) throw new Error("Could not prepare the service schedule.");
      const snapshot = snapshotPriceResult(quote.result, new Date().toISOString());
      const [plan] = await tx.insert(servicePlans).values({
        tenantId: row.site.tenantId, customerId: customer.id, serviceLocationId: location.id, organizationLocationId: row.site.organizationLocationId,
        serviceId: quote.service.id, recurrenceRuleId: recurrenceRule.id, status: "active", effectiveFrom: new Date().toISOString().slice(0, 10),
        pricingSnapshot: snapshot as unknown as Record<string, unknown>, billingConfiguration: { type: paymentMode === "manual" ? "manual_invoice" : "per_job", demoPaymentMethod: input.paymentMethod === "demo" },
        preferredAssignment: input.preferredDay ? { preferredDay: input.preferredDay } : {},
        customFields: { source: "website_signup", industryPackKey: pack?.key ?? null, industryPackVersion: pack?.version ?? null, industryData: storedIntake.visible },
      }).returning();
      if (!plan) throw new Error("Could not create the service plan.");
      await tx.update(siteSubmissions).set({ customerId: customer.id, status: "processed", processedAt: new Date() }).where(eq(siteSubmissions.id, createdSubmission.id));
      await recordPublicEvent(tx, { tenantId: row.site.tenantId, organizationId: row.site.organizationId, type: "site_submission.created", entityType: "site_submission", entityId: createdSubmission.id, payload: { formType: "signup", kind: "customer", customerId: customer.id, servicePlanId: plan.id }, auditAction: "site_submission.signup", ipAddress: requestIp(request), userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
      await recordPublicEvent(tx, { tenantId: row.site.tenantId, organizationId: row.site.organizationId, type: "customer.created", entityType: "customer", entityId: customer.id, payload: { source: "website_signup", servicePlanId: plan.id }, auditAction: "customer.create", ipAddress: requestIp(request), userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
      await recordPublicEvent(tx, { tenantId: row.site.tenantId, organizationId: row.site.organizationId, type: "service_plan.created", entityType: "service_plan", entityId: plan.id, payload: { source: "website_signup", customerId: customer.id, serviceId: quote.service.id }, auditAction: "service_plan.create", ipAddress: requestIp(request), userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
      return { duplicate: null, item: { id: customer.id, kind: "customer", status: "active", servicePlanId: plan.id, message: "Your service plan is set up. Contact the business if you need help accessing a customer account." } };
    }

    const { firstName, lastName } = splitName(input.contact.name);
    const reviewReason = existingCustomerMatch ? "existing_customer_review" : !quote ? "price_unavailable" : !quote.eligibility.eligible ? quote.eligibility.reason : quote.result.quoteRequired ? "quote_required" : !input.quoteId ? "quote_not_confirmed" : oneTime ? "one_time_service_needs_scheduling" : !recurringEnabled ? "recurring_capability_unavailable" : !recurrence ? "recurrence_needs_review" : paymentMode === "connect" ? "payment_setup_required" : "review_required";
    const [lead] = await tx.insert(leads).values({
      tenantId: row.site.tenantId, organizationId: row.site.organizationId, owningLocationId: row.site.organizationLocationId,
      status: "new", firstName, lastName, email: input.contact.email.trim().toLowerCase(), phone: input.contact.phone.trim(),
      address: { line1: input.address.trim(), postalCode: input.zip.trim(), countryCode: "US" },
      estimatedValueMinor: quote?.result.totalMinor ? BigInt(quote.result.totalMinor) : null,
      currency: quote?.result.currency ?? row.tenant.defaultCurrency,
      sourceDetail: "Website signup", customFields: {
        websiteSignup: {
          serviceKey: input.service.key ?? input.service.id, frequency: input.service.frequency,
          industryPackKey: pack?.key ?? null, industryPackVersion: pack?.version ?? null,
          industryData: storedIntake.visible, requestDetails: input.requestDetails ?? "",
          ...(encryptedAccess ? { accessInstructionsEncrypted: encryptedAccess } : {}),
          preferredDay: input.preferredDay, quoteId: input.quoteId ?? null,
          quoteRequired: quote?.quoteRequired ?? true, reviewReason,
        },
        ...(encryptedAccess ? { accessInstructionsEncrypted: encryptedAccess } : {}),
      },
    }).returning();
    if (!lead) throw new Error("Could not save your service request.");
    const terms = await ensureServiceTerms(tx, row.site.tenantId, termsVersion);
    await tx.insert(termsAcceptances).values({ tenantId: row.site.tenantId, termsVersionId: terms.id, actorType: "public", actorId: null, relatedEntityType: "lead", relatedEntityId: lead.id, ipAddress: requestIp(request), userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
    await tx.update(siteSubmissions).set({ leadId: lead.id, status: "processed", processedAt: new Date() }).where(eq(siteSubmissions.id, createdSubmission.id));
    await recordPublicEvent(tx, { tenantId: row.site.tenantId, organizationId: row.site.organizationId, type: "site_submission.created", entityType: "site_submission", entityId: createdSubmission.id, payload: { formType: "signup", kind: "lead", leadId: lead.id, reviewReason }, auditAction: "site_submission.signup", ipAddress: requestIp(request), userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
    await recordPublicEvent(tx, { tenantId: row.site.tenantId, organizationId: row.site.organizationId, type: "lead.created", entityType: "lead", entityId: lead.id, payload: { source: "website_signup", reviewReason }, auditAction: "lead.create", ipAddress: requestIp(request), userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
    return { duplicate: null, item: { id: lead.id, kind: "lead", status: "review", reason: reviewReason, message: "Thanks, we’ve received your request. Our team will review it and be in touch." } };
  });
  if (response.duplicate) return json(duplicateSignupResult(response.duplicate));
  return json({ item: response.item }, 201);
}

/** Handles the public, slug-scoped website APIs. Tenant identity always comes from the site slug. */
export async function handlePublicSite(request: Request, path: string[]): Promise<Response | null> {
  if (path[0] !== "public") return null;
  const action = path[1];
  if (action === "site") {
    if (request.method !== "GET") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    const slug = slugSchema.parse(new URL(request.url).searchParams.get("slug"));
    const limited = rateLimit(request, slug, "site", 120);
    if (limited) return limited;
    const row = await findSite(slug, true);
    await requireTenantFeature(row.site.tenantId, "website_publishing");
    return json({ item: await publicSiteView(row) });
  }
  if (action === "eligibility") {
    if (request.method !== "POST") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    const input = await readPublicBody(request, eligibilitySchema);
    const limited = rateLimit(request, input.slug, "eligibility", 40);
    if (limited) return limited;
    const row = await findSite(input.slug, true);
    await requireTenantFeature(row.site.tenantId, "online_booking");
    return json({ item: await checkEligibility(row.site, input.zip) });
  }
  if (action === "quote") {
    if (request.method !== "POST") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    const input = await readPublicBody(request, quoteSchema);
    const limited = rateLimit(request, input.slug, "quote", 40);
    if (limited) return limited;
    const row = await findSite(input.slug, true);
    await requireTenantFeature(row.site.tenantId, "online_booking");
    const quote = await calculatePublicQuote(row, input);
    return json({ item: quote.item });
  }
  if (action === "contact") {
    if (request.method !== "POST") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    const input = await readPublicBody(request, contactSchema);
    const limited = rateLimit(request, input.slug, "contact", 10);
    if (limited) return limited;
    const row = await findSite(input.slug, true);
    await requireTenantFeature(row.site.tenantId, "website_publishing");
    return saveContact(request, row.site, input);
  }
  if (action === "signup") {
    if (request.method !== "POST") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    const input = await readPublicBody(request, signupSchema);
    const limited = rateLimit(request, input.slug, "signup", 10);
    if (limited) return limited;
    const row = await findSite(input.slug, true);
    await requireTenantFeature(row.site.tenantId, "online_booking");
    if (input.termsVersion !== publicTermsVersion(row.site)) throw new DomainError("CONFLICT", "Service terms have changed. Refresh the website before sending your request.", 409);
    return createSignup(request, row, input);
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
