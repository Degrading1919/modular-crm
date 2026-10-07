import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { customers, domainEvents, estimateRevisions, estimates, invoiceItems, invoices, jobInvoiceLinks, jobs, organizationLocations, organizations, tenants, type Database } from "@modular-crm/db";
import { DomainError, frozenDocument, invoiceDueDate, requirePermission, type DocumentPricing } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { businessDate } from "../dates";
import { requireStaff, type SessionActor } from "./actor";
import { requireTenantFeature } from "./capability-enforcement";
import { storedLine } from "./document-lines";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized, uuidArray } from "./sql";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Job = typeof jobs.$inferSelect;
const locationScope = (actor: SessionActor) => actor.kind === "staff" && actor.allLocations ? sql`true` : actor.locationIds.size ? sql`${jobs.organizationLocationId} = any(${uuidArray(actor.locationIds)})` : sql`false`;
const unbilled = sql`not exists (select 1 from job_invoice_links l where l.tenant_id = ${jobs.tenantId} and l.job_id = ${jobs.id}) and not exists (select 1 from invoice_items ii where ii.tenant_id = ${jobs.tenantId} and ii.job_id = ${jobs.id})`;

export function jobPricing(job: Job): DocumentPricing {
  const snapshot = job.priceSnapshot;
  if (snapshot?.version === 1 && Array.isArray(snapshot.items) && snapshot.items.length) return snapshot as unknown as DocumentPricing;
  const result = snapshot?.result as Record<string, unknown> | undefined;
  const amount = snapshot?.amountMinor ?? result?.totalMinor;
  if (!Number.isSafeInteger(amount) || Number(amount) < 0) throw new DomainError("CONFLICT", "This visit has no recorded price. Review its price before billing it.", 409);
  const total = Number(amount);
  const subtotal = Number(result?.subtotalMinor ?? total), tax = Number(result?.taxMinor ?? 0);
  if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(tax) || subtotal < 0 || tax < 0 || subtotal + tax !== total) throw new DomainError("CONFLICT", "Review this visit's recorded price before billing it.", 409);
  return frozenDocument([{ description: job.customerSummary || "Completed service", quantity: "1", unitAmountMinor: subtotal, subtotalMinor: subtotal, discountMinor: 0, documentDiscountMinor: 0, taxMinor: tax, totalMinor: total, sortOrder: 0, serviceId: job.serviceId }]);
}

function currency(job: Job, fallback: string) {
  const snapshot = job.priceSnapshot;
  return String(snapshot?.currency ?? (snapshot?.result as Record<string, unknown> | undefined)?.currency ?? fallback);
}

/** The same estimate → job lock order is used by estimate conversion and batch billing. */
export async function lockSourceEstimates(tx: Tx, tenantId: string, candidates: Job[]) {
  const revisions = [...new Set(candidates.map(job => job.priceSnapshot?.estimateRevisionId).filter((id): id is string => typeof id === "string"))];
  if (!revisions.length) return;
  const sources = await tx.select({ id: estimates.id }).from(estimates).innerJoin(estimateRevisions, and(eq(estimateRevisions.tenantId, estimates.tenantId), eq(estimateRevisions.estimateId, estimates.id))).where(and(eq(estimates.tenantId, tenantId), inArray(estimateRevisions.id, revisions))).orderBy(estimates.id).for("update", { of: estimates });
  return sources;
}

export async function existingJobInvoice(tx: Tx, tenantId: string, jobId: string) {
  const [linked] = await tx.select({ invoice: invoices }).from(jobInvoiceLinks).innerJoin(invoices, and(eq(invoices.tenantId, jobInvoiceLinks.tenantId), eq(invoices.id, jobInvoiceLinks.invoiceId))).where(and(eq(jobInvoiceLinks.tenantId, tenantId), eq(jobInvoiceLinks.jobId, jobId))).limit(1);
  if (linked) return linked.invoice;
  const [historical] = await tx.select({ invoice: invoices }).from(invoiceItems).innerJoin(invoices, and(eq(invoices.tenantId, invoiceItems.tenantId), eq(invoices.id, invoiceItems.invoiceId))).where(and(eq(invoiceItems.tenantId, tenantId), eq(invoiceItems.jobId, jobId))).limit(1);
  return historical?.invoice;
}

export function requireInvoiceLocation(actor: SessionActor, invoice: typeof invoices.$inferSelect) {
  if (actor.kind !== "staff" || !actor.allLocations && (!invoice.organizationLocationId || !actor.locationIds.has(invoice.organizationLocationId))) throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
}

async function createForJobs(tx: Tx, actor: SessionActor, work: Job[], issued: boolean, defaultCurrency: string) {
  const first = work[0]!;
  const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, actor.tenantId), eq(customers.id, first.customerId))).limit(1);
  const [organization] = await tx.select().from(organizations).where(and(eq(organizations.tenantId, actor.tenantId), eq(organizations.id, first.organizationId))).limit(1);
  if (!customer || !organization) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
  const lines = work.flatMap(job => jobPricing(job).items.map(line => ({ ...line, jobId: job.id })));
  if (lines.length > 100) throw new DomainError("VALIDATION_ERROR", "Choose a shorter date range; an invoice can contain up to 100 lines.", 422);
  const rates = new Set(work.map(job => jobPricing(job).taxRateBasisPoints));
  const pricing = frozenDocument(lines, rates.size === 1 ? jobPricing(first).taxRateBasisPoints : 0);
  const now = new Date();
  const dueAt = issued ? invoiceDueDate({ issuedAt: now, customerTermsDays: customer.paymentTermsDays, businessTermsDays: organization.settings.paymentDueDays }) : null;
  const [invoice] = await tx.insert(invoices).values({ tenantId: actor.tenantId, organizationId: first.organizationId, organizationLocationId: first.organizationLocationId, customerId: first.customerId, status: issued ? "issued" : "draft", issuedAt: issued ? now : null, dueAt,
    invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`, currency: currency(first, defaultCurrency),
    subtotalMinor: BigInt(pricing.subtotalMinor), discountMinor: BigInt(pricing.discountMinor), taxMinor: BigInt(pricing.taxMinor), totalMinor: BigInt(pricing.totalMinor), balanceMinor: BigInt(pricing.totalMinor),
    billingSnapshot: { ...pricing, businessName: organization.displayName, customerName: customer.displayName, description: "Completed service", jobIds: work.map(job => job.id) },
  }).returning();
  await tx.insert(invoiceItems).values(lines.map((line, sortOrder) => ({ tenantId: actor.tenantId, invoiceId: invoice!.id, ...storedLine({ ...line, sortOrder }), jobId: line.jobId })));
  await tx.insert(jobInvoiceLinks).values(work.map(job => ({ tenantId: actor.tenantId, customerId: job.customerId, jobId: job.id, invoiceId: invoice!.id })));
  await recordEvent(actor, { type: "invoice.created", entityType: "invoice", entityId: invoice!.id, locationId: first.organizationLocationId, auditAction: "invoice.create_from_jobs", payload: { jobIds: work.map(job => job.id), totalMinor: pricing.totalMinor } }, tx);
  if (issued) await recordEvent(actor, { type: "invoice.issued", entityType: "invoice", entityId: invoice!.id, locationId: first.organizationLocationId, auditAction: "invoice.issue", payload: { totalMinor: pricing.totalMinor } }, tx);
  return invoice!;
}

export async function jobInvoice(actor: SessionActor, id: string) {
  requireStaff(actor); requirePermission(actor, "jobs.read"); requirePermission(actor, "invoices.create"); requirePermission(actor, "invoices.read");
  await requireTenantFeature(actor.tenantId, "invoicing");
  const result = await getDb().transaction(async tx => {
    const [candidate] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, id), locationScope(actor))).limit(1);
    if (!candidate) throw new DomainError("NOT_FOUND", "Job not found.", 404);
    await lockSourceEstimates(tx, actor.tenantId, [candidate]);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, id), locationScope(actor))).for("update");
    if (!job) throw new DomainError("NOT_FOUND", "Job not found.", 404);
    const existing = await existingJobInvoice(tx, actor.tenantId, id);
    if (existing) { requireInvoiceLocation(actor, existing); return { item: existing, duplicate: true }; }
    if (job.status !== "completed" || !job.billable || job.servicePlanId) throw new DomainError("CONFLICT", "Choose completed one-time work. Visits on a plan follow its billing schedule.", 409);
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
    return { item: await createForJobs(tx, actor, [job], false, tenant!.defaultCurrency), duplicate: false };
  });
  return json(normalized(result), result.duplicate ? 200 : 201);
}

const rangeSchema = z.object({ from: z.iso.date(), through: z.iso.date() }).refine(value => value.from <= value.through && (Date.parse(value.through) - Date.parse(value.from)) / 86400000 <= 366, "Choose a date range of up to one year.");
const commandSchema = z.object({ from: z.iso.date(), through: z.iso.date(), customerId: z.uuid(), issue: z.boolean().default(false), idempotencyKey: z.uuid() }).strict().refine(value => value.from <= value.through && (Date.parse(value.through) - Date.parse(value.from)) / 86400000 <= 366, "Choose a date range of up to one year.");
function rangeCondition(from: string, through: string, timezone: string) {
  // Bill work completed in the business calendar range, not its original appointment date.
  const zone = sql`coalesce((select l.timezone from ${organizationLocations} l where l.tenant_id=${jobs.tenantId} and l.id=${jobs.organizationLocationId}), (select o.timezone from ${organizations} o where o.tenant_id=${jobs.tenantId} and o.id=${jobs.organizationId}), ${timezone})`;
  return sql`(${jobs.actualCompletedAt} at time zone ${zone})::date between ${from}::date and ${through}::date`;
}
export async function finishedWork(request: Request, actor: SessionActor) {
  requireStaff(actor); requirePermission(actor, "jobs.read"); requirePermission(actor, "invoices.read");
  await requireTenantFeature(actor.tenantId, "invoicing");
  const db = getDb(), [tenant] = await db.select().from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
  if (request.method === "GET") {
    const today = businessDate(new Date(), tenant!.defaultTimezone);
    const first = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); first.setUTCDate(0);
    const lastMonthEnd = first.toISOString().slice(0, 10), lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
    const params = new URL(request.url).searchParams;
    const range = rangeSchema.parse({ from: params.get("from") ?? lastMonthStart, through: params.get("through") ?? lastMonthEnd });
    const work = await db.select({ job: jobs, name: customers.displayName }).from(jobs).innerJoin(customers, and(eq(customers.tenantId, jobs.tenantId), eq(customers.id, jobs.customerId))).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.status, "completed"), eq(jobs.billable, true), locationScope(actor), rangeCondition(range.from, range.through, tenant!.defaultTimezone), unbilled)).orderBy(customers.displayName, jobs.id).limit(1001);
    if (work.length > 1000) throw new DomainError("VALIDATION_ERROR", "Choose a shorter range to review up to 1,000 visits at a time.", 422);
    const groups = new Map<string, { customerId: string; name: string; visits: number; totals: Record<string, number>; invoiceCount: number; groups: Set<string>; error?: string }>();
    for (const { job, name } of work) {
      const group = groups.get(job.customerId) ?? { customerId: job.customerId, name, visits: 0, totals: {}, invoiceCount: 0, groups: new Set<string>() };
      group.visits++; group.groups.add(`${job.organizationId}:${job.organizationLocationId}:${currency(job, tenant!.defaultCurrency)}`);
      try { const code = currency(job, tenant!.defaultCurrency); group.totals[code] = (group.totals[code] ?? 0) + jobPricing(job).totalMinor; }
      catch (cause) { group.error = (cause as Error).message; }
      group.invoiceCount = group.groups.size; groups.set(job.customerId, group);
    }
    return json({ ...range, items: [...groups.values()].map(item => ({ customerId: item.customerId, name: item.name, visits: item.visits, totals: item.totals, invoiceCount: item.invoiceCount, error: item.error })), scope: "Your accessible branches. Separate invoices keep each branch and currency clear." });
  }
  requirePermission(actor, "invoices.create");
  const command = await readBody(request, commandSchema);
  if (command.issue) requirePermission(actor, "invoices.issue");
  const hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${actor.tenantId}:${actor.userId}:batch:${command.idempotencyKey}`}, 0))`);
    const [receipt] = await tx.select().from(domainEvents).where(and(eq(domainEvents.tenantId, actor.tenantId), eq(domainEvents.eventType, "invoice.batch_created"), sql`${domainEvents.payload}->>'key' = ${command.idempotencyKey}`, sql`${domainEvents.payload}->>'userId' = ${actor.userId}`)).limit(1);
    if (receipt) {
      if (receipt.payload.hash !== hash) throw new DomainError("CONFLICT", "This billing request changed. Preview the work again.", 409);
      if (!actor.allLocations && (receipt.payload.result as { invoices: { organizationLocationId: string | null }[] }).invoices.some(invoice => !invoice.organizationLocationId || !actor.locationIds.has(invoice.organizationLocationId))) throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
      return { ...receipt.payload.result as Record<string, unknown>, duplicate: true };
    }
    const conditions = and(eq(jobs.tenantId, actor.tenantId), eq(jobs.customerId, command.customerId), eq(jobs.status, "completed"), eq(jobs.billable, true), locationScope(actor), rangeCondition(command.from, command.through, tenant!.defaultTimezone), unbilled);
    const candidates = await tx.select().from(jobs).where(conditions).orderBy(jobs.id).limit(1001);
    if (candidates.length > 1000) throw new DomainError("VALIDATION_ERROR", "Choose a shorter billing range.", 422);
    await lockSourceEstimates(tx, actor.tenantId, candidates);
    const work = candidates.length ? await tx.select().from(jobs).where(and(conditions, inArray(jobs.id, candidates.map(job => job.id)))).orderBy(jobs.id).for("update") : [];
    const groups = new Map<string, Job[]>();
    for (const job of work) {
      // Recheck after obtaining locks: another billing transaction may have just claimed it.
      if (await existingJobInvoice(tx, actor.tenantId, job.id)) continue;
      const key = `${job.organizationId}:${job.organizationLocationId}:${currency(job, tenant!.defaultCurrency)}`;
      groups.set(key, [...groups.get(key) ?? [], job]);
    }
    const created = [];
    for (const group of groups.values()) created.push(await createForJobs(tx, actor, group, command.issue, tenant!.defaultCurrency));
    const outcome = { invoices: normalized(created), created: created.length, visits: [...groups.values()].reduce((count, group) => count + group.length, 0) };
    await recordEvent(actor, { type: "invoice.batch_created", entityType: "customer", entityId: command.customerId, locationId: work[0]?.organizationLocationId, auditAction: "invoice.batch_create", payload: { key: command.idempotencyKey, userId: actor.userId, hash, result: outcome } }, tx);
    return outcome;
  });
  return json(result);
}
