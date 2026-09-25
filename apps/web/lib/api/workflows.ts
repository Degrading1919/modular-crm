import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditEvents, completionProofs, creditAllocations, customerContacts, customers, domainEvents, estimateApprovals, estimateItems, estimateRevisions, estimates, hasUsableFeature, invoiceItems, invoices, jobAssignments, jobStatusEvents,
  jobs, leads, loadTenantCapabilities, memberships, paymentAllocations, payments, recurrenceRules, refunds, serviceLocations, servicePlans, services, tenants,
  secureEstimateTokens,
} from "@modular-crm/db";
import { assertTransition, DomainError, invoiceFinancialPosition, requirePermission, type Permission } from "@modular-crm/domain";
import { getCapability } from "../connectors";
import { getDb } from "../db";
import type { Database } from "@modular-crm/db";
import { requireTenantFeature } from "./capability-enforcement";
import { assertCustomerDocumentAccess, requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized } from "./sql";
import { claimFieldOperation, completeFieldOperation, type FieldOperationInput } from "./field-operations";

export async function getAssignedJob(actor: SessionActor, jobId: string, permission: Permission = "jobs.read") {
  const db = getDb();
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.tenantId, actor.tenantId))).limit(1);
  if (!job) throw new DomainError("NOT_FOUND", "Job not found.", 404);
  if (actor.kind !== "staff" || !actor.permissions.has(permission)) throw new DomainError("NOT_FOUND", "Job not found.", 404);
  if (!actor.allLocations && (!job.organizationLocationId || !actor.locationIds.has(job.organizationLocationId))) throw new DomainError("NOT_FOUND", "Job not found.", 404);
  if (actor.role === "technician") {
    const [assigned] = await db.select({ id: jobAssignments.id }).from(jobAssignments)
      .where(and(eq(jobAssignments.tenantId, actor.tenantId), eq(jobAssignments.jobId, jobId), eq(jobAssignments.membershipId, actor.membershipId!), isNull(jobAssignments.removedAt))).limit(1);
    if (!assigned) throw new DomainError("NOT_FOUND", "Job not found.", 404);
  }
  return job;
}

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

type LeadConversionSource = { actor: SessionActor & { kind: "staff" } } | { secureTokenId: string; ipAddress: string | null; userAgent: string | null };

async function convertLeadCoreInTransaction(tenantId: string, leadId: string, tx: DbTransaction, source: LeadConversionSource) {
  await tx.execute(sql`SELECT id FROM leads WHERE tenant_id = ${tenantId} AND id = ${leadId} FOR UPDATE`);
  const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId))).limit(1);
  if (!lead) throw new DomainError("NOT_FOUND", "Lead not found.", 404);
  if ("actor" in source && !source.actor.allLocations && (!lead.owningLocationId || !source.actor.locationIds.has(lead.owningLocationId))) throw new DomainError("NOT_FOUND", "Lead not found.", 404);
  if (lead.customerId) return { lead, customerId: lead.customerId, serviceLocationId: lead.serviceLocationId, alreadyConverted: true };
  assertTransition("lead", lead.status, "converted");
  const name = lead.companyName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "New customer";
  const [customer] = await tx.insert(customers).values({ tenantId, organizationId: lead.organizationId, owningLocationId: lead.owningLocationId, displayName: name, companyName: lead.companyName, customerType: lead.companyName ? "commercial" : "residential", billingEmail: lead.email, billingPhone: lead.phone, status: "active" }).returning();
  if (!customer) throw new Error("Could not convert lead");
  await tx.insert(customerContacts).values({ tenantId, customerId: customer.id, firstName: lead.firstName || name, lastName: lead.lastName || "", email: lead.email, phone: lead.phone, isPrimary: true });
  const address = lead.address as Record<string, unknown> | null;
  let serviceLocationId: string | null = null;
  if (address?.line1) {
    const [location] = await tx.insert(serviceLocations).values({ tenantId, customerId: customer.id, organizationLocationId: lead.owningLocationId, name: "Primary address", addressLine1: String(address.line1), city: String(address.city ?? ""), region: String(address.region ?? ""), postalCode: String(address.postalCode ?? "") }).returning();
    serviceLocationId = location?.id ?? null;
  }
  await tx.update(leads).set({ status: "converted", customerId: customer.id, serviceLocationId, convertedAt: new Date(), updatedAt: new Date() }).where(and(eq(leads.id, lead.id), eq(leads.tenantId, tenantId)));
  if ("actor" in source) {
    await recordEvent(source.actor, { type: "lead.converted", entityType: "lead", entityId: leadId, payload: { customerId: customer.id }, auditAction: "lead.convert", before: { status: lead.status }, after: { status: "converted", customerId: customer.id }, locationId: lead.owningLocationId }, tx);
  } else {
    await tx.insert(domainEvents).values({ tenantId, eventType: "lead.converted", actorType: "secure_estimate_link", actorId: source.secureTokenId, entityType: "lead", entityId: leadId, locationId: lead.owningLocationId, payload: { customerId: customer.id } });
    await tx.insert(auditEvents).values({ tenantId, actorType: "secure_estimate_link", actorId: source.secureTokenId, action: "lead.convert", entityType: "lead", entityId: leadId, beforeData: { status: lead.status }, afterData: { status: "converted", customerId: customer.id }, ipAddress: source.ipAddress, userAgent: source.userAgent });
  }
  return { lead, customerId: customer.id, serviceLocationId, alreadyConverted: false };
}

async function convertLeadInTransaction(actor: SessionActor, leadId: string, tx: DbTransaction) {
  requireStaff(actor);
  requirePermission(actor, "leads.convert");
  return convertLeadCoreInTransaction(actor.tenantId, leadId, tx, { actor });
}

async function convertLead(actor: SessionActor, leadId: string) {
  return getDb().transaction((tx) => convertLeadInTransaction(actor, leadId, tx));
}

async function createEstimateDownstreamInTransaction(
  tx: DbTransaction,
  tenantId: string,
  current: typeof estimates.$inferSelect,
  revision: typeof estimateRevisions.$inferSelect,
  customerId: string,
  convertedLocationId: string | null,
): Promise<void> {
  const [line] = await tx.select().from(estimateItems).where(and(eq(estimateItems.tenantId, tenantId), eq(estimateItems.estimateRevisionId, revision.id))).orderBy(estimateItems.sortOrder).limit(1);
  if (!line?.serviceId) return;
  const [service] = await tx.select().from(services).where(and(eq(services.tenantId, tenantId), eq(services.id, line.serviceId))).limit(1);
  const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId))).limit(1);
  const [location] = await tx.select().from(serviceLocations).where(and(eq(serviceLocations.tenantId, tenantId), eq(serviceLocations.customerId, customerId),
    current.serviceLocationId ? eq(serviceLocations.id, current.serviceLocationId) : convertedLocationId ? eq(serviceLocations.id, convertedLocationId) : current.organizationLocationId ? eq(serviceLocations.organizationLocationId, current.organizationLocationId) : sql`true`)).limit(1);
  if (!service || !customer || !location) throw new DomainError("VALIDATION_ERROR", "Add a service address before approving this work.", 422);
  const capabilities = await loadTenantCapabilities(tx as unknown as Database, tenantId);
  const requiredFeature = service.serviceType === "recurring" ? "recurring_service_management" : "service_scheduling";
  if (!hasUsableFeature(capabilities, requiredFeature)) {
    throw new DomainError("CAPABILITY_UNAVAILABLE", "Add or enable this capability in your business setup to continue.", 403);
  }
  if (service.serviceType === "recurring") {
    const [tenant] = await tx.select({ timezone: tenants.defaultTimezone }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const [rule] = await tx.insert(recurrenceRules).values({ tenantId, frequencyType: "weekly", timezone: location.timezone ?? tenant?.timezone ?? "UTC" }).returning();
    if (!rule) throw new Error("Could not create the service schedule.");
    await tx.insert(servicePlans).values({ tenantId, customerId, serviceLocationId: location.id, organizationLocationId: location.organizationLocationId, serviceId: service.id, recurrenceRuleId: rule.id, effectiveFrom: new Date().toISOString().slice(0, 10), status: "active", pricingSnapshot: { totalMinor: Number(revision.totalMinor), estimateRevisionId: revision.id }, billingConfiguration: { type: "per_job" } });
  } else {
    await tx.insert(jobs).values({ tenantId, organizationId: customer.organizationId, organizationLocationId: location.organizationLocationId, customerId, serviceLocationId: location.id, serviceId: service.id, status: "unscheduled", priceSnapshot: { totalMinor: Number(revision.totalMinor), estimateRevisionId: revision.id } });
  }
}

async function estimateAction(request: Request, actor: SessionActor, estimateId: string, action: string): Promise<Response> {
  await requireTenantFeature(actor.tenantId, "estimate_management");
  const db = getDb();
  const [estimate] = await db.select().from(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.tenantId, actor.tenantId))).limit(1);
  if (!estimate) throw new DomainError("NOT_FOUND", "Estimate not found.", 404);
  if (actor.kind === "staff") {
    if (!actor.allLocations && (!estimate.organizationLocationId || !actor.locationIds.has(estimate.organizationLocationId))) throw new DomainError("NOT_FOUND", "Estimate not found.", 404);
    requirePermission(actor, action === "send" ? "estimates.send" : "estimates.update_draft");
  } else {
    if (action !== "approve" && action !== "decline") throw new DomainError("FORBIDDEN", "Customer access is limited to deciding an estimate.", 403);
    await assertCustomerDocumentAccess(actor, estimate.customerId, estimate.organizationLocationId);
  }
  const to = action === "send" ? "sent" : action === "approve" ? "approved" : action === "decline" ? "declined" : "";
  if (!to) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  const rawActionToken = action === "send" ? randomBytes(32).toString("base64url") : null;
  const actionTokenHash = rawActionToken ? createHash("sha256").update(rawActionToken).digest("hex") : null;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM estimates WHERE tenant_id = ${actor.tenantId} AND id = ${estimateId} FOR UPDATE`);
    const [current] = await tx.select().from(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.tenantId, actor.tenantId))).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "Estimate not found.", 404);
    assertTransition("estimate", current.status, to);
    if (to === "approved" && current.expiresAt && current.expiresAt < new Date()) throw new DomainError("INVALID_TRANSITION", "This estimate has expired.", 409);
    const [revision] = await tx.select().from(estimateRevisions).where(and(eq(estimateRevisions.tenantId, actor.tenantId), eq(estimateRevisions.estimateId, current.id), eq(estimateRevisions.revisionNumber, current.currentRevision))).limit(1);
    if (!revision) throw new DomainError("CONFLICT", "Estimate revision is missing.", 409);
    let customerId = current.customerId;
    let convertedLocationId: string | null = null;
    if (to === "approved" && !customerId && current.leadId && actor.kind === "staff") {
      const converted = await convertLeadInTransaction(actor, current.leadId, tx);
      customerId = converted.customerId;
      convertedLocationId = converted.serviceLocationId;
    }
    if (to === "approved" && !customerId) throw new DomainError("VALIDATION_ERROR", "A customer is needed before this estimate can be approved.", 422);
    if (to === "approved" && customerId) await createEstimateDownstreamInTransaction(tx, actor.tenantId, current, revision, customerId, convertedLocationId);
    const [saved] = await tx.update(estimates).set({ status: to, customerId, approvedAt: to === "approved" ? new Date() : undefined, declinedAt: to === "declined" ? new Date() : undefined, updatedAt: new Date() }).where(and(eq(estimates.id, current.id), eq(estimates.tenantId, actor.tenantId))).returning();
    if (to === "sent") await tx.update(estimateRevisions).set({ sentAt: new Date(), updatedAt: new Date() }).where(and(eq(estimateRevisions.id, revision.id), eq(estimateRevisions.tenantId, actor.tenantId)));
    if (to === "approved" || to === "declined") await tx.insert(estimateApprovals).values({ tenantId: actor.tenantId, estimateId: current.id, estimateRevisionId: revision.id, decision: to, actorType: actor.kind, actorUserId: actor.userId, termsVersion: revision.termsVersion ?? "demo-v1", userAgent: request.headers.get("user-agent") });
    if (to === "sent" && rawActionToken && actionTokenHash) {
      const now = new Date();
      const expiresAt = current.expiresAt && current.expiresAt > now ? current.expiresAt : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await tx.update(secureEstimateTokens).set({ revokedAt: now, updatedAt: now }).where(and(eq(secureEstimateTokens.tenantId, actor.tenantId), eq(secureEstimateTokens.estimateId, current.id), isNull(secureEstimateTokens.consumedAt), isNull(secureEstimateTokens.revokedAt)));
      await tx.insert(secureEstimateTokens).values({ tenantId: actor.tenantId, estimateId: current.id, estimateRevisionId: revision.id, tokenHash: actionTokenHash, expiresAt });
    }
    await recordEvent(actor, { type: `estimate.${to}`, entityType: "estimate", entityId: current.id, auditAction: `estimate.${to}`, before: { status: current.status }, after: { status: to, customerId }, locationId: current.organizationLocationId }, tx);
    return saved;
  });
  return json({ item: normalized(result), ...(rawActionToken ? { actionUrl: `/estimate/${rawActionToken}` } : {}) });
}

export async function applySecureEstimateDecisionInTransaction(
  tx: DbTransaction,
  input: { request: Request; tenantId: string; estimateId: string; tokenId: string; action: "approve" | "decline"; comment: string | null },
) {
  const { request, tenantId, estimateId, tokenId, action, comment } = input;
  const to = action === "approve" ? "approved" : "declined";
  await tx.execute(sql`SELECT id FROM estimates WHERE tenant_id = ${tenantId} AND id = ${estimateId} FOR UPDATE`);
  const [current] = await tx.select().from(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.tenantId, tenantId))).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "Estimate not found.", 404);
  assertTransition("estimate", current.status, to);
  const now = new Date();
  if (to === "approved" && current.expiresAt && current.expiresAt < now) throw new DomainError("INVALID_TRANSITION", "This estimate has expired.", 409);
  const [revision] = await tx.select().from(estimateRevisions).where(and(eq(estimateRevisions.tenantId, tenantId), eq(estimateRevisions.estimateId, current.id), eq(estimateRevisions.revisionNumber, current.currentRevision))).limit(1);
  if (!revision) throw new DomainError("CONFLICT", "Estimate revision is missing.", 409);
  let customerId = current.customerId;
  let convertedLocationId: string | null = null;
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 160)
    || request.headers.get("x-real-ip")?.trim().slice(0, 160) || null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
  if (to === "approved" && !customerId && current.leadId) {
    const converted = await convertLeadCoreInTransaction(tenantId, current.leadId, tx, { secureTokenId: tokenId, ipAddress, userAgent });
    customerId = converted.customerId;
    convertedLocationId = converted.serviceLocationId;
  }
  if (to === "approved" && !customerId) throw new DomainError("VALIDATION_ERROR", "A customer is needed before this estimate can be approved.", 422);
  if (to === "approved" && customerId) await createEstimateDownstreamInTransaction(tx, tenantId, current, revision, customerId, convertedLocationId);
  const [saved] = await tx.update(estimates).set({ status: to, customerId, approvedAt: to === "approved" ? now : undefined, declinedAt: to === "declined" ? now : undefined, updatedAt: now }).where(and(eq(estimates.id, current.id), eq(estimates.tenantId, tenantId))).returning();
  if (!saved) throw new Error("Could not save estimate decision.");
  await tx.insert(estimateApprovals).values({ tenantId, estimateId: current.id, estimateRevisionId: revision.id, decision: to, actorType: "secure_estimate_link", actorUserId: null, secureTokenId: tokenId, ipAddress, userAgent, termsVersion: revision.termsVersion ?? "demo-v1", comment });
  await tx.insert(domainEvents).values({ tenantId, eventType: `estimate.${to}`, actorType: "secure_estimate_link", actorId: tokenId, entityType: "estimate", entityId: current.id, locationId: current.organizationLocationId, payload: { status: to, customerId } });
  await tx.insert(auditEvents).values({ tenantId, actorType: "secure_estimate_link", actorId: tokenId, action: `estimate.${to}`, entityType: "estimate", entityId: current.id, beforeData: { status: current.status }, afterData: { status: to, customerId }, ipAddress, userAgent });
  return saved;
}

async function assignJob(request: Request, actor: SessionActor, jobId: string): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "jobs.assign");
  const body = await readBody(request, z.object({ technicianId: z.string().min(1), scheduledDate: z.iso.date().optional() }));
  const db = getDb();
  const job = await getAssignedJob(actor, jobId, "jobs.assign");
  const [technician] = await db.select().from(memberships).where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.id, body.technicianId), eq(memberships.status, "active"))).limit(1);
  if (!technician || (job.organizationLocationId && technician.defaultLocationId !== job.organizationLocationId && !actor.allLocations)) throw new DomainError("NOT_FOUND", "Technician not found for this location.", 404);
  const date = body.scheduledDate ?? job.scheduledDate;
  if (!date) throw new DomainError("VALIDATION_ERROR", "Choose a service date.", 422);
  const next = job.status === "unscheduled" ? "scheduled" : job.status;
  if (next !== job.status) assertTransition("job", job.status, next);
  await db.transaction(async (tx) => {
    await tx.update(jobAssignments).set({ removedAt: new Date() }).where(and(eq(jobAssignments.tenantId, actor.tenantId), eq(jobAssignments.jobId, jobId)));
    await tx.insert(jobAssignments).values({ tenantId: actor.tenantId, jobId, membershipId: technician.id, assignmentRole: "primary" });
    await tx.update(jobs).set({ scheduledDate: date, status: next, updatedAt: new Date() }).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, jobId)));
    if (next !== job.status) await tx.insert(jobStatusEvents).values({ tenantId: actor.tenantId, jobId, fromStatus: job.status, toStatus: next, actorType: "staff", actorId: actor.userId });
    await recordEvent(actor, { type: "job.assigned", entityType: "job", entityId: jobId, payload: { customerId: job.customerId, technicianId: technician.id, scheduledDate: date }, auditAction: "job.assign", locationId: job.organizationLocationId }, tx);
  });
  return json({ item: normalized({ ...job, scheduledDate: date, status: next, technicianId: technician.id }) });
}

type JobTransitionTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function transitionJob(actor: SessionActor, jobId: string, next: string, context: {
  reason?: string;
  note?: string;
  completedChecklist?: boolean;
  proofProvided?: boolean;
  completionProof?: { fileId: string | null; checklist: Record<string, boolean>; membershipId: string; checklistSnapshot?: Record<string, unknown> };
  checklistSnapshot?: Record<string, unknown>;
  expectedPriorState?: string;
  fieldOperation?: FieldOperationInput;
  prepareCompletionProof?: (tx: JobTransitionTransaction) => Promise<{ fileId: string | null; checklist: Record<string, boolean>; membershipId: string; checklistSnapshot?: Record<string, unknown> }>;
  responseItem?: () => Promise<unknown>;
} = {}): Promise<Response> {
  const transitionPermission: Record<string, Permission> = {
    scheduled: "jobs.assign", dispatched: "jobs.dispatch", en_route: "jobs.start", in_progress: "jobs.start",
    paused: "jobs.start", completed: "jobs.complete", skipped: "jobs.skip", missed: "jobs.skip",
    canceled: "jobs.cancel", needs_return: "jobs.reopen",
  };
  const permission = transitionPermission[next];
  if (!permission) throw new DomainError("VALIDATION_ERROR", "Choose a supported job status.", 422);
  const requestedJob = await getAssignedJob(actor, jobId, permission);
  const db = getDb();
  const invoicingEnabled = next === "completed" && requestedJob.servicePlanId && requestedJob.billable
    ? await hasUsableInvoicingCapability(actor.tenantId)
    : false;
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM jobs WHERE tenant_id = ${actor.tenantId} AND id = ${jobId} FOR UPDATE`);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.tenantId, actor.tenantId))).limit(1);
    if (!job) throw new DomainError("NOT_FOUND", "Job not found.", 404);
    const operation = context.fieldOperation ? await claimFieldOperation(tx, actor, context.fieldOperation) : null;
    if (operation?.replay) {
      const [priorInvoice] = next === "completed" ? await tx.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status })
        .from(invoiceItems).innerJoin(invoices, and(eq(invoices.id, invoiceItems.invoiceId), eq(invoices.tenantId, invoiceItems.tenantId)))
        .where(and(eq(invoiceItems.tenantId, actor.tenantId), eq(invoiceItems.jobId, jobId))).limit(1) : [];
      return { job, invoice: priorInvoice ?? null, duplicate: true, replay: true, resultState: operation.resultState };
    }
    if (context.expectedPriorState !== undefined && job.status !== context.expectedPriorState) {
      throw new DomainError("CONFLICT", "This job changed while it was offline. Review the current job before trying again.", 409,
        { expectedPriorState: context.expectedPriorState, currentState: job.status });
    }
    // A retried completion request should return the existing invoice instead of
    // creating a second financial record or failing after the first request won.
    if (next === "completed" && job.status === "completed") {
      const [priorInvoice] = await tx.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status })
        .from(invoiceItems).innerJoin(invoices, and(eq(invoices.id, invoiceItems.invoiceId), eq(invoices.tenantId, invoiceItems.tenantId)))
        .where(and(eq(invoiceItems.tenantId, actor.tenantId), eq(invoiceItems.jobId, jobId))).limit(1);
      if (operation) await completeFieldOperation(tx, actor, operation.receiptId, { kind: "job_transition", entityId: jobId, state: "completed" });
      return { job, invoice: priorInvoice ?? null, duplicate: true, replay: false, resultState: "completed" };
    }
    assertTransition("job", job.status, next, { reason: context.reason, requiredChecklist: next === "completed", completedChecklist: context.completedChecklist, proofRequired: false, proofProvided: context.proofProvided });
    const completionProof = next === "completed" && context.prepareCompletionProof
      ? await context.prepareCompletionProof(tx)
      : context.completionProof;
    const now = new Date();
    await tx.update(jobs).set({ status: next, actualStartedAt: next === "in_progress" && !job.actualStartedAt ? now : undefined, actualCompletedAt: next === "completed" ? now : undefined, skipReasonCode: next === "skipped" ? context.reason : undefined, customerSummary: next === "completed" ? context.note : undefined, updatedAt: now }).where(and(eq(jobs.id, jobId), eq(jobs.tenantId, actor.tenantId)));
    await tx.insert(jobStatusEvents).values({ tenantId: actor.tenantId, jobId, fromStatus: job.status, toStatus: next, reasonCode: context.reason, note: context.note, actorType: actor.kind, actorId: actor.userId });
    if (next === "completed" && completionProof) await tx.insert(completionProofs).values({ tenantId: actor.tenantId, jobId, completedAt: now, completedByMembershipId: completionProof.membershipId, summary: context.note, snapshot: { checklist: completionProof.checklist, fileId: completionProof.fileId, ...(completionProof.checklistSnapshot ? { checklistDefinition: completionProof.checklistSnapshot } : {}) } });
    await recordEvent(actor, { type: `job.${next}`, entityType: "job", entityId: jobId, payload: { customerId: job.customerId, from: job.status, to: next }, auditAction: `job.${next}`, before: { status: job.status }, after: { status: next }, locationId: job.organizationLocationId }, tx);
    const invoice = next === "completed" && invoicingEnabled && job.billable
      ? await issueCompletionInvoice(tx, actor, job, now)
      : null;
    if (operation) await completeFieldOperation(tx, actor, operation.receiptId, { kind: "job_transition", entityId: jobId, state: next });
    return { job: { ...job, status: next }, invoice, duplicate: false, replay: false, resultState: next };
  });
  let item: unknown = context.responseItem ? await context.responseItem() : normalized({ ...outcome.job, status: outcome.replay ? outcome.resultState ?? outcome.job.status : next });
  if (outcome.replay && context.responseItem && item && typeof item === "object" && outcome.resultState) {
    item = { ...(item as Record<string, unknown>), status: outcome.resultState };
  }
  return json({ item, ...(outcome.invoice ? { invoice: normalized(outcome.invoice) } : {}), ...(outcome.duplicate ? { duplicate: true } : {}) });
}

async function hasUsableInvoicingCapability(tenantId: string): Promise<boolean> {
  try {
    await requireTenantFeature(tenantId, "invoicing");
    return true;
  } catch (error) {
    if (error instanceof DomainError && error.code === "CAPABILITY_UNAVAILABLE") return false;
    throw error;
  }
}

function configuredForCompletionBilling(configuration: Record<string, unknown> | null | undefined): boolean {
  const type = configuration?.type;
  const timing = configuration?.timing;
  if (timing !== undefined) return timing === "on_completion";
  return type === "per_job" || type === "manual_invoice";
}

function snapshotAmount(snapshot: Record<string, unknown> | null | undefined): number | null {
  const result = snapshot?.result && typeof snapshot.result === "object" ? snapshot.result as Record<string, unknown> : null;
  for (const value of [snapshot?.totalMinor, snapshot?.amountMinor, result?.totalMinor]) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  }
  return null;
}

async function issueCompletionInvoice(
  tx: DbTransaction,
  actor: SessionActor,
  job: typeof jobs.$inferSelect,
  issuedAt: Date,
): Promise<{ id: string; invoiceNumber: string; status: string } | null> {
  if (!job.servicePlanId) return null;
  const [plan] = await tx.select().from(servicePlans).where(and(eq(servicePlans.tenantId, actor.tenantId), eq(servicePlans.id, job.servicePlanId))).limit(1);
  if (!plan || plan.customerId !== job.customerId || plan.serviceId !== job.serviceId || !configuredForCompletionBilling(plan.billingConfiguration)) return null;
  const amountMinor = snapshotAmount(job.priceSnapshot) ?? snapshotAmount(plan.pricingSnapshot);
  if (amountMinor === null || amountMinor <= 0) return null;
  const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, actor.tenantId), eq(customers.id, job.customerId))).limit(1);
  const [service] = await tx.select().from(services).where(and(eq(services.tenantId, actor.tenantId), eq(services.id, job.serviceId))).limit(1);
  const [tenant] = await tx.select({ name: tenants.name, currency: tenants.defaultCurrency }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
  if (!customer || !service || !tenant) return null;
  const snapshot = job.priceSnapshot ?? plan.pricingSnapshot;
  const priceResult = snapshot?.result && typeof snapshot.result === "object" ? snapshot.result as Record<string, unknown> : null;
  const subtotalMinor = typeof priceResult?.subtotalMinor === "number" && Number.isSafeInteger(priceResult.subtotalMinor)
    && priceResult.subtotalMinor >= 0 && priceResult.subtotalMinor + Number(priceResult.taxMinor) === amountMinor
    ? priceResult.subtotalMinor : amountMinor;
  const taxMinor = amountMinor - subtotalMinor;
  const snapshotCurrency = typeof (snapshot?.currency ?? priceResult?.currency) === "string" ? String(snapshot?.currency ?? priceResult?.currency).toUpperCase() : "";
  const currency = /^[A-Z]{3}$/.test(snapshotCurrency) ? snapshotCurrency : tenant.currency ?? "USD";
  const configuration = plan.billingConfiguration ?? {};
  const requestedNetDays = configuration.netDays;
  const netDays = typeof requestedNetDays === "number" && Number.isSafeInteger(requestedNetDays) && requestedNetDays > 0
    ? requestedNetDays
    : customer.paymentTermsDays && customer.paymentTermsDays > 0 ? customer.paymentTermsDays : null;
  const dueAt = netDays === null ? null : new Date(issuedAt.getTime() + netDays * 24 * 60 * 60 * 1000);
  const invoiceNumber = `INV-${issuedAt.getTime().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const description = service.name;
  const [invoice] = await tx.insert(invoices).values({
    tenantId: actor.tenantId, organizationId: job.organizationId, organizationLocationId: job.organizationLocationId,
    customerId: job.customerId, status: "issued", invoiceNumber, currency,
    issuedAt, dueAt, subtotalMinor: BigInt(subtotalMinor), discountMinor: 0n, taxMinor: BigInt(taxMinor),
    totalMinor: BigInt(amountMinor), paidMinor: 0n, balanceMinor: BigInt(amountMinor),
    billingSnapshot: {
      businessName: tenant.name, customerName: customer.displayName, description, serviceId: job.serviceId,
      jobId: job.id, servicePlanId: plan.id, billingConfiguration: configuration, priceSnapshot: snapshot,
      currency, subtotalMinor, taxMinor, totalMinor: amountMinor,
    },
  }).returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status });
  if (!invoice) throw new Error("Could not issue completion invoice");
  await tx.insert(invoiceItems).values({ tenantId: actor.tenantId, invoiceId: invoice.id, jobId: job.id, serviceId: job.serviceId, description, quantity: "1", unitAmountMinor: BigInt(subtotalMinor), taxMinor: BigInt(taxMinor), totalMinor: BigInt(amountMinor) });
  await recordEvent(actor, { type: "invoice.created", entityType: "invoice", entityId: invoice.id, payload: { jobId: job.id, invoiceNumber, totalMinor: amountMinor }, auditAction: "invoice.create_from_job", after: { jobId: job.id, invoiceNumber, totalMinor: amountMinor }, locationId: job.organizationLocationId }, tx);
  await recordEvent(actor, { type: "invoice.issued", entityType: "invoice", entityId: invoice.id, payload: { jobId: job.id, invoiceNumber, totalMinor: amountMinor }, auditAction: "invoice.issue", before: { status: "draft" }, after: { status: "issued", invoiceNumber, totalMinor: amountMinor }, locationId: job.organizationLocationId }, tx);
  return invoice;
}

async function invoiceAction(request: Request, actor: SessionActor, invoiceId: string, action: string): Promise<Response> {
  const db = getDb();
  const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, actor.tenantId))).limit(1);
  if (!invoice) throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
  if (actor.kind === "staff") {
    if (!actor.allLocations && (!invoice.organizationLocationId || !actor.locationIds.has(invoice.organizationLocationId))) throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
    requirePermission(actor, action === "issue" ? "invoices.issue" : "payments.collect");
  } else await assertCustomerDocumentAccess(actor, invoice.customerId, invoice.organizationLocationId);
  if (action === "issue") {
    if (actor.kind !== "staff") throw new DomainError("FORBIDDEN", "Staff access is required.", 403);
    const issued = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM invoices WHERE tenant_id = ${actor.tenantId} AND id = ${invoiceId} FOR UPDATE`);
      const [current] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, actor.tenantId))).limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
      assertTransition("invoice", current.status, "issued");
      const [saved] = await tx.update(invoices).set({ status: "issued", issuedAt: new Date(), updatedAt: new Date() }).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, actor.tenantId))).returning();
      await recordEvent(actor, { type: "invoice.issued", entityType: "invoice", entityId: invoiceId, auditAction: "invoice.issue", before: { status: current.status }, after: { status: "issued" }, locationId: current.organizationLocationId }, tx);
      return saved;
    });
    return json({ item: normalized(issued) });
  }
  if (action !== "pay") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  const body = await readBody(request, z.object({ amountCents: z.number().int().positive(), method: z.enum(["test", "manual"]).default("test"), fail: z.boolean().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional() }));
  if (actor.kind === "customer" && body.method !== "test") throw new DomainError("FORBIDDEN", "A customer payment must use the connected payment service.", 403);
  const clientKey = (request.headers.get("idempotency-key") ?? body.idempotencyKey)?.trim();
  if (!clientKey || clientKey.length > 200) throw new DomainError("VALIDATION_ERROR", "Provide a payment retry key.", 422);
  const idempotencyKey = `invoice:${invoiceId}:${clientKey}`;
  // Connector hydration reads the database; do it before the invoice transaction so local PGlite cannot deadlock.
  const capability = body.method === "test" ? await getCapability(actor.tenantId, "payments") : null;
  const outcome = await db.transaction(async (tx) => {
    // Lock the invoice before checking retries and its balance so concurrent payments cannot over-allocate.
    await tx.execute(sql`SELECT id FROM invoices WHERE tenant_id = ${actor.tenantId} AND id = ${invoiceId} FOR UPDATE`);
    const [current] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, actor.tenantId))).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
    const [prior] = await tx.select().from(payments).where(and(eq(payments.tenantId, actor.tenantId), eq(payments.idempotencyKey, idempotencyKey))).limit(1);
    if (prior) {
      if (prior.amountMinor !== BigInt(body.amountCents) || prior.sourceType !== (body.method === "manual" ? "manual" : "mock")) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This payment retry key was used for a different request.", 409);
      }
      return { payment: prior, duplicate: true, balanceCents: Number(current.balanceMinor) };
    }
    if (!["issued", "partially_paid", "overdue"].includes(current.status)) throw new DomainError("INVALID_TRANSITION", "This invoice is not ready for payment.", 409);
    if (body.amountCents > Number(current.balanceMinor)) throw new DomainError("VALIDATION_ERROR", "Payment exceeds the open balance.", 422);
    if (body.method === "test" && !capability) throw new DomainError("EXTERNAL_SERVICE_ERROR", "Connect test payments or record a manual payment.", 503);
    let status: "succeeded" | "failed" = "succeeded";
    let providerReference: string | null = null;
    if (capability) {
      const method = await capability.createPaymentMethod({ customerId: current.customerId, testToken: body.fail ? "decline" : "approved" });
      const charge = await capability.charge({ paymentMethodReference: method.reference, amountMinor: body.amountCents, currency: current.currency, idempotencyKey });
      status = charge.status;
      providerReference = charge.reference;
    }
    const [payment] = await tx.insert(payments).values({ tenantId: actor.tenantId, customerId: current.customerId, status, sourceType: body.method === "manual" ? "manual" : "mock", providerReference, amountMinor: BigInt(body.amountCents), currency: current.currency, receivedAt: status === "succeeded" ? new Date() : null, failureCode: status === "failed" ? "mock_declined" : null, failureMessage: status === "failed" ? "Test payment declined" : null, idempotencyKey, recordedByActorType: actor.kind, recordedByActorId: actor.userId }).returning();
    if (!payment) throw new Error("Could not record payment");
    let balanceCents = Number(current.balanceMinor);
    if (status === "succeeded") {
      await tx.insert(paymentAllocations).values({ tenantId: actor.tenantId, paymentId: payment.id, invoiceId, amountMinor: BigInt(body.amountCents) });
      const paidMinor = current.paidMinor + BigInt(body.amountCents);
      const allocations = await tx.select({ paymentId: paymentAllocations.paymentId }).from(paymentAllocations)
        .where(and(eq(paymentAllocations.tenantId, actor.tenantId), eq(paymentAllocations.invoiceId, invoiceId)));
      const paymentIds = allocations.map((allocation) => allocation.paymentId);
      const refundRows = paymentIds.length ? await tx.select({ amountMinor: refunds.amountMinor }).from(refunds)
        .where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.status, "succeeded"), inArray(refunds.paymentId, paymentIds))) : [];
      const creditRows = await tx.select({ amountMinor: creditAllocations.amountMinor }).from(creditAllocations)
        .where(and(eq(creditAllocations.tenantId, actor.tenantId), eq(creditAllocations.invoiceId, invoiceId)));
      const refundedMinor = refundRows.reduce((sum, row) => sum + row.amountMinor, 0n);
      const creditedMinor = creditRows.reduce((sum, row) => sum + row.amountMinor, 0n);
      const position = invoiceFinancialPosition(Number(current.totalMinor), Number(paidMinor), Number(refundedMinor), Number(creditedMinor));
      balanceCents = position.balanceCents;
      await tx.update(invoices).set({ paidMinor, balanceMinor: BigInt(balanceCents), status: position.status, updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, actor.tenantId)));
    }
    await recordEvent(actor, { type: status === "succeeded" ? "payment.succeeded" : "payment.failed", entityType: "payment", entityId: payment.id, payload: { invoiceId, customerId: current.customerId, amountCents: body.amountCents }, auditAction: `payment.${status}`, locationId: current.organizationLocationId }, tx);
    return { payment, duplicate: false, balanceCents };
  });
  return json({ item: normalized(outcome.payment), duplicate: outcome.duplicate, invoice: { id: invoiceId, balanceCents: outcome.balanceCents } });
}

async function servicePlanAction(actor: SessionActor, planId: string, action: string): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, action === "pause" || action === "resume" ? "service_plans.pause" : "service_plans.cancel");
  const db = getDb();
  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.tenantId, actor.tenantId))).limit(1);
  if (!plan || (!actor.allLocations && (!plan.organizationLocationId || !actor.locationIds.has(plan.organizationLocationId)))) throw new DomainError("NOT_FOUND", "Service plan not found.", 404);
  const next = action === "pause" ? "paused" : action === "resume" ? "active" : action === "cancel" ? "canceled" : "";
  if (!next) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM service_plans WHERE tenant_id = ${actor.tenantId} AND id = ${planId} FOR UPDATE`);
    const [current] = await tx.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.tenantId, actor.tenantId))).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "Service plan not found.", 404);
    assertTransition("servicePlan", current.status, next);
    const [saved] = await tx.update(servicePlans).set({ status: next, pauseFrom: next === "paused" ? new Date().toISOString().slice(0, 10) : null, pauseUntil: next === "active" ? null : undefined, canceledAt: next === "canceled" ? new Date() : undefined, updatedAt: new Date() }).where(and(eq(servicePlans.id, planId), eq(servicePlans.tenantId, actor.tenantId))).returning();
    await recordEvent(actor, { type: `service_plan.${next}`, entityType: "service_plan", entityId: planId, auditAction: `service_plan.${next}`, before: { status: current.status }, after: { status: next }, locationId: current.organizationLocationId }, tx);
    return saved;
  });
  return json({ item: normalized(updated) });
}

export async function handleWorkflow(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (request.method !== "POST" || path.length !== 3) return null;
  const [resource, id, action] = path;
  if (!id || !action) return null;
  if (resource === "leads" && action === "convert") return json({ item: normalized(await convertLead(actor, id)) });
  if (resource === "estimates" && ["send", "approve", "decline"].includes(action)) return estimateAction(request, actor, id, action);
  if (resource === "jobs" && action === "assign") return assignJob(request, actor, id);
  if (resource === "jobs" && action === "transition") {
    const body = await readBody(request, z.object({ status: z.string(), reason: z.string().optional(), note: z.string().optional(), completedChecklist: z.boolean().optional(), proofProvided: z.boolean().optional(), clientOperationId: z.uuid().optional(), deviceTimestamp: z.iso.datetime({ offset: true }).optional(), expectedPriorState: z.string().min(1).max(40).optional() }));
    if (body.status === "completed") throw new DomainError("VALIDATION_ERROR", "Complete the job using the field checklist.", 422);
    return transitionJob(actor, id, body.status, {
      ...body,
      ...(actor.kind === "staff" && actor.role === "technician" ? { fieldOperation: { action: `job.transition.${body.status}`, target: id, clientOperationId: body.clientOperationId, payload: body, deviceTimestamp: body.deviceTimestamp ? new Date(body.deviceTimestamp) : null } } : {}),
    });
  }
  if (resource === "invoices" && ["issue", "pay"].includes(action)) return invoiceAction(request, actor, id, action);
  if (resource === "service-plans" && ["pause", "resume", "cancel"].includes(action)) return servicePlanAction(actor, id, action);
  return null;
}

export { invoiceAction, estimateAction };
