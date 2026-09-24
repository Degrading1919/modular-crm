import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  completionProofs, creditAllocations, creditMemos, customerCredits, customers, estimateApprovals,
  estimateItems, estimateRevisions, estimates, fileLinks, files, franchiseAgreements, invoiceItems, invoices,
  jobAssignments, jobs, memberships, organizationLocations, organizations, paymentAllocations,
  payments, payrollCalculations, payrollComponents, payrollPeriods, refunds, royaltyStatements,
  serviceLocations, servicePlans, services, user,
} from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { getDb } from "../db";
import { assertCustomerDocumentAccess, assertCustomerServiceLocationAccess, requireStaff, type SessionActor } from "./actor";
import { apiError, json } from "./http";
import { payrollSnapshotInLocationScope } from "./payroll";

export type DocumentKind = "invoice" | "receipt" | "statement" | "completion" | "estimate" | "pay-statement" | "royalty-statement";
export type DocumentLine = { description: string; quantity?: string | number | null; amountMinor?: number | string | bigint | null; totalMinor?: number | string | bigint | null; currency?: string | null };
export type CustomerDocument = {
  kind: DocumentKind; title: string; number: string; date: string | null; status: string | null;
  business: { name: string; email?: string | null; phone?: string | null; address?: string | null };
  customer?: { name: string; email?: string | null; address?: string | null };
  summary?: string | null; lines: DocumentLine[]; proofPhotoUrl?: string | null;
  totals: { label: string; amountMinor: number | string | bigint; currency?: string | null }[];
  terms?: string | null; period?: { start: string; end: string };
};

const kinds = new Set<DocumentKind>(["invoice", "receipt", "statement", "completion", "estimate", "pay-statement", "royalty-statement"]);
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string | null => typeof value === "string" ? value : null;
const amount = (value: unknown): number => Number(value ?? 0);
const dateText = (value: Date | string | null | undefined): string | null => value ? new Date(value).toISOString().slice(0, 10) : null;
const notFound = (): never => { throw new DomainError("NOT_FOUND", "Document not found.", 404); };
function requireDocumentPermission(actor: SessionActor, permission: Parameters<typeof requirePermission>[1]) {
  if (actor.kind === "staff") requirePermission(actor, permission);
}

function staffLocationAllowed(actor: SessionActor, locationId: string | null) {
  requireStaff(actor);
  if (!actor.allLocations && (!locationId || !actor.locationIds.has(locationId))) notFound();
}

async function authorizeCustomer(actor: SessionActor, customerId: string, branchId: string | null, serviceLocationId?: string | null) {
  if (actor.kind === "customer") {
    if (serviceLocationId) {
      await assertCustomerServiceLocationAccess(actor, customerId, serviceLocationId);
      const [location] = await getDb().select({ customerId: serviceLocations.customerId, organizationLocationId: serviceLocations.organizationLocationId })
        .from(serviceLocations).where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.id, serviceLocationId))).limit(1);
      if (!location || location.customerId !== customerId || (branchId && location.organizationLocationId !== branchId)) notFound();
    }
    else if (branchId) await assertCustomerDocumentAccess(actor, customerId, branchId);
    else {
      const permittedLocationIds = [...(actor.customerLocationIds.get(customerId) ?? [])];
      if (!actor.customerIds.has(customerId) || permittedLocationIds.length === 0) notFound();
      const [visible] = await getDb().select({ id: serviceLocations.id }).from(serviceLocations)
        .where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.customerId, customerId), inArray(serviceLocations.id, [...permittedLocationIds]))).limit(1);
      if (!visible) notFound();
    }
    return;
  }
  if (serviceLocationId) {
    const [location] = await getDb().select({ customerId: serviceLocations.customerId, organizationLocationId: serviceLocations.organizationLocationId })
      .from(serviceLocations).where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.id, serviceLocationId))).limit(1);
    if (!location || location.customerId !== customerId || (branchId && location.organizationLocationId !== branchId)) notFound();
    staffLocationAllowed(actor, location.organizationLocationId ?? branchId);
  } else staffLocationAllowed(actor, branchId);
}

/** An invoice can aggregate work at several properties. A customer may only read it when every job line is at a granted property. */
async function authorizeInvoice(actor: SessionActor, invoiceId: string, customerId: string, branchId: string | null, billingSnapshot?: unknown) {
  await authorizeCustomer(actor, customerId, branchId);
  const db = getDb();
  const locations = await db.select({
    customerId: jobs.customerId,
    serviceLocationId: jobs.serviceLocationId,
    organizationLocationId: jobs.organizationLocationId,
  }).from(invoiceItems).innerJoin(jobs, and(
    eq(jobs.id, invoiceItems.jobId), eq(jobs.tenantId, invoiceItems.tenantId),
  )).where(and(
    eq(invoiceItems.tenantId, actor.tenantId), eq(invoiceItems.invoiceId, invoiceId),
  ));
  for (const location of locations) {
    if (location.customerId !== customerId) notFound();
    await authorizeCustomer(actor, customerId, location.organizationLocationId, location.serviceLocationId);
  }
  const servicePlanId = str(obj(billingSnapshot).servicePlanId);
  if (servicePlanId) {
    const [plan] = await db.select({ customerId: servicePlans.customerId, serviceLocationId: servicePlans.serviceLocationId, organizationLocationId: servicePlans.organizationLocationId })
      .from(servicePlans).where(and(eq(servicePlans.tenantId, actor.tenantId), eq(servicePlans.id, servicePlanId))).limit(1);
    if (!plan || plan.customerId !== customerId) notFound();
    await authorizeCustomer(actor, customerId, plan.organizationLocationId, plan.serviceLocationId);
  }
}

function branding(name: string, email?: string | null, phone?: string | null, address?: Record<string, unknown> | null) {
  const parts = address ? [address.line1, address.line2, address.city, address.region, address.postalCode].filter((part) => typeof part === "string") : [];
  return { name, email, phone, address: parts.length ? parts.join(", ") : null };
}

async function invoiceDocument(actor: SessionActor, id: string): Promise<CustomerDocument> {
  requireDocumentPermission(actor, "invoices.read");
  const db = getDb();
  const [row] = await db.select({ invoice: invoices, business: organizations, branch: organizationLocations, customer: customers })
    .from(invoices).innerJoin(organizations, and(eq(organizations.id, invoices.organizationId), eq(organizations.tenantId, invoices.tenantId)))
    .leftJoin(organizationLocations, and(eq(organizationLocations.id, invoices.organizationLocationId), eq(organizationLocations.tenantId, invoices.tenantId)))
    .innerJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.tenantId, invoices.tenantId)))
    .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, id))).limit(1);
  if (!row) notFound();
  await authorizeInvoice(actor, id, row.invoice.customerId, row.invoice.organizationLocationId, row.invoice.billingSnapshot);
  const snapshot = obj(row.invoice.billingSnapshot);
  const snapshotBusiness = obj(snapshot.business);
  const snapshotCustomer = obj(snapshot.customer);
  const linesSnapshot = Array.isArray(snapshot.items) ? snapshot.items : null;
  const itemRows = linesSnapshot ? [] : await db.select().from(invoiceItems)
    .where(and(eq(invoiceItems.tenantId, actor.tenantId), eq(invoiceItems.invoiceId, id))).orderBy(asc(invoiceItems.sortOrder));
  const lines = linesSnapshot ? linesSnapshot.map((line) => {
    const item = obj(line);
    return { description: str(item.description) ?? "Service", quantity: (item.quantity as string | number | undefined) ?? null, amountMinor: item.unitAmountMinor as number | string | null, totalMinor: item.totalMinor as number | string | null };
  }) : itemRows.map((line) => ({ description: line.description, quantity: line.quantity, amountMinor: line.unitAmountMinor, totalMinor: line.totalMinor }));
  const company = branding(str(snapshotBusiness.name) ?? str(snapshot.businessName) ?? row.business.displayName, str(snapshotBusiness.email) ?? row.business.email, str(snapshotBusiness.phone) ?? row.business.phone, obj(snapshotBusiness.address));
  const customer = { name: str(snapshotCustomer.name) ?? str(snapshot.customerName) ?? row.customer.displayName, email: str(snapshotCustomer.email) ?? row.customer.billingEmail, address: str(snapshotCustomer.address) };
  return { kind: "invoice", title: "Invoice", number: row.invoice.invoiceNumber, date: dateText(row.invoice.issuedAt) ?? dateText(row.invoice.createdAt), status: row.invoice.status, business: company,
    customer, summary: str(snapshot.description) ?? str(snapshot.service), lines,
    totals: [
      { label: "Subtotal", amountMinor: row.invoice.subtotalMinor ?? 0, currency: row.invoice.currency },
      ...(amount(row.invoice.discountMinor) ? [{ label: "Discount", amountMinor: -amount(row.invoice.discountMinor), currency: row.invoice.currency }] : []),
      ...(amount(row.invoice.taxMinor) ? [{ label: "Tax", amountMinor: row.invoice.taxMinor ?? 0, currency: row.invoice.currency }] : []),
      { label: "Total", amountMinor: row.invoice.totalMinor ?? amount(snapshot.totalCents), currency: row.invoice.currency },
      { label: "Paid", amountMinor: row.invoice.paidMinor ?? 0, currency: row.invoice.currency },
      { label: "Balance due", amountMinor: row.invoice.balanceMinor ?? 0, currency: row.invoice.currency },
    ], terms: row.invoice.termsSnapshot };
}

async function receiptDocument(actor: SessionActor, id: string): Promise<CustomerDocument> {
  requireDocumentPermission(actor, "payments.read");
  const db = getDb();
  const [row] = await db.select({ payment: payments, customer: customers }).from(payments)
    .innerJoin(customers, and(eq(customers.id, payments.customerId), eq(customers.tenantId, payments.tenantId)))
    .where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, id))).limit(1);
  if (!row) notFound();
  const allocations = await db.select({ allocation: paymentAllocations, invoice: invoices })
    .from(paymentAllocations).innerJoin(invoices, and(eq(invoices.id, paymentAllocations.invoiceId), eq(invoices.tenantId, paymentAllocations.tenantId)))
    .where(and(eq(paymentAllocations.tenantId, actor.tenantId), eq(paymentAllocations.paymentId, id)));
  const allowed = [] as typeof allocations;
  for (const item of allocations) {
    if (item.invoice.customerId !== row.payment.customerId) notFound();
    try { await authorizeInvoice(actor, item.invoice.id, row.payment.customerId, item.invoice.organizationLocationId, item.invoice.billingSnapshot); allowed.push(item); } catch { /* Filter location-scoped allocations. */ }
  }
  if (allowed.length !== allocations.length) notFound();
  if (!["succeeded", "refunded", "partially_refunded"].includes(row.payment.status)) notFound();
  if (actor.kind === "customer" && allowed.length === 0) await authorizeCustomer(actor, row.payment.customerId, null);
  else if (actor.kind === "staff" && allowed.length === 0) {
    const [customer] = await db.select({ owningLocationId: customers.owningLocationId }).from(customers)
      .where(and(eq(customers.id, row.payment.customerId), eq(customers.tenantId, actor.tenantId))).limit(1);
    staffLocationAllowed(actor, customer?.owningLocationId ?? null);
  }
  const [org] = await db.select().from(organizations).where(eq(organizations.tenantId, actor.tenantId)).limit(1);
  return { kind: "receipt", title: "Payment receipt", number: `RCPT-${row.payment.id.slice(0, 8).toUpperCase()}`, date: dateText(row.payment.receivedAt) ?? dateText(row.payment.createdAt), status: row.payment.status,
    business: branding(org?.displayName ?? actor.tenantName, org?.email, org?.phone), customer: { name: row.customer.displayName, email: row.customer.billingEmail },
    lines: [{ description: "Payment received", amountMinor: row.payment.amountMinor }],
    totals: [{ label: "Amount paid", amountMinor: row.payment.amountMinor ?? 0, currency: row.payment.currency }],
    summary: allocations.length ? `Applied to ${allocations.map((item) => item.invoice.invoiceNumber).join(", ")}` : null };
}

export function statementPeriod(value?: string, now = new Date()): { start: string; end: string } {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;
  if (month < 1 || month > 12 || year < 1 || year > 9999) throw new DomainError("VALIDATION_ERROR", "Choose a valid statement month.", 400);
  const start = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

async function statementDocument(actor: SessionActor, customerId: string, selectedPeriod?: string): Promise<CustomerDocument> {
  requireDocumentPermission(actor, "invoices.read");
  requireDocumentPermission(actor, "payments.read");
  const db = getDb();
  const [customer] = await db.select().from(customers).where(and(eq(customers.tenantId, actor.tenantId), eq(customers.id, customerId))).limit(1);
  if (!customer) notFound();
  const period = statementPeriod(selectedPeriod);
  const invoiceRows = await db.select().from(invoices).where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.customerId, customerId))).orderBy(asc(invoices.issuedAt));
  const visibleInvoices = [] as typeof invoiceRows;
  for (const invoice of invoiceRows) {
    try { await authorizeInvoice(actor, invoice.id, customerId, invoice.organizationLocationId, invoice.billingSnapshot); visibleInvoices.push(invoice); } catch { /* Preserve location scope. */ }
  }
  if (!visibleInvoices.length) {
    if (actor.kind === "staff") staffLocationAllowed(actor, customer.owningLocationId);
    else await authorizeCustomer(actor, customerId, null);
  }
  const visibleIds = visibleInvoices.map((invoice) => invoice.id);
  const allocations = visibleIds.length ? await db.select({ allocation: paymentAllocations, payment: payments }).from(paymentAllocations)
    .innerJoin(payments, and(eq(payments.id, paymentAllocations.paymentId), eq(payments.tenantId, paymentAllocations.tenantId)))
    .where(and(eq(paymentAllocations.tenantId, actor.tenantId), eq(payments.customerId, customerId), inArray(paymentAllocations.invoiceId, visibleIds))) : [];
  const credits = visibleIds.length ? await db.select({ allocation: creditAllocations, credit: customerCredits }).from(creditAllocations)
    .innerJoin(customerCredits, and(eq(customerCredits.id, creditAllocations.customerCreditId), eq(customerCredits.tenantId, creditAllocations.tenantId)))
    .where(and(eq(creditAllocations.tenantId, actor.tenantId), eq(customerCredits.customerId, customerId), inArray(creditAllocations.invoiceId, visibleIds))) : [];
  const periodStart = period.start;
  const dateOf = (value: Date | string | null | undefined) => dateText(value) ?? "";
  const inPeriod = (date: string) => date >= period.start && date <= period.end;
  const paymentIds = [...new Set(allocations.filter(({ payment }) => ["succeeded", "refunded", "partially_refunded"].includes(payment.status)).map(({ payment }) => payment.id))];
  const refundRows = paymentIds.length ? await db.select({ refund: refunds, payment: payments }).from(refunds)
    .innerJoin(payments, and(eq(payments.id, refunds.paymentId), eq(payments.tenantId, refunds.tenantId)))
    .where(and(eq(refunds.tenantId, actor.tenantId), inArray(refunds.paymentId, paymentIds), eq(refunds.status, "succeeded"))) : [];
  const memos = await db.select().from(creditMemos).where(and(eq(creditMemos.tenantId, actor.tenantId), eq(creditMemos.customerId, customerId), eq(creditMemos.status, "issued")));
  const allowedMemos = [] as typeof memos;
  for (const memo of memos) {
    if (memo.invoiceId && !visibleIds.includes(memo.invoiceId)) continue;
    allowedMemos.push(memo);
  }
  const events: { date: string; description: string; amount: number; currency: string }[] = [
    ...visibleInvoices.filter((invoice) => !["void", "voided", "draft"].includes(invoice.status) && !invoice.voidedAt).map((invoice) => ({ date: dateOf(invoice.issuedAt ?? invoice.createdAt), description: `Invoice ${invoice.invoiceNumber}`, amount: amount(invoice.totalMinor), currency: invoice.currency ?? "USD" })),
    ...allocations.filter(({ payment }) => ["succeeded", "refunded", "partially_refunded"].includes(payment.status)).map(({ payment, allocation }) => ({ date: dateOf(payment.receivedAt ?? payment.createdAt), description: `Payment ${dateOf(payment.receivedAt ?? payment.createdAt)}`, amount: -amount(allocation.amountMinor), currency: payment.currency ?? "USD" })),
    ...credits.map(({ credit, allocation }) => ({ date: dateOf(allocation.allocatedAt), description: `Credit applied (${credit.sourceType})`, amount: -amount(allocation.amountMinor), currency: credit.currency ?? "USD" })),
    ...allowedMemos.map((memo) => ({ date: dateOf(memo.issuedAt), description: `Credit memo: ${memo.reason}`, amount: -amount(memo.amountMinor), currency: memo.currency ?? "USD" })),
  ];
  for (const { refund, payment } of refundRows) {
    const paymentAllocationsForStatement = allocations.filter((item) => item.payment.id === payment.id);
    const allAllocationRows = await db.select().from(paymentAllocations).where(and(eq(paymentAllocations.tenantId, actor.tenantId), eq(paymentAllocations.paymentId, payment.id)));
    const allAllocated = allAllocationRows.reduce((sum, item) => sum + amount(item.amountMinor), 0);
    const visibleAllocated = paymentAllocationsForStatement.reduce((sum, item) => sum + amount(item.allocation.amountMinor), 0);
    const visibleRefund = allAllocated > 0 ? Math.round(amount(refund.amountMinor) * visibleAllocated / allAllocated) : 0;
    events.push({ date: dateOf(refund.completedAt ?? refund.createdAt), description: `Refund ${dateOf(refund.completedAt ?? refund.createdAt)}`, amount: visibleRefund, currency: payment.currency ?? refund.currency ?? "USD" });
  }
  const currencies = [...new Set(events.map((event) => event.currency))];
  if (!currencies.length) currencies.push(visibleInvoices[0]?.currency ?? "USD");
  const openingByCurrency = new Map(currencies.map((currency) => [currency, events.filter((event) => event.currency === currency && event.date && event.date < periodStart).reduce((sum, event) => sum + event.amount, 0)]));
  const periodEvents = events.filter((event) => inPeriod(event.date));
  const activityByCurrency = new Map(currencies.map((currency) => [currency, periodEvents.filter((event) => event.currency === currency).reduce((sum, event) => sum + event.amount, 0)]));
  const lines: DocumentLine[] = periodEvents.map((event) => ({ description: event.description, amountMinor: event.amount, totalMinor: event.amount, currency: event.currency }));
  const balanceTotals = currencies.flatMap((currency) => {
    const opening = openingByCurrency.get(currency) ?? 0;
    const activity = activityByCurrency.get(currency) ?? 0;
    const suffix = currencies.length > 1 ? ` (${currency})` : "";
    return [
      { label: `Opening balance${suffix}`, amountMinor: opening, currency },
      { label: `Period activity${suffix}`, amountMinor: activity, currency },
      { label: `Closing balance${suffix}`, amountMinor: opening + activity, currency },
    ];
  });
  const [org] = await db.select().from(organizations).where(eq(organizations.tenantId, actor.tenantId)).limit(1);
  return { kind: "statement", title: "Account statement", number: `STMT-${period.start}`, date: period.end, status: "issued",
    business: branding(org?.displayName ?? actor.tenantName, org?.email, org?.phone), customer: { name: customer.displayName, email: customer.billingEmail }, lines, period,
    totals: balanceTotals };
}

async function completionDocument(actor: SessionActor, id: string): Promise<CustomerDocument> {
  requireDocumentPermission(actor, "jobs.read");
  const db = getDb();
  const [job] = await db.select({ job: jobs, customer: customers, location: serviceLocations, service: services, business: organizations })
    .from(jobs).innerJoin(customers, and(eq(customers.id, jobs.customerId), eq(customers.tenantId, jobs.tenantId)))
    .innerJoin(serviceLocations, and(eq(serviceLocations.id, jobs.serviceLocationId), eq(serviceLocations.tenantId, jobs.tenantId)))
    .innerJoin(services, and(eq(services.id, jobs.serviceId), eq(services.tenantId, jobs.tenantId)))
    .innerJoin(organizations, and(eq(organizations.id, jobs.organizationId), eq(organizations.tenantId, jobs.tenantId)))
    .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, id))).limit(1);
  if (!job) notFound();
  await authorizeCustomer(actor, job.job.customerId, job.job.organizationLocationId, job.job.serviceLocationId);
  if (actor.kind === "staff" && actor.role === "technician") {
    const [assignment] = await db.select({ id: jobAssignments.id }).from(jobAssignments).where(and(
      eq(jobAssignments.tenantId, actor.tenantId), eq(jobAssignments.jobId, id), eq(jobAssignments.membershipId, actor.membershipId!), isNull(jobAssignments.removedAt),
    )).limit(1);
    if (!assignment) notFound();
  }
  if (job.job.status !== "completed") notFound();
  const [proof] = await db.select().from(completionProofs).where(and(eq(completionProofs.tenantId, actor.tenantId), eq(completionProofs.jobId, id))).orderBy(desc(completionProofs.completedAt)).limit(1);
  const snapshot = obj(proof?.snapshot);
  const checklist = Array.isArray(snapshot.checklist) ? snapshot.checklist.filter((item): item is string => typeof item === "string")
    : Object.entries(obj(snapshot.checklist)).filter(([, completed]) => completed === true)
      .map(([key]) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()));
  const photoId = str(snapshot.fileId);
  const [proofPhoto] = photoId ? await db.select({ id: files.id }).from(files)
    .innerJoin(fileLinks, and(eq(fileLinks.fileId, files.id), eq(fileLinks.tenantId, files.tenantId)))
    .where(and(eq(files.tenantId, actor.tenantId), eq(files.id, photoId), eq(files.visibility, "customer"),
      eq(fileLinks.entityType, "job"), eq(fileLinks.entityId, id), eq(fileLinks.purpose, "proof"))).limit(1) : [];
  return { kind: "completion", title: "Service completion report", number: `JOB-${id.slice(0, 8).toUpperCase()}`, date: dateText(proof?.completedAt ?? job.job.actualCompletedAt), status: "completed",
    business: branding(job.business.displayName, job.business.email, job.business.phone), customer: { name: job.customer.displayName },
    summary: job.job.customerSummary ?? proof?.summary ?? "Service completed.", lines: checklist.map((item) => ({ description: item })),
    proofPhotoUrl: proofPhoto ? `/api/v1/files/${proofPhoto.id}/download` : null,
    totals: [], period: { start: dateText(job.job.scheduledDate) ?? "", end: dateText(proof?.completedAt ?? job.job.actualCompletedAt) ?? "" } };
}

async function estimateDocument(actor: SessionActor, id: string): Promise<CustomerDocument> {
  requireDocumentPermission(actor, "estimates.read");
  const db = getDb();
  const [estimate] = await db.select().from(estimates).where(and(eq(estimates.tenantId, actor.tenantId), eq(estimates.id, id))).limit(1);
  if (!estimate) notFound();
  if (actor.kind === "customer" && estimate.status === "draft") notFound();
  const customerId = estimate.customerId ?? notFound();
  await authorizeCustomer(actor, customerId, estimate.organizationLocationId, estimate.serviceLocationId);
  const [approval] = await db.select().from(estimateApprovals).where(and(eq(estimateApprovals.tenantId, actor.tenantId), eq(estimateApprovals.estimateId, id), eq(estimateApprovals.decision, "approved"))).orderBy(desc(estimateApprovals.occurredAt)).limit(1);
  const revisionNumber = approval ? (await db.select({ revisionNumber: estimateRevisions.revisionNumber }).from(estimateRevisions).where(and(eq(estimateRevisions.tenantId, actor.tenantId), eq(estimateRevisions.id, approval.estimateRevisionId))).limit(1))[0]?.revisionNumber : estimate.currentRevision;
  if (!revisionNumber) notFound();
  const [revision] = await db.select().from(estimateRevisions).where(and(eq(estimateRevisions.tenantId, actor.tenantId), eq(estimateRevisions.estimateId, id), eq(estimateRevisions.revisionNumber, revisionNumber))).limit(1);
  if (!revision) notFound();
  const lines = await db.select().from(estimateItems).where(and(eq(estimateItems.tenantId, actor.tenantId), eq(estimateItems.estimateRevisionId, revision.id))).orderBy(asc(estimateItems.sortOrder));
  const [customer] = await db.select().from(customers).where(and(eq(customers.tenantId, actor.tenantId), eq(customers.id, customerId))).limit(1);
  const [org] = await db.select().from(organizations).where(and(eq(organizations.tenantId, actor.tenantId))).limit(1);
  return { kind: "estimate", title: "Estimate", number: `EST-${id.slice(0, 8).toUpperCase()} · Revision ${revision.revisionNumber}`, date: dateText(revision.sentAt ?? revision.createdAt), status: approval ? "approved" : estimate.status,
    business: branding(org?.displayName ?? actor.tenantName, org?.email, org?.phone), customer: { name: str(obj(revision.snapshot).customerName) ?? customer?.displayName ?? "Customer" },
    summary: str(obj(revision.snapshot).service), lines: lines.map((line) => ({ description: line.description, quantity: line.quantity, amountMinor: line.unitAmountMinor, totalMinor: line.totalMinor })),
    totals: [{ label: "Subtotal", amountMinor: revision.subtotalMinor ?? 0, currency: estimate.currency }, ...(amount(revision.discountMinor) ? [{ label: "Discount", amountMinor: -amount(revision.discountMinor), currency: estimate.currency }] : []), ...(amount(revision.taxMinor) ? [{ label: "Tax", amountMinor: revision.taxMinor ?? 0, currency: estimate.currency }] : []), { label: "Total", amountMinor: revision.totalMinor ?? 0, currency: estimate.currency }], terms: revision.termsText };
}

async function payStatement(actor: SessionActor, id: string): Promise<CustomerDocument> {
  requireStaff(actor);
  const db = getDb();
  const [row] = await db.select({ calculation: payrollCalculations, period: payrollPeriods, member: memberships, staff: user })
    .from(payrollCalculations).innerJoin(payrollPeriods, and(eq(payrollPeriods.id, payrollCalculations.payrollPeriodId), eq(payrollPeriods.tenantId, payrollCalculations.tenantId)))
    .innerJoin(memberships, and(eq(memberships.id, payrollCalculations.membershipId), eq(memberships.tenantId, payrollCalculations.tenantId)))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(payrollCalculations.tenantId, actor.tenantId), eq(payrollCalculations.id, id), inArray(payrollPeriods.status, ["approved", "exported"]))).orderBy(desc(payrollCalculations.version)).limit(1);
  if (!row) notFound();
  if (row.calculation.membershipId !== actor.membershipId) {
    requirePermission(actor, "payroll.read");
    if (row.period.organizationId !== actor.organizationId) notFound();
  } else requirePermission(actor, "time.own_read");
  if (!payrollSnapshotInLocationScope(row.calculation.calculationSnapshot, actor.allLocations, actor.locationIds)) notFound();
  const components = await db.select().from(payrollComponents).where(and(eq(payrollComponents.tenantId, actor.tenantId), eq(payrollComponents.payrollCalculationId, id)));
  return { kind: "pay-statement", title: "Pay statement", number: `PAY-${row.period.periodEnd}-${row.calculation.membershipId.slice(0, 6)}`, date: dateText(row.calculation.calculatedAt), status: row.period.status,
    business: branding(actor.tenantName), customer: { name: row.staff.name, email: row.staff.email }, period: { start: row.period.periodStart, end: row.period.periodEnd },
    lines: components.map((component) => ({ description: component.description, amountMinor: component.amountMinor, totalMinor: component.amountMinor })),
    totals: [{ label: "Gross pay", amountMinor: row.calculation.grossAmountMinor ?? 0, currency: row.calculation.currency }] };
}

async function royaltyDocument(actor: SessionActor, id: string): Promise<CustomerDocument> {
  requireStaff(actor);
  requirePermission(actor, "reports.franchise_read");
  const db = getDb();
  const [row] = await db.select({ statement: royaltyStatements, agreement: franchiseAgreements })
    .from(royaltyStatements).innerJoin(franchiseAgreements, and(eq(franchiseAgreements.id, royaltyStatements.franchiseAgreementId), eq(franchiseAgreements.tenantId, royaltyStatements.tenantId)))
    .where(and(eq(royaltyStatements.tenantId, actor.tenantId), eq(royaltyStatements.id, id), or(eq(franchiseAgreements.parentOrganizationId, actor.organizationId!), eq(franchiseAgreements.childOrganizationId, actor.organizationId!))))
    .limit(1);
  if (!row) notFound();
  return { kind: "royalty-statement", title: "Royalty statement", number: `ROY-${id.slice(0, 8).toUpperCase()}`, date: dateText(row.statement.issuedAt ?? row.statement.createdAt), status: row.statement.status,
    business: branding(actor.tenantName), period: { start: row.statement.periodStart, end: row.statement.periodEnd }, lines: [{ description: "Royalty basis", amountMinor: row.statement.basisAmountMinor }, { description: "Royalty due", amountMinor: row.statement.royaltyAmountMinor }],
    totals: [{ label: "Royalty due", amountMinor: row.statement.royaltyAmountMinor ?? 0, currency: row.statement.currency }] };
}

export async function getDocument(actor: SessionActor, kind: string, id: string, options: { period?: string } = {}): Promise<CustomerDocument> {
  if (!kinds.has(kind as DocumentKind) || !id) notFound();
  switch (kind as DocumentKind) {
    case "invoice": return invoiceDocument(actor, id);
    case "receipt": return receiptDocument(actor, id);
    case "statement": return statementDocument(actor, id, options.period);
    case "completion": return completionDocument(actor, id);
    case "estimate": return estimateDocument(actor, id);
    case "pay-statement": return payStatement(actor, id);
    case "royalty-statement": return royaltyDocument(actor, id);
  }
}

/** Hook for apps/web/lib/api/handler.ts: mount at GET /documents/:kind/:id. */
export async function handleDocuments(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "documents") return null;
  if (request.method !== "GET" || path.length !== 3) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  try {
    const item = await getDocument(actor, path[1]!, path[2]!, { period: new URL(request.url).searchParams.get("period") ?? undefined });
    const safeItem = JSON.parse(JSON.stringify(item, (_key, value) => typeof value === "bigint" ? Number(value) : value));
    return json({ item: safeItem });
  }
  catch (error) { return apiError(error); }
}
