import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  auditEvents, customerChangeRequests, customers, domainEvents, memberships, organizationLocations,
  portalAccess, portalLocationAccess, serviceLocations, servicePlans, user, verification,
} from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { auth } from "../auth";
import { getDb } from "../db";
import { type SessionActor, requireStaff } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized, uuidArray } from "./sql";
import { sendDevelopmentEmail } from "../mail";
import { z } from "zod";

const grantSchema = z.object({ email: z.email(), name: z.string().min(2).max(120).optional(), serviceLocationIds: z.array(z.uuid()).min(1) });
const resolutionSchema = z.object({ reason: z.string().max(1000).optional(), effectiveDate: z.iso.date().optional() });

function assertStaff(actor: SessionActor, permission: "customers.read" | "customers.update"): asserts actor is Extract<SessionActor, { kind: "staff" }> {
  requireStaff(actor);
  requirePermission(actor, permission);
}

function assertBranch(actor: Extract<SessionActor, { kind: "staff" }>, branchId: string | null | undefined) {
  if (!actor.allLocations && (!branchId || !actor.locationIds.has(branchId))) {
    throw new DomainError("NOT_FOUND", "Record not found.", 404);
  }
}

function digest(token: string) { return createHash("sha256").update(token).digest("hex"); }

function safeDigestEqual(actual: string, expected: string) {
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function customerPortalAccess(actor: SessionActor, customerId: string) {
  assertStaff(actor, "customers.read");
  const staff = actor as Extract<SessionActor, { kind: "staff" }>;
  const db = getDb();
  const [customer] = await db.select({ id: customers.id, branchId: customers.owningLocationId }).from(customers)
    .where(and(eq(customers.tenantId, actor.tenantId), eq(customers.id, customerId))).limit(1);
  if (!customer) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
  assertBranch(actor, customer.branchId);
  const accesses = await db.select({ access: portalAccess, email: user.email, name: user.name })
    .from(portalAccess).innerJoin(user, eq(user.id, portalAccess.userId))
    .where(and(eq(portalAccess.tenantId, actor.tenantId), eq(portalAccess.customerId, customerId)));
  const grants = accesses.length ? await db.select({ portalAccessId: portalLocationAccess.portalAccessId, serviceLocationId: portalLocationAccess.serviceLocationId, branchId: serviceLocations.organizationLocationId })
    .from(portalLocationAccess).innerJoin(portalAccess, and(eq(portalAccess.id, portalLocationAccess.portalAccessId), eq(portalAccess.tenantId, portalLocationAccess.tenantId), eq(portalAccess.customerId, customerId)))
    .innerJoin(serviceLocations, and(eq(serviceLocations.id, portalLocationAccess.serviceLocationId), eq(serviceLocations.tenantId, portalLocationAccess.tenantId), eq(serviceLocations.customerId, portalAccess.customerId)))
    .where(and(eq(portalLocationAccess.tenantId, actor.tenantId), inArray(portalLocationAccess.portalAccessId, accesses.map(({ access }) => access.id)))) : [];
  const visibleGrants = grants.filter((grant) => staff.allLocations || (!!grant.branchId && staff.locationIds.has(grant.branchId)));
  const visibleAccessIds = new Set(visibleGrants.map((grant) => grant.portalAccessId));
  const items = accesses.filter(({ access }) => visibleAccessIds.has(access.id)).map(({ access, email, name }) => ({
    ...access, email, name,
    serviceLocationIds: visibleGrants.filter((grant) => grant.portalAccessId === access.id).map((grant) => grant.serviceLocationId),
  }));
  return json({ items: normalized(items) });
}

async function grantCustomerPortal(request: Request, actor: SessionActor, customerId: string) {
  assertStaff(actor, "customers.update");
  const staff = actor as Extract<SessionActor, { kind: "staff" }>;
  const body = await readBody(request, grantSchema);
  const email = body.email.trim().toLowerCase();
  const ids = [...new Set(body.serviceLocationIds)];
  const db = getDb();
  const [customer] = await db.select({ id: customers.id, branchId: customers.owningLocationId, organizationId: organizationLocations.organizationId }).from(customers)
    .leftJoin(organizationLocations, and(eq(organizationLocations.id, customers.owningLocationId), eq(organizationLocations.tenantId, customers.tenantId)))
    .where(and(eq(customers.tenantId, actor.tenantId), eq(customers.id, customerId))).limit(1);
  if (!customer) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
  assertBranch(staff, customer.branchId);
  const locationRows = await db.select({ id: serviceLocations.id, branchId: serviceLocations.organizationLocationId }).from(serviceLocations)
    .where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.customerId, customerId), inArray(serviceLocations.id, ids)));
  if (locationRows.length !== ids.length || locationRows.some((location) => !staff.allLocations && (!location.branchId || !staff.locationIds.has(location.branchId)))) {
    throw new DomainError("NOT_FOUND", "Choose service addresses managed by your office.", 404);
  }

  const [existingUser] = await db.select().from(user).where(sql`lower(${user.email}) = ${email}`).limit(1);
  let userId = existingUser?.id;
  let createdUser = false;
  if (userId) {
    const [staffMember] = await db.select({ id: memberships.id }).from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active"))).limit(1);
    if (staffMember) throw new DomainError("CONFLICT", "This sign-in already belongs to a staff account and cannot be activated as a customer account.", 409);
  } else {
    const temporaryPassword = randomBytes(32).toString("base64url");
    const signupResponse = await auth.api.signUpEmail({
      body: { name: body.name?.trim() || email.split("@")[0] || "Customer", email, password: temporaryPassword },
      headers: request.headers,
      asResponse: true,
    });
    const payload = await signupResponse.clone().json().catch(() => null) as { user?: { id?: string } } | null;
    if (!signupResponse.ok || !payload?.user?.id) throw new DomainError("CONFLICT", "An account for this email could not be created. Check the address and try again.", 409);
    userId = payload.user.id;
    createdUser = true;
  }
  if (!userId) throw new Error("Customer account creation failed.");

  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const accessId = randomUUID();
  const inviteEventId = randomUUID();
  const inviteAuditId = randomUUID();
  let previous: typeof portalAccess.$inferSelect | undefined;
  let previousLocationIds: string[] = [];
  let access: typeof portalAccess.$inferSelect;
  try {
    access = await db.transaction(async (tx) => {
      [previous] = await tx.select().from(portalAccess).where(and(eq(portalAccess.tenantId, actor.tenantId), eq(portalAccess.userId, userId!), eq(portalAccess.customerId, customerId))).limit(1);
      if (previous?.status === "active" || previous?.status === "invited") throw new DomainError("CONFLICT", "This customer already has an active or pending portal invitation.", 409);
      if (previous) previousLocationIds = (await tx.select({ id: portalLocationAccess.serviceLocationId }).from(portalLocationAccess)
        .where(and(eq(portalLocationAccess.tenantId, actor.tenantId), eq(portalLocationAccess.portalAccessId, previous.id)))).map((row) => row.id);
      if (previous && !staff.allLocations && previousLocationIds.length) {
        const previousBranches = await tx.select({ branchId: serviceLocations.organizationLocationId }).from(serviceLocations)
          .where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.customerId, customerId), inArray(serviceLocations.id, previousLocationIds)));
        if (previousBranches.length !== previousLocationIds.length || previousBranches.some((location) => !location.branchId || !staff.locationIds.has(location.branchId))) {
          throw new DomainError("NOT_FOUND", "Portal access not found.", 404);
        }
      }
      const [saved] = previous
        ? await tx.update(portalAccess).set({ status: "invited", invitedAt: now, activatedAt: null, updatedAt: now }).where(and(eq(portalAccess.id, previous.id), eq(portalAccess.tenantId, actor.tenantId), eq(portalAccess.status, previous.status))).returning()
        : await tx.insert(portalAccess).values({ id: accessId, tenantId: actor.tenantId, userId: userId!, customerId, status: "invited", invitedAt: now }).returning();
      if (!saved) throw new Error("Could not create customer portal invitation.");
      if (previous) await tx.delete(portalLocationAccess).where(and(eq(portalLocationAccess.tenantId, actor.tenantId), eq(portalLocationAccess.portalAccessId, saved.id)));
      await tx.insert(portalLocationAccess).values(ids.map((serviceLocationId) => ({ tenantId: actor.tenantId, portalAccessId: saved.id, serviceLocationId })));
      await tx.delete(verification).where(eq(verification.identifier, `portal_invite:${saved.id}`));
      await tx.insert(verification).values({ id: randomUUID(), identifier: `portal_invite:${saved.id}`, value: digest(token), expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000) });
      await tx.insert(domainEvents).values({
        id: inviteEventId, tenantId: actor.tenantId, eventType: "customer_portal_access.invited", actorType: "staff", actorId: actor.userId,
        entityType: "portal_access", entityId: saved.id, organizationId: customer.organizationId, locationId: customer.branchId,
        payload: { customerId, serviceLocationIds: ids, email },
      });
      await tx.insert(auditEvents).values({
        id: inviteAuditId, tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId,
        action: "customer.portal_access_invite", entityType: "portal_access", entityId: saved.id,
        beforeData: previous ? { status: previous.status, serviceLocationIds: previousLocationIds } : undefined,
        afterData: { status: "invited", serviceLocationIds: ids, email },
      });
      return saved;
    });
  } catch (error) {
    if (createdUser) await db.delete(user).where(eq(user.id, userId!)).catch(() => undefined);
    throw error;
  }
  const inviteUrl = new URL("/portal/activate", process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
  inviteUrl.searchParams.set("accessId", access.id);
  inviteUrl.searchParams.set("token", token);

  try {
    if (createdUser) {
      // Better Auth sends the password setup link and redirects back to this one-time activation token.
      await auth.api.requestPasswordReset({ body: { email, redirectTo: inviteUrl.toString() }, headers: request.headers });
    } else {
      await sendDevelopmentEmail(email, "Your customer portal invitation", `Your service team invited you to the customer portal. Activate your access within 48 hours: ${inviteUrl.toString()}`);
    }
  } catch {
    await db.transaction(async (tx) => {
      await tx.delete(verification).where(eq(verification.identifier, `portal_invite:${access.id}`));
      await tx.delete(portalLocationAccess).where(and(eq(portalLocationAccess.tenantId, actor.tenantId), eq(portalLocationAccess.portalAccessId, access.id)));
      if (previous) {
        await tx.update(portalAccess).set({ status: previous.status, invitedAt: previous.invitedAt, activatedAt: previous.activatedAt, updatedAt: previous.updatedAt }).where(and(eq(portalAccess.id, previous.id), eq(portalAccess.tenantId, actor.tenantId)));
        if (previousLocationIds.length) await tx.insert(portalLocationAccess).values(previousLocationIds.map((serviceLocationId) => ({ tenantId: actor.tenantId, portalAccessId: previous!.id, serviceLocationId }))).onConflictDoNothing();
      } else await tx.delete(portalAccess).where(and(eq(portalAccess.id, access.id), eq(portalAccess.tenantId, actor.tenantId)));
      if (createdUser) await tx.delete(user).where(eq(user.id, userId!));
      const failedEventId = randomUUID();
      const failedAuditId = randomUUID();
      await tx.insert(domainEvents).values({
        id: failedEventId, tenantId: actor.tenantId, eventType: "customer_portal_access.invitation_failed", actorType: "staff", actorId: actor.userId,
        entityType: "portal_access", entityId: access.id, organizationId: customer.organizationId, locationId: customer.branchId,
        payload: { customerId, serviceLocationIds: ids, email, reason: "email_delivery_failed" },
      });
      await tx.insert(auditEvents).values({
        id: failedAuditId, tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId,
        action: "customer.portal_access_invitation_failed", entityType: "portal_access", entityId: access.id,
        beforeData: { status: "invited", serviceLocationIds: ids, email },
        afterData: { status: previous?.status ?? "none", serviceLocationIds: previousLocationIds },
      });
    });
    throw new DomainError("EXTERNAL_SERVICE_ERROR", "We couldn't send the invitation setup email, so portal access was not changed. Check email delivery and try again.", 503);
  }
  return json({ item: normalized({ ...access, email, serviceLocationIds: ids }), invitationSent: true }, previous ? 200 : 201);
}

async function revokeCustomerPortal(actor: SessionActor, customerId: string, accessId: string) {
  assertStaff(actor, "customers.update");
  const staff = actor as Extract<SessionActor, { kind: "staff" }>;
  const db = getDb();
  const [row] = await db.select({ access: portalAccess, customerBranch: customers.owningLocationId })
    .from(portalAccess).innerJoin(customers, and(eq(customers.id, portalAccess.customerId), eq(customers.tenantId, portalAccess.tenantId)))
    .where(and(eq(portalAccess.id, accessId), eq(portalAccess.tenantId, actor.tenantId), eq(portalAccess.customerId, customerId))).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "Portal access not found.", 404);
  assertBranch(staff, row.customerBranch);
  const grants = await db.select({ id: portalLocationAccess.serviceLocationId, branchId: serviceLocations.organizationLocationId }).from(portalLocationAccess)
    .innerJoin(serviceLocations, and(eq(serviceLocations.id, portalLocationAccess.serviceLocationId), eq(serviceLocations.tenantId, portalLocationAccess.tenantId), eq(serviceLocations.customerId, customerId)))
    .where(and(eq(portalLocationAccess.tenantId, actor.tenantId), eq(portalLocationAccess.portalAccessId, accessId)));
  if (!grants.length || grants.some((grant) => !staff.allLocations && (!grant.branchId || !staff.locationIds.has(grant.branchId)))) {
    throw new DomainError("NOT_FOUND", "Portal access not found.", 404);
  }
  const locationIds = grants.map((item) => item.id);
  if (row.access.status === "revoked") return json({ item: normalized(row.access) });
  const [updated] = await db.transaction(async (tx) => {
    const changed = await tx.update(portalAccess).set({ status: "revoked", updatedAt: new Date() })
      .where(and(eq(portalAccess.id, accessId), eq(portalAccess.tenantId, actor.tenantId), eq(portalAccess.status, row.access.status))).returning();
    if (!changed[0]) throw new DomainError("CONFLICT", "Portal access changed while you were updating it. Refresh and try again.", 409);
    await tx.delete(verification).where(eq(verification.identifier, `portal_invite:${accessId}`));
    if (changed[0]) await recordEvent(actor, {
      type: "customer_portal_access.revoked", entityType: "portal_access", entityId: accessId,
      payload: { customerId, serviceLocationIds: locationIds }, auditAction: "customer.portal_access_revoke",
      before: { status: row.access.status, serviceLocationIds: locationIds }, after: { status: "revoked", serviceLocationIds: locationIds }, locationId: row.customerBranch,
    }, tx);
    return changed;
  });
  return json({ item: normalized(updated) });
}

async function activateInvite(request: Request) {
  const body = await readBody(request, z.object({ accessId: z.uuid(), token: z.string().min(32).max(200) }));
  const db = getDb();
  const identifier = `portal_invite:${body.accessId}`;
  const [tokenRow] = await db.select().from(verification).where(and(eq(verification.identifier, identifier))).limit(1);
  if (!tokenRow || tokenRow.expiresAt <= new Date() || !safeDigestEqual(tokenRow.value, digest(body.token))) {
    throw new DomainError("NOT_FOUND", "This invitation link is invalid or has expired. Ask your service team to send another.", 404);
  }
  const [access] = await db.transaction(async (tx) => {
    const [consumed] = await tx.delete(verification).where(and(eq(verification.id, tokenRow.id), eq(verification.value, digest(body.token)), sql`${verification.expiresAt} > now()`)).returning();
    if (!consumed) throw new DomainError("NOT_FOUND", "This invitation link is invalid or has expired. Ask your service team to send another.", 404);
    const [activated] = await tx.update(portalAccess).set({ status: "active", activatedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(portalAccess.id, body.accessId), eq(portalAccess.status, "invited"))).returning();
    if (!activated) throw new DomainError("NOT_FOUND", "This invitation is no longer available. Ask your service team to send another.", 404);
    await tx.insert(domainEvents).values({ tenantId: activated.tenantId, eventType: "customer_portal_access.activated", actorType: "customer", actorId: activated.userId, entityType: "portal_access", entityId: activated.id, payload: { customerId: activated.customerId } });
    await tx.insert(auditEvents).values({ tenantId: activated.tenantId, actorType: "customer", actorId: activated.userId, action: "customer.portal_access_activate", entityType: "portal_access", entityId: activated.id, afterData: { status: "active", customerId: activated.customerId } });
    return [activated];
  });
  return json({ item: { id: access!.id, status: access!.status } });
}

async function requestList(actor: SessionActor) {
  assertStaff(actor, "customers.read");
  const staff = actor as Extract<SessionActor, { kind: "staff" }>;
  const db = getDb();
  const where = staff.allLocations ? undefined : [...staff.locationIds];
  const items = where?.length ? await db.execute(sql`
    select r.id,r.tenant_id,r.customer_id,r.service_location_id,r.request_type,case when r.status='pending' then 'submitted' else r.status end as status,r.requested_changes,r.applied_changes,
      r.customer_message as details,r.internal_note,r.reviewed_at,r.created_at,c.display_name as customer_name,sl.address_line1 as service_address
    from customer_change_requests r join customers c on c.id=r.customer_id and c.tenant_id=r.tenant_id
    left join service_locations sl on sl.id=r.service_location_id and sl.tenant_id=r.tenant_id
    where r.tenant_id=${actor.tenantId} and (sl.organization_location_id=any(${uuidArray(where)}) or
      (r.service_location_id is null and exists (select 1 from service_locations csl where csl.tenant_id=r.tenant_id and csl.customer_id=r.customer_id and csl.organization_location_id=any(${uuidArray(where)}))))
    order by r.created_at desc limit 200`).then((result) => result.rows) : staff.allLocations ? await db.execute(sql`
    select r.id,r.tenant_id,r.customer_id,r.service_location_id,r.request_type,case when r.status='pending' then 'submitted' else r.status end as status,r.requested_changes,r.applied_changes,
      r.customer_message as details,r.internal_note,r.reviewed_at,r.created_at,c.display_name as customer_name,sl.address_line1 as service_address
    from customer_change_requests r join customers c on c.id=r.customer_id and c.tenant_id=r.tenant_id
    left join service_locations sl on sl.id=r.service_location_id and sl.tenant_id=r.tenant_id
    where r.tenant_id=${actor.tenantId} order by r.created_at desc limit 200`).then((result) => result.rows) : [];
  return json({ items: normalized(items) });
}

async function resolveRequest(request: Request, actor: SessionActor, requestId: string, action: string) {
  assertStaff(actor, "customers.update");
  const staff = actor as Extract<SessionActor, { kind: "staff" }>;
  if (!(["review", "approve", "reject"] as const).includes(action as "review" | "approve" | "reject")) return null;
  const body = await readBody(request, resolutionSchema);
  const db = getDb();
  const [row] = await db.select().from(customerChangeRequests).where(and(eq(customerChangeRequests.id, requestId), eq(customerChangeRequests.tenantId, actor.tenantId))).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "Change request not found.", 404);
  let eventLocationId: string | null = null;
  if (row.serviceLocationId) {
    const [location] = await db.select({ branchId: serviceLocations.organizationLocationId }).from(serviceLocations)
      .where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.id, row.serviceLocationId), eq(serviceLocations.customerId, row.customerId))).limit(1);
    if (!location) throw new DomainError("NOT_FOUND", "Change request not found.", 404);
    assertBranch(staff, location.branchId);
    eventLocationId = location.branchId;
  } else {
    const [customer] = await db.select({ branchId: customers.owningLocationId }).from(customers).where(and(eq(customers.id, row.customerId), eq(customers.tenantId, actor.tenantId))).limit(1);
    assertBranch(staff, customer?.branchId);
    eventLocationId = customer?.branchId ?? null;
  }
  const now = new Date();
  if (action === "review") {
    if (!(["submitted", "pending"] as string[]).includes(row.status)) throw new DomainError("CONFLICT", "Only submitted requests can move into review.", 409);
    const [updated] = await db.transaction(async (tx) => {
      const result = await tx.update(customerChangeRequests).set({ status: "reviewing", reviewedByMembershipId: staff.membershipId, reviewedAt: now, updatedAt: now })
        .where(and(eq(customerChangeRequests.id, row.id), eq(customerChangeRequests.tenantId, actor.tenantId), inArray(customerChangeRequests.status, ["submitted", "pending"]))).returning();
      if (result[0]) await recordEvent(actor, { type: "customer_change_request.reviewing", entityType: "customer_change_request", entityId: row.id, payload: { customerId: row.customerId }, auditAction: "customer.request_review", before: { status: row.status }, after: { status: "reviewing" }, locationId: eventLocationId }, tx);
      return result;
    });
    if (!updated) throw new DomainError("CONFLICT", "This request changed while you were reviewing it. Refresh and try again.", 409);
    return json({ item: normalized(updated) });
  }
  if (!["submitted", "pending", "reviewing"].includes(row.status)) throw new DomainError("CONFLICT", "This request has already been resolved.", 409);
  let plan: typeof servicePlans.$inferSelect | undefined;
  let planBefore: Record<string, unknown> | null = null;
  let planAfter: Record<string, unknown> | null = null;
  const changes = row.requestedChanges ?? {};
  const planId = typeof changes.servicePlanId === "string" ? changes.servicePlanId : undefined;
  const isPlanTransition = ["pause", "resume", "cancel"].includes(row.requestType);
  if (action === "approve" && isPlanTransition && !planId) {
    throw new DomainError("VALIDATION_ERROR", "This plan request no longer identifies a service plan. Ask the customer to submit it again.", 422);
  }
  if (action === "approve" && planId && isPlanTransition) {
    const [linkedPlan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.tenantId, actor.tenantId), eq(servicePlans.customerId, row.customerId))).limit(1);
    if (!linkedPlan || !row.serviceLocationId || linkedPlan.serviceLocationId !== row.serviceLocationId) throw new DomainError("NOT_FOUND", "The linked service plan no longer matches this customer and address.", 404);
    plan = linkedPlan;
    const effectiveDate = body.effectiveDate ?? (typeof changes.effectiveDate === "string" ? changes.effectiveDate : now.toISOString().slice(0, 10));
    planBefore = { id: plan.id, status: plan.status, pauseFrom: plan.pauseFrom, pauseUntil: plan.pauseUntil, effectiveTo: plan.effectiveTo, canceledAt: plan.canceledAt, cancellationReason: plan.cancellationReason };
    if (row.requestType === "pause") {
      requirePermission(actor, "service_plans.pause");
      if (plan.status !== "active") throw new DomainError("CONFLICT", "Only active service plans can be paused.", 409);
      planAfter = { ...planBefore, status: "paused", pauseFrom: effectiveDate };
    } else if (row.requestType === "resume") {
      requirePermission(actor, "service_plans.pause");
      if (plan.status !== "paused") throw new DomainError("CONFLICT", "Only paused service plans can be resumed.", 409);
      planAfter = { ...planBefore, status: "active", pauseFrom: null, pauseUntil: null };
    } else {
      requirePermission(actor, "service_plans.cancel");
      if (!(["active", "paused"] as string[]).includes(plan.status)) throw new DomainError("CONFLICT", "Only active or paused service plans can be canceled.", 409);
      planAfter = { ...planBefore, status: "canceled", effectiveTo: effectiveDate, canceledAt: now.toISOString(), cancellationReason: body.reason ?? row.customerMessage ?? "Customer requested cancellation" };
    }
  }
  const status = action === "approve" ? "approved" : "rejected";
  const response = action === "reject" ? body.reason?.trim() || null : null;
  const customerResponse = action === "approve" && !planAfter
    ? body.reason?.trim() || "Your request has been approved. Your service team will follow up with you."
    : response;
  const appliedChanges = action === "approve"
    ? { reviewed: true, operationalChangeApplied: Boolean(planAfter), ...(planAfter ? { servicePlan: planAfter } : {}), ...(planId ? { servicePlanId: planId } : {}), ...(customerResponse ? { customerResponse } : {}) }
    : response ? { customerResponse: response } : null;
  const [updated] = await db.transaction(async (tx) => {
    if (plan && planAfter) {
      const [updatedPlan] = await tx.update(servicePlans).set({ status: String(planAfter.status), pauseFrom: planAfter.pauseFrom as string | null, pauseUntil: planAfter.pauseUntil as string | null, effectiveTo: planAfter.effectiveTo as string | null, canceledAt: planAfter.canceledAt ? new Date(String(planAfter.canceledAt)) : null, cancellationReason: planAfter.cancellationReason as string | null, updatedAt: now })
        .where(and(eq(servicePlans.id, plan.id), eq(servicePlans.tenantId, actor.tenantId), eq(servicePlans.customerId, row.customerId), eq(servicePlans.serviceLocationId, row.serviceLocationId!), eq(servicePlans.status, plan.status))).returning();
      if (!updatedPlan) throw new DomainError("CONFLICT", "The service plan changed while this request was being reviewed.", 409);
    }
    const result = await tx.update(customerChangeRequests).set({ status, reviewedByMembershipId: staff.membershipId, reviewedAt: now, internalNote: response, appliedChanges, updatedAt: now })
        .where(and(eq(customerChangeRequests.id, row.id), eq(customerChangeRequests.tenantId, actor.tenantId), inArray(customerChangeRequests.status, ["pending", "submitted", "reviewing"]))).returning();
    if (!result[0]) throw new DomainError("CONFLICT", "This request changed while it was being reviewed. Refresh and try again.", 409);
    if (result[0]) await recordEvent(actor, {
      type: `customer_change_request.${status}`, entityType: "customer_change_request", entityId: row.id,
      payload: { customerId: row.customerId, requestType: row.requestType, servicePlanId: plan?.id ?? null, serviceLocationId: row.serviceLocationId, ...(customerResponse ? { customerResponse } : {}) },
      auditAction: `customer.request_${status}`, before: { status: row.status, ...(planBefore ? { servicePlan: planBefore } : {}) }, after: { status, ...(planAfter ? { servicePlan: planAfter } : {}), ...(customerResponse ? { customerResponse } : {}) }, locationId: eventLocationId,
    }, tx);
    return result;
  });
  return json({ item: normalized(updated) });
}

export async function handlePortalActivation(request: Request, path: string[]): Promise<Response | null> {
  if (path[0] !== "auth" || path[1] !== "portal-activate") return null;
  if (request.method !== "POST") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  return activateInvite(request);
}

export async function handlePortalLifecycle(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] === "customers" && path[2] === "portal-access") {
    if (path.length === 3 && request.method === "GET") return customerPortalAccess(actor, path[1]!);
    if (path.length === 3 && request.method === "POST") return grantCustomerPortal(request, actor, path[1]!);
    if (path.length === 4 && request.method === "DELETE") return revokeCustomerPortal(actor, path[1]!, path[3]!);
    return null;
  }
  if (path[0] === "customer-change-requests") {
    if (path.length === 1 && request.method === "GET") return requestList(actor);
    if (path.length === 3 && request.method === "POST") return resolveRequest(request, actor, path[1]!, path[2]!);
  }
  return null;
}
