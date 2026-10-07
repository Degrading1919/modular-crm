import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditEvents, domainEvents, memberships, membershipLocationScopes, organizationLocations, roleTemplates, verification } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { auth } from "../auth";
import { getDb } from "../db";
import { sendPlatformEmail } from "../mail";
import { requireStaff, type SessionActor } from "./actor";
import { json, readBody } from "./http";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const changeSchema = z.object({ status: z.enum(["active", "inactive"]).optional(), role: z.enum(["owner", "office", "technician"]).optional(), locationIds: z.array(z.uuid()).min(1).max(100).optional() }).strict();
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
async function history(tx: Tx, actor: SessionActor, id: string, action: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId, entityType: "membership", entityId: id, action, beforeData: before, afterData: after });
  await tx.insert(domainEvents).values({ tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId, entityType: "membership", entityId: id, eventType: action, payload: after });
}
async function roleId(tx: Tx, tenantId: string, key: string) {
  const [role] = await tx.select().from(roleTemplates).where(and(eq(roleTemplates.tenantId, tenantId), eq(roleTemplates.key, key), eq(roleTemplates.active, true))).limit(1);
  if (role) return role.id;
  const [created] = await tx.insert(roleTemplates).values({ tenantId, key, name: key === "owner" ? "Owner / Admin" : key === "office" ? "Office / Manager" : "Field Technician", system: true }).returning();
  return created!.id;
}
export async function updateStaffAccess(request: Request, id: string, actor: SessionActor) {
  requireStaff(actor); requirePermission(actor, "staff.update");
  const input = await readBody(request, changeSchema);
  if (input.status) requirePermission(actor, "staff.deactivate");
  if (input.role) requirePermission(actor, "roles.manage");
  const item = await getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`staff-access:${actor.tenantId}`}, 0))`);
    const [row] = await tx.select({ member: memberships, role: roleTemplates.key }).from(memberships).innerJoin(roleTemplates, eq(roleTemplates.id, memberships.roleTemplateId))
      .where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.organizationId, actor.organizationId), eq(memberships.id, id))).limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "Team member not found.", 404);
    const scopes = await tx.select().from(membershipLocationScopes).where(and(eq(membershipLocationScopes.tenantId, actor.tenantId), eq(membershipLocationScopes.membershipId, id)));
    const previousIds = [...new Set([...scopes.map(s => s.locationId), ...(row.member.defaultLocationId ? [row.member.defaultLocationId] : [])])];
    if (!actor.allLocations && (!previousIds.length || previousIds.some(location => !actor.locationIds.has(location)))) throw new DomainError("NOT_FOUND", "Team member not found.", 404);
    if (row.role === "owner" || input.role === "owner") requirePermission(actor, "tenant.security_manage");
    if (row.member.userId === actor.userId) throw new DomainError("CONFLICT", "Ask another owner to change your own access.", 409);
    if (input.status === "active" && (row.member.status === "invited" || !row.member.joinedAt)) throw new DomainError("CONFLICT", "This person must accept an invitation first. Send a new invitation if the old one was canceled.", 409);
    if (row.role === "owner" && row.member.status === "active" && (input.status === "inactive" || (input.role && input.role !== "owner"))) {
      const owners = await tx.select({ id: memberships.id }).from(memberships).innerJoin(roleTemplates, eq(memberships.roleTemplateId, roleTemplates.id))
        .where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.status, "active"), eq(roleTemplates.key, "owner")));
      if (owners.length < 2) throw new DomainError("CONFLICT", "Keep at least one active owner on your team.", 409);
    }
    const locations = input.locationIds ? [...new Set(input.locationIds)] : previousIds;
    if (input.locationIds) {
      const valid = await tx.select().from(organizationLocations).where(and(eq(organizationLocations.tenantId, actor.tenantId), eq(organizationLocations.organizationId, actor.organizationId), eq(organizationLocations.active, true), inArray(organizationLocations.id, locations)));
      if (valid.length !== locations.length || (!actor.allLocations && locations.some(location => !actor.locationIds.has(location)))) throw new DomainError("NOT_FOUND", "Location not found.", 404);
    }
    // Older new-account invitations granted active access without joinedAt.
    // Preserve that prior grant, without treating canceled invitations as accepted.
    const legacyGrant = input.status === "inactive" && row.member.status === "active" && !row.member.joinedAt ? { joinedAt: row.member.createdAt } : {};
    const [updated] = await tx.update(memberships).set({ ...legacyGrant, ...(input.status ? { status: input.status } : {}), ...(input.role ? { roleTemplateId: await roleId(tx, actor.tenantId, input.role) } : {}), ...(input.locationIds ? { defaultLocationId: locations[0] } : {}), updatedAt: new Date() })
      .where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.id, id))).returning();
    if (input.locationIds) {
      await tx.delete(membershipLocationScopes).where(and(eq(membershipLocationScopes.tenantId, actor.tenantId), eq(membershipLocationScopes.membershipId, id)));
      await tx.insert(membershipLocationScopes).values(locations.map(locationId => ({ tenantId: actor.tenantId, membershipId: id, locationId })));
    }
    if (input.status === "inactive") await tx.delete(verification).where(eq(verification.identifier, `staff_invite:${id}`));
    await history(tx, actor, id, "staff.access_updated", { status: row.member.status, role: row.role, locationIds: previousIds }, { status: updated!.status, role: input.role ?? row.role, locationIds: locations });
    return { id, status: updated!.status, role: input.role ?? row.role, locationIds: locations };
  });
  return json({ item });
}

export async function inviteExistingStaff(actor: SessionActor, person: { id: string; name: string; email: string }, role: "office" | "technician", locationId: string) {
  requireStaff(actor); requirePermission(actor, "staff.invite");
  if (role === "office") requirePermission(actor, "roles.manage");
  const token = randomBytes(32).toString("base64url");
  const item = await getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`staff-access:${actor.tenantId}`}, 0))`);
    const [previous] = await tx.select().from(memberships).where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.organizationId, actor.organizationId), eq(memberships.userId, person.id))).limit(1);
    const [location] = await tx.select({ id: organizationLocations.id }).from(organizationLocations).where(and(eq(organizationLocations.id, locationId), eq(organizationLocations.tenantId, actor.tenantId), eq(organizationLocations.organizationId, actor.organizationId), eq(organizationLocations.active, true))).limit(1);
    if (!location || (!actor.allLocations && !actor.locationIds.has(locationId))) throw new DomainError("NOT_FOUND", "Location not found.", 404);
    if (previous && !actor.allLocations) {
      const scopes = await tx.select().from(membershipLocationScopes).where(and(eq(membershipLocationScopes.tenantId, actor.tenantId), eq(membershipLocationScopes.membershipId, previous.id)));
      const previousIds = [...scopes.map(s => s.locationId), ...(previous.defaultLocationId ? [previous.defaultLocationId] : [])];
      if (!previousIds.length || previousIds.some(id => !actor.locationIds.has(id))) throw new DomainError("NOT_FOUND", "Team member not found.", 404);
    }
    if (previous && previous.status !== "invited" && (previous.status !== "inactive" || previous.joinedAt)) throw new DomainError("CONFLICT", previous.status === "active" ? "This person is already on your team." : "Reactivate this team member from their access settings.", 409);
    const values = { tenantId: actor.tenantId, userId: person.id, organizationId: actor.organizationId, defaultLocationId: locationId, roleTemplateId: await roleId(tx, actor.tenantId, role), status: "invited", invitedAt: new Date() };
    const [member] = previous ? await tx.update(memberships).set({ ...values, updatedAt: new Date() }).where(eq(memberships.id, previous.id)).returning() : await tx.insert(memberships).values(values).returning();
    await tx.delete(membershipLocationScopes).where(and(eq(membershipLocationScopes.tenantId, actor.tenantId), eq(membershipLocationScopes.membershipId, member!.id)));
    await tx.insert(membershipLocationScopes).values({ tenantId: actor.tenantId, membershipId: member!.id, locationId });
    const identifier = `staff_invite:${member!.id}`;
    await tx.delete(verification).where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({ id: randomUUID(), identifier, value: digest(token), expiresAt: new Date(Date.now() + 48 * 60 * 60_000) });
    await history(tx, actor, member!.id, "staff.invited", { status: previous?.status ?? null }, { status: "invited", role, locationIds: [locationId] });
    return { id: member!.id, userId: person.id, name: person.name, email: person.email, status: "invited", role, locationIds: [locationId] };
  });
  const url = new URL("/staff-invitation", process.env.APP_BASE_URL ?? "http://localhost:3000");
  url.searchParams.set("membershipId", item.id); url.searchParams.set("token", token);
  await sendPlatformEmail(person.email, `Join ${actor.tenantName}`, `You were invited to join ${actor.tenantName}. Sign in with this email, then accept: ${url}`, { tenantId: actor.tenantId, name: actor.tenantName });
  return json({ item, invite: { email: person.email, ...(process.env.NODE_ENV !== "production" ? { invitationUrl: url.toString() } : {}) } }, 201);
}

/** Accept before requireActor: an invited account may not have any active workspace yet. */
export async function handleStaffInvitation(request: Request, path: string[]) {
  if (path.length !== 2 || path[0] !== "staff-invitations" || path[1] !== "accept" || request.method !== "POST") return null;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new DomainError("UNAUTHENTICATED", "Sign in with the email that received this invitation.", 401);
  const input = await readBody(request, z.object({ membershipId: z.uuid(), token: z.string().min(32).max(200) }));
  const item = await getDb().transaction(async tx => {
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.id, input.membershipId), eq(memberships.userId, session.user.id), eq(memberships.status, "invited"))).limit(1);
    if (!member) throw new DomainError("NOT_FOUND", "This invitation is unavailable for your account. Ask the owner to send another.", 404);
    const [consumed] = await tx.delete(verification).where(and(eq(verification.identifier, `staff_invite:${member.id}`), eq(verification.value, digest(input.token)), sql`${verification.expiresAt} > now()`)).returning();
    if (!consumed) throw new DomainError("NOT_FOUND", "This invitation has expired or was already used. Ask the owner to send another.", 404);
    const [active] = await tx.update(memberships).set({ status: "active", joinedAt: new Date(), updatedAt: new Date() }).where(and(eq(memberships.id, member.id), eq(memberships.status, "invited"))).returning();
    if (!active) throw new DomainError("CONFLICT", "This invitation is no longer available.", 409);
    await tx.insert(auditEvents).values({ tenantId: member.tenantId, actorType: "staff", actorId: session.user.id, entityType: "membership", entityId: member.id, action: "staff.invitation_accepted", beforeData: { status: "invited" }, afterData: { status: "active" } });
    await tx.insert(domainEvents).values({ tenantId: member.tenantId, actorType: "staff", actorId: session.user.id, entityType: "membership", entityId: member.id, eventType: "staff.invitation_accepted", payload: {} });
    return { id: active.id, status: active.status };
  });
  return json({ item }, 200, { "set-cookie": `crm_membership=${item.id}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}` });
}
