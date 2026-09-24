import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  franchiseAgreements, organizationLocations, organizations, royaltyRules, royaltyStatements,
  type Database,
} from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody, requireMethod } from "./http";
import { normalized } from "./sql";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MILLISECONDS = 86_400_000;

function isCalendarDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year! < 1000 || year! > 9998) return false;
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

const dateSchema = z.string().refine(isCalendarDate, "Enter a valid date in YYYY-MM-DD format.");
const agreementIdSchema = z.string().uuid();

const royaltyRuleBodySchema = z.object({
  ruleType: z.literal("percentage"),
  definition: z.object({
    basis: z.literal("invoiced_revenue"),
    rateBasisPoints: z.number().int().min(1).max(10_000),
  }).strict(),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
}).strict();

const royaltyPeriodBodySchema = z.object({
  periodStart: dateSchema,
  periodEnd: dateSchema,
}).strict();

const agreementBodySchema = z.object({
  childOrganizationId: z.string().uuid(),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
}).strict();

const countryCodeSchema = z.string().trim().length(2).transform((value) => value.toUpperCase());
const currencySchema = z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase());
const locationBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(32).optional(),
  addressLine1: z.string().trim().max(160).optional(),
  addressLine2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(30).optional(),
  countryCode: countryCodeSchema.optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.email().optional().or(z.literal("")),
}).strict();

const unitBodySchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  legalName: z.string().trim().min(2).max(160).optional(),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  currency: currencySchema.optional(),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
  location: locationBodySchema,
}).strict();

type RoyaltyRuleInput = z.infer<typeof royaltyRuleBodySchema>;
export type RoyaltyPeriod = z.infer<typeof royaltyPeriodBodySchema>;

type ParentAgreement = {
  agreement: typeof franchiseAgreements.$inferSelect;
  childCurrency: string;
  childParentOrganizationId: string | null;
};

type InvoiceActivity = {
  id: string;
  organization_location_id: string | null;
  issued_at: Date | string;
  total_minor: bigint | number | string;
  currency: string;
};

/** Uses integer arithmetic and round-half-up so statements never depend on floating-point behavior. */
export function calculateRoyaltyAmountMinor(basisAmountMinor: bigint, rateBasisPoints: number): bigint {
  if (basisAmountMinor < 0n || !Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 1 || rateBasisPoints > 10_000) {
    throw new DomainError("VALIDATION_ERROR", "The royalty basis or percentage is invalid.", 422);
  }
  return (basisAmountMinor * BigInt(rateBasisPoints) + 5_000n) / 10_000n;
}

export function parseRoyaltyPeriod(period: RoyaltyPeriod): { startAt: Date; endExclusiveAt: Date } {
  if (!isCalendarDate(period.periodStart) || !isCalendarDate(period.periodEnd) || period.periodEnd < period.periodStart) {
    throw new DomainError("VALIDATION_ERROR", "Enter a valid period with an end date on or after its start date.", 422);
  }
  const startAt = new Date(`${period.periodStart}T00:00:00.000Z`);
  const endAt = new Date(`${period.periodEnd}T00:00:00.000Z`);
  const spanDays = (endAt.getTime() - startAt.getTime()) / DAY_MILLISECONDS + 1;
  if (!Number.isFinite(spanDays) || spanDays > 366) {
    throw new DomainError("VALIDATION_ERROR", "A royalty statement period cannot exceed 366 days.", 422);
  }
  endAt.setUTCDate(endAt.getUTCDate() + 1);
  return { startAt, endExclusiveAt: endAt };
}

/** The period query is deliberately limited to the agreement's child organization and its own locations. */
export function buildInvoiceActivityQuery(tenantId: string, childOrganizationId: string, startAt: Date, endExclusiveAt: Date): SQL {
  return sql`SELECT i.id, i.organization_location_id, i.issued_at, i.total_minor::text AS total_minor, i.currency
    FROM invoices i
    WHERE i.tenant_id = ${tenantId}
      AND i.organization_id = ${childOrganizationId}
      AND i.issued_at IS NOT NULL
      AND i.issued_at >= ${startAt}
      AND i.issued_at < ${endExclusiveAt}
      AND i.status NOT IN ('draft', 'void')
      AND i.voided_at IS NULL
      AND (
        i.organization_location_id IS NULL
        OR EXISTS (
          SELECT 1 FROM organization_locations l
          WHERE l.id = i.organization_location_id
            AND l.tenant_id = i.tenant_id
            AND l.organization_id = i.organization_id
        )
      )
    ORDER BY i.issued_at, i.id`;
}

export function isDirectParentAgreementScope(actor: SessionActor, scope: {
  tenantId: string;
  parentOrganizationId: string;
  childParentOrganizationId: string | null;
}): boolean {
  return actor.kind === "staff"
    && actor.tenantId === scope.tenantId
    && actor.organizationId === scope.parentOrganizationId
    && scope.childParentOrganizationId === scope.parentOrganizationId;
}

export function isDirectChildOrganization(parent: { id: string; tenantId: string }, child: {
  tenantId: string;
  parentOrganizationId: string | null;
}): boolean {
  return child.tenantId === parent.tenantId && child.parentOrganizationId === parent.id;
}

export function franchiseLocationCode(locationName: string, organizationId: string): string {
  const prefix = locationName.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "LOC";
  return `${prefix}-${organizationId.replaceAll("-", "").slice(-4).toUpperCase()}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function agreementEffectiveTo(effectiveFrom: string, effectiveTo: string | null | undefined): string | null {
  const end = effectiveTo ?? null;
  if (end && end < effectiveFrom) {
    throw new DomainError("VALIDATION_ERROR", "The agreement end date must be on or after its start date.", 422);
  }
  return end;
}

async function findActiveParent(reader: Pick<Database, "select">, actor: SessionActor) {
  requireStaff(actor);
  const [parent] = await reader.select().from(organizations).where(and(
    eq(organizations.id, actor.organizationId!),
    eq(organizations.tenantId, actor.tenantId),
    eq(organizations.active, true),
  )).limit(1);
  if (!parent) throw new DomainError("NOT_FOUND", "Parent organization not found.", 404);
  return parent;
}

async function lockActiveParent(tx: Pick<Database, "select" | "execute">, actor: SessionActor) {
  requireStaff(actor);
  await tx.execute(sql`SELECT id FROM organizations
    WHERE tenant_id = ${actor.tenantId} AND id = ${actor.organizationId!} AND active = true
    FOR UPDATE`);
  return findActiveParent(tx, actor);
}

async function listAgreements(actor: SessionActor): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "organization.franchise_manage");
  await findActiveParent(getDb(), actor);
  const parent = alias(organizations, "royalty_agreement_parent");
  const child = alias(organizations, "royalty_agreement_child");
  const items = await getDb().select({
    agreement: franchiseAgreements,
    child: {
      id: child.id,
      displayName: child.displayName,
      legalName: child.legalName,
      organizationType: child.organizationType,
      currency: child.currency,
      timezone: child.timezone,
      active: child.active,
    },
  }).from(franchiseAgreements)
    .innerJoin(parent, and(eq(parent.id, franchiseAgreements.parentOrganizationId), eq(parent.tenantId, franchiseAgreements.tenantId)))
    .innerJoin(child, and(
      eq(child.id, franchiseAgreements.childOrganizationId),
      eq(child.tenantId, franchiseAgreements.tenantId),
      eq(child.parentOrganizationId, franchiseAgreements.parentOrganizationId),
    ))
    .where(and(
      eq(franchiseAgreements.tenantId, actor.tenantId),
      eq(franchiseAgreements.parentOrganizationId, actor.organizationId!),
    )).orderBy(desc(franchiseAgreements.createdAt)).limit(200);
  return json({ items: normalized(items) });
}

async function createAgreement(request: Request, actor: SessionActor): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "organization.franchise_manage");
  const input = await readBody(request, agreementBodySchema);
  const effectiveTo = agreementEffectiveTo(input.effectiveFrom, input.effectiveTo);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const parent = await lockActiveParent(tx, actor);
    const [child] = await tx.select().from(organizations).where(and(
      eq(organizations.id, input.childOrganizationId),
      eq(organizations.tenantId, actor.tenantId),
      eq(organizations.parentOrganizationId, parent.id),
      eq(organizations.active, true),
    )).limit(1);
    if (!child || !isDirectChildOrganization(parent, child)) {
      throw new DomainError("NOT_FOUND", "Child organization not found.", 404);
    }
    const [existing] = await tx.select().from(franchiseAgreements).where(and(
      eq(franchiseAgreements.tenantId, actor.tenantId),
      eq(franchiseAgreements.parentOrganizationId, parent.id),
      eq(franchiseAgreements.childOrganizationId, child.id),
      eq(franchiseAgreements.active, true),
    )).limit(1);
    const settings = input.settings ?? {};
    if (existing) {
      const sameAgreement = existing.effectiveFrom === input.effectiveFrom
        && existing.effectiveTo === effectiveTo
        && stableJson(existing.settings) === stableJson(settings);
      if (sameAgreement) return { agreement: existing, duplicate: true };
      throw new DomainError("CONFLICT", "An active franchise agreement already exists for this child organization.", 409);
    }
    const [agreement] = await tx.insert(franchiseAgreements).values({
      tenantId: actor.tenantId,
      parentOrganizationId: parent.id,
      childOrganizationId: child.id,
      effectiveFrom: input.effectiveFrom,
      effectiveTo,
      settings,
      active: true,
    }).returning();
    if (!agreement) throw new DomainError("CONFLICT", "The franchise agreement could not be saved.", 409);
    await recordEvent(actor, {
      type: "franchise.agreement.created", entityType: "franchise_agreement", entityId: agreement.id,
      auditAction: "franchise.agreement.create", after: normalized(agreement) as Record<string, unknown>,
    }, tx);
    return { agreement, duplicate: false };
  });
  return json({ item: normalized(result.agreement), duplicate: result.duplicate }, result.duplicate ? 200 : 201);
}

async function createFranchiseUnit(request: Request, actor: SessionActor): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "organization.franchise_manage");
  const input = await readBody(request, unitBodySchema);
  const effectiveTo = agreementEffectiveTo(input.effectiveFrom, input.effectiveTo);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const parent = await lockActiveParent(tx, actor);
    if (parent.displayName.trim().toLowerCase() === input.displayName.toLowerCase()) {
      throw new DomainError("VALIDATION_ERROR", "A franchise unit must have a different name from its parent organization.", 422);
    }
    const [existingUnit] = await tx.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.tenantId, actor.tenantId),
      eq(organizations.parentOrganizationId, parent.id),
      eq(organizations.active, true),
      sql`lower(${organizations.displayName}) = ${input.displayName.toLowerCase()}`,
    )).limit(1);
    if (existingUnit) throw new DomainError("CONFLICT", "An active child organization with this name already exists.", 409);

    const currency = input.currency ?? parent.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new DomainError("CONFLICT", "The parent organization has an invalid currency.", 409);
    const timezone = input.timezone ?? parent.timezone;
    const [organization] = await tx.insert(organizations).values({
      tenantId: actor.tenantId,
      parentOrganizationId: parent.id,
      organizationType: "franchise_unit",
      legalName: input.legalName ?? input.displayName,
      displayName: input.displayName,
      email: input.email || null,
      phone: input.phone || null,
      timezone,
      currency,
      active: true,
    }).returning();
    if (!organization) throw new DomainError("CONFLICT", "The franchise unit could not be created.", 409);

    const [location] = await tx.insert(organizationLocations).values({
      tenantId: actor.tenantId,
      organizationId: organization.id,
      name: input.location.name,
      code: input.location.code?.toUpperCase() ?? franchiseLocationCode(input.location.name, organization.id),
      addressLine1: input.location.addressLine1 || null,
      addressLine2: input.location.addressLine2 || null,
      city: input.location.city || null,
      region: input.location.region || null,
      postalCode: input.location.postalCode || null,
      countryCode: input.location.countryCode ?? "US",
      timezone: input.location.timezone ?? timezone,
      phone: input.location.phone || null,
      email: input.location.email || null,
      active: true,
    }).returning();
    if (!location) throw new DomainError("CONFLICT", "The franchise unit's first location could not be created.", 409);

    const [agreement] = await tx.insert(franchiseAgreements).values({
      tenantId: actor.tenantId,
      parentOrganizationId: parent.id,
      childOrganizationId: organization.id,
      effectiveFrom: input.effectiveFrom,
      effectiveTo,
      settings: {},
      active: true,
    }).returning();
    if (!agreement) throw new DomainError("CONFLICT", "The franchise agreement could not be created.", 409);

    // Domain events enforce that their organization and location belong together. The parent
    // owner initiated this operation, but these events describe resources in the new child unit.
    const unitActor = { ...actor, organizationId: organization.id };
    await recordEvent(unitActor, {
      type: "franchise.unit.created", entityType: "organization", entityId: organization.id,
      payload: { locationId: location.id, agreementId: agreement.id },
      auditAction: "franchise.unit.create",
      after: { displayName: organization.displayName, organizationType: organization.organizationType, locationId: location.id, agreementId: agreement.id },
      locationId: location.id,
    }, tx);
    await recordEvent(unitActor, {
      type: "franchise.agreement.created", entityType: "franchise_agreement", entityId: agreement.id,
      auditAction: "franchise.agreement.create", after: normalized(agreement) as Record<string, unknown>,
      locationId: location.id,
    }, tx);
    return { organization, location, agreement };
  });
  return json({ item: normalized(result) }, 201);
}

async function findParentAgreement(reader: Pick<Database, "select">, actor: SessionActor, agreementId: string): Promise<ParentAgreement> {
  requireStaff(actor);
  const parent = alias(organizations, "royalty_parent");
  const child = alias(organizations, "royalty_child");
  const [row] = await reader.select({
    agreement: franchiseAgreements,
    childCurrency: child.currency,
    childParentOrganizationId: child.parentOrganizationId,
  })
    .from(franchiseAgreements)
    .innerJoin(parent, and(eq(parent.id, franchiseAgreements.parentOrganizationId), eq(parent.tenantId, franchiseAgreements.tenantId)))
    .innerJoin(child, and(
      eq(child.id, franchiseAgreements.childOrganizationId),
      eq(child.tenantId, franchiseAgreements.tenantId),
      eq(child.parentOrganizationId, franchiseAgreements.parentOrganizationId),
    ))
    .where(and(
      eq(franchiseAgreements.id, agreementId),
      eq(franchiseAgreements.tenantId, actor.tenantId),
      eq(franchiseAgreements.parentOrganizationId, actor.organizationId!),
    )).limit(1);
  if (!row || !isDirectParentAgreementScope(actor, {
    tenantId: row.agreement.tenantId,
    parentOrganizationId: row.agreement.parentOrganizationId,
    childParentOrganizationId: row.childParentOrganizationId,
  })) {
    throw new DomainError("NOT_FOUND", "Franchise agreement not found.", 404);
  }
  return row;
}

function validateRuleWindow(input: RoyaltyRuleInput, agreement: typeof franchiseAgreements.$inferSelect): string | null {
  const effectiveTo = input.effectiveTo ?? null;
  if (effectiveTo && effectiveTo < input.effectiveFrom) {
    throw new DomainError("VALIDATION_ERROR", "The rule end date must be on or after its start date.", 422);
  }
  if (input.effectiveFrom < agreement.effectiveFrom || (agreement.effectiveTo && (!effectiveTo || effectiveTo > agreement.effectiveTo))) {
    throw new DomainError("VALIDATION_ERROR", "The rule dates must fall within the franchise agreement dates.", 422);
  }
  return effectiveTo;
}

function validatePeriodInAgreement(period: RoyaltyPeriod, agreement: typeof franchiseAgreements.$inferSelect): void {
  if (period.periodStart < agreement.effectiveFrom || (agreement.effectiveTo && period.periodEnd > agreement.effectiveTo)) {
    throw new DomainError("VALIDATION_ERROR", "The statement period must fall within the franchise agreement dates.", 422);
  }
}

function parseMinor(value: InvoiceActivity["total_minor"]): bigint {
  try {
    const amount = typeof value === "bigint" ? value : BigInt(value);
    if (amount < 0n) throw new Error("negative");
    return amount;
  } catch {
    throw new DomainError("CONFLICT", "A child-unit invoice has an invalid total.", 409);
  }
}

function dateSnapshot(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new DomainError("CONFLICT", "A child-unit invoice has an invalid issue date.", 409);
  return date.toISOString();
}

async function listRules(actor: SessionActor, agreementId: string): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "organization.franchise_manage");
  await findParentAgreement(getDb(), actor, agreementId);
  const items = await getDb().select().from(royaltyRules).where(and(
    eq(royaltyRules.tenantId, actor.tenantId), eq(royaltyRules.franchiseAgreementId, agreementId),
  )).orderBy(asc(royaltyRules.effectiveFrom), asc(royaltyRules.createdAt)).limit(100);
  return json({ items: normalized(items) });
}

async function configureRule(request: Request, actor: SessionActor, agreementId: string): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "organization.franchise_manage");
  const input = await readBody(request, royaltyRuleBodySchema);
  const effectiveTo = input.effectiveTo ?? null;
  if (effectiveTo && effectiveTo < input.effectiveFrom) {
    throw new DomainError("VALIDATION_ERROR", "The rule end date must be on or after its start date.", 422);
  }
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM franchise_agreements
      WHERE tenant_id = ${actor.tenantId} AND id = ${agreementId} AND parent_organization_id = ${actor.organizationId!}
      FOR UPDATE`);
    const { agreement } = await findParentAgreement(tx, actor, agreementId);
    if (!agreement.active) throw new DomainError("CONFLICT", "An inactive franchise agreement cannot be changed.", 409);
    const ruleEnd = validateRuleWindow(input, agreement);
    const overlapEnd = ruleEnd ?? "9998-12-31";
    const overlapping = await tx.select().from(royaltyRules).where(and(
      eq(royaltyRules.tenantId, actor.tenantId),
      eq(royaltyRules.franchiseAgreementId, agreementId),
      eq(royaltyRules.active, true),
      lte(royaltyRules.effectiveFrom, overlapEnd),
      or(isNull(royaltyRules.effectiveTo), gte(royaltyRules.effectiveTo, input.effectiveFrom)),
    )).orderBy(asc(royaltyRules.effectiveFrom)).limit(100);
    const duplicate = overlapping.find((rule) => rule.effectiveFrom === input.effectiveFrom
      && rule.effectiveTo === ruleEnd && rule.ruleType === input.ruleType
      && rule.definition.basis === input.definition.basis
      && rule.definition.rateBasisPoints === input.definition.rateBasisPoints);
    if (duplicate) return { rule: duplicate, duplicate: true };
    if (overlapping.length) throw new DomainError("CONFLICT", "This rule overlaps another active royalty rule.", 409);
    const [rule] = await tx.insert(royaltyRules).values({
      tenantId: actor.tenantId,
      franchiseAgreementId: agreementId,
      ruleType: input.ruleType,
      definition: input.definition,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: ruleEnd,
      active: true,
    }).returning();
    if (!rule) throw new DomainError("CONFLICT", "The royalty rule could not be saved.", 409);
    await recordEvent(actor, {
      type: "franchise.royalty_rule.created", entityType: "royalty_rule", entityId: rule.id,
      auditAction: "franchise.royalty_rule.create", after: normalized(rule) as Record<string, unknown>,
    }, tx);
    return { rule, duplicate: false };
  });
  return json({ item: normalized(result.rule), duplicate: result.duplicate }, result.duplicate ? 200 : 201);
}

async function listStatements(actor: SessionActor, agreementId: string): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "reports.franchise_read");
  await findParentAgreement(getDb(), actor, agreementId);
  const items = await getDb().select().from(royaltyStatements).where(and(
    eq(royaltyStatements.tenantId, actor.tenantId), eq(royaltyStatements.franchiseAgreementId, agreementId),
  )).orderBy(desc(royaltyStatements.periodStart), desc(royaltyStatements.createdAt)).limit(100);
  return json({ items: normalized(items) });
}

async function calculateStatement(request: Request, actor: SessionActor, agreementId: string): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "organization.franchise_manage");
  const period = await readBody(request, royaltyPeriodBodySchema);
  const { startAt, endExclusiveAt } = parseRoyaltyPeriod(period);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    // The agreement row serializes all period retries through this API. The existing snapshot is returned unchanged.
    await tx.execute(sql`SELECT id FROM franchise_agreements
      WHERE tenant_id = ${actor.tenantId} AND id = ${agreementId} AND parent_organization_id = ${actor.organizationId!}
      FOR UPDATE`);
    const { agreement, childCurrency } = await findParentAgreement(tx, actor, agreementId);
    validatePeriodInAgreement(period, agreement);
    const [existing] = await tx.select().from(royaltyStatements).where(and(
      eq(royaltyStatements.tenantId, actor.tenantId),
      eq(royaltyStatements.franchiseAgreementId, agreementId),
      eq(royaltyStatements.periodStart, period.periodStart),
      eq(royaltyStatements.periodEnd, period.periodEnd),
    )).limit(1);
    if (existing) return { statement: existing, duplicate: true };
    if (!agreement.active) throw new DomainError("CONFLICT", "An inactive franchise agreement cannot be calculated.", 409);

    const applicableRules = await tx.select().from(royaltyRules).where(and(
      eq(royaltyRules.tenantId, actor.tenantId),
      eq(royaltyRules.franchiseAgreementId, agreementId),
      eq(royaltyRules.active, true),
      lte(royaltyRules.effectiveFrom, period.periodStart),
      or(isNull(royaltyRules.effectiveTo), gte(royaltyRules.effectiveTo, period.periodEnd)),
    )).orderBy(desc(royaltyRules.effectiveFrom), desc(royaltyRules.createdAt)).limit(2);
    if (applicableRules.length === 0) throw new DomainError("CONFLICT", "No active royalty rule covers the full statement period.", 409);
    if (applicableRules.length > 1) throw new DomainError("CONFLICT", "More than one active royalty rule covers the statement period.", 409);
    const rule = applicableRules[0]!;
    const rateBasisPoints = rule.definition.rateBasisPoints;
    if (rule.ruleType !== "percentage" || rule.definition.basis !== "invoiced_revenue"
      || typeof rateBasisPoints !== "number" || !Number.isSafeInteger(rateBasisPoints)
      || rateBasisPoints < 1 || rateBasisPoints > 10_000) {
      throw new DomainError("CONFLICT", "The active royalty rule is not a supported percentage rule.", 409);
    }

    const activityResult = await tx.execute(buildInvoiceActivityQuery(actor.tenantId, agreement.childOrganizationId, startAt, endExclusiveAt));
    const activities = activityResult.rows as unknown as InvoiceActivity[];
    const currencyCode = childCurrency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currencyCode)) throw new DomainError("CONFLICT", "The child organization has an invalid currency.", 409);
    if (activities.some((invoice) => invoice.currency.toUpperCase() !== currencyCode)) {
      throw new DomainError("CONFLICT", "Child-unit invoices use a different currency than the franchise agreement.", 409);
    }
    const basisAmountMinor = activities.reduce((sum, invoice) => sum + parseMinor(invoice.total_minor), 0n);
    const royaltyAmountMinor = calculateRoyaltyAmountMinor(basisAmountMinor, rateBasisPoints);
    const calculationSnapshot = {
      source: "franchise-royalty-v1",
      agreementId,
      period: { start: period.periodStart, end: period.periodEnd },
      rule: {
        id: rule.id,
        type: rule.ruleType,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        definition: rule.definition,
      },
      formula: { basis: "invoiced_revenue", rateBasisPoints, rounding: "nearest_minor_half_up" },
      currency: currencyCode,
      basisAmountMinor: basisAmountMinor.toString(),
      royaltyAmountMinor: royaltyAmountMinor.toString(),
      invoices: activities.map((invoice) => ({
        id: invoice.id,
        organizationLocationId: invoice.organization_location_id,
        issuedAt: dateSnapshot(invoice.issued_at),
        totalMinor: parseMinor(invoice.total_minor).toString(),
        currency: invoice.currency.toUpperCase(),
      })),
    };
    const [statement] = await tx.insert(royaltyStatements).values({
      tenantId: actor.tenantId,
      franchiseAgreementId: agreementId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      status: "calculated",
      basisAmountMinor,
      royaltyAmountMinor,
      currency: currencyCode,
      calculationSnapshot,
    }).returning();
    if (!statement) throw new DomainError("CONFLICT", "The royalty statement could not be saved.", 409);
    await recordEvent(actor, {
      type: "franchise.royalty_statement.calculated", entityType: "royalty_statement", entityId: statement.id,
      payload: { agreementId, periodStart: period.periodStart, periodEnd: period.periodEnd, royaltyAmountMinor: royaltyAmountMinor.toString() },
      auditAction: "franchise.royalty_statement.calculate", after: normalized(statement) as Record<string, unknown>,
    }, tx);
    return { statement, duplicate: false };
  });
  return json({ item: normalized(result.statement), duplicate: result.duplicate }, result.duplicate ? 200 : 201);
}

function validAgreementId(value: string | undefined): string {
  const parsed = agreementIdSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("NOT_FOUND", "Franchise agreement not found.", 404);
  return parsed.data;
}

export async function handleFranchiseRoyalty(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "franchise") return null;
  if (path.length === 2 && path[1] === "agreements") {
    if (request.method === "GET") return listAgreements(actor);
    if (request.method === "POST") return createAgreement(request, actor);
    requireMethod(request, "GET");
  }
  if (path.length === 2 && path[1] === "units") {
    if (request.method === "POST") return createFranchiseUnit(request, actor);
    requireMethod(request, "POST");
  }
  if (path.length === 4 && path[1] === "agreements" && path[3] === "rules") {
    const agreementId = validAgreementId(path[2]);
    if (request.method === "GET") return listRules(actor, agreementId);
    if (request.method === "POST") return configureRule(request, actor, agreementId);
    requireMethod(request, "GET");
  }
  if (path.length === 3 && path[1] === "agreements" && path[2]) {
    // Validate the ID before falling through so malformed franchise routes never reach database casts.
    validAgreementId(path[2]);
    return null;
  }
  if (path.length === 5 && path[1] === "agreements" && path[3] === "statements" && path[4] === "calculate") {
    const agreementId = validAgreementId(path[2]);
    if (request.method === "POST") return calculateStatement(request, actor, agreementId);
    requireMethod(request, "POST");
  }
  if (path.length === 4 && path[1] === "agreements" && path[3] === "statements") {
    const agreementId = validAgreementId(path[2]);
    if (request.method === "GET") return listStatements(actor, agreementId);
    requireMethod(request, "GET");
  }
  return null;
}
