import { and, eq, inArray, notInArray } from "drizzle-orm";
import { membershipLocationScopes, memberships, organizationLocations, portalAccess, portalLocationAccess, rolePermissions, roleTemplates, serviceLocations, tenants } from "@modular-crm/db";
import { DomainError, permissionsForRole, type Actor, type Permission, type RoleTemplate } from "@modular-crm/domain";
import { auth } from "../auth";
import { getDb } from "../db";

export type SessionActor = Actor & {
  email: string;
  name: string;
  tenantName: string;
  packKey: string | null;
  membershipId?: string;
  organizationId?: string;
  defaultLocationId?: string | null;
};

export async function resolveActor(request: Request): Promise<SessionActor | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const db = getDb();
  const member = await db.select({
    membership: memberships,
    role: roleTemplates,
    tenant: tenants,
  }).from(memberships)
    .innerJoin(roleTemplates, eq(memberships.roleTemplateId, roleTemplates.id))
    .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
    .where(and(eq(memberships.userId, session.user.id), eq(memberships.status, "active")))
    .limit(1);
  if (member[0]) {
    const { membership, role, tenant } = member[0];
    const key = role.key as RoleTemplate;
    const overrides = await db.select({ permissionKey: rolePermissions.permissionKey, allowed: rolePermissions.allowed })
      .from(rolePermissions).where(eq(rolePermissions.roleTemplateId, role.id));
    const permissions = new Set<Permission>(permissionsForRole(key));
    for (const override of overrides) {
      if (override.allowed) permissions.add(override.permissionKey as Permission);
      else permissions.delete(override.permissionKey as Permission);
    }
    const scopes = await db.select({ locationId: membershipLocationScopes.locationId })
      .from(membershipLocationScopes).where(eq(membershipLocationScopes.membershipId, membership.id));
    const locationIds = new Set(scopes.map((scope) => scope.locationId));
    if (membership.defaultLocationId) locationIds.add(membership.defaultLocationId);
    return {
      kind: "staff", userId: session.user.id, tenantId: tenant.id, tenantName: tenant.name, packKey: tenant.industryPackKey,
      email: session.user.email, name: session.user.name, role: key, permissions, locationIds, allLocations: key === "owner",
      membershipId: membership.id, organizationId: membership.organizationId, defaultLocationId: membership.defaultLocationId,
    };
  }
  const portalRows = await db.select({ access: portalAccess, tenant: tenants })
    .from(portalAccess).innerJoin(tenants, eq(portalAccess.tenantId, tenants.id))
    .where(and(eq(portalAccess.userId, session.user.id), eq(portalAccess.status, "active")));
  if (portalRows.length === 0) return null;
  const tenant = portalRows[0]!.tenant;
  const sameTenant = portalRows.filter((row) => row.tenant.id === tenant.id);
  const accessIds = sameTenant.map((row) => row.access.id);
  const locations = accessIds.length === 0 ? [] : await db.select({
    customerId: portalAccess.customerId,
    locationId: serviceLocations.id,
  }).from(portalLocationAccess)
    .innerJoin(portalAccess, and(eq(portalAccess.id, portalLocationAccess.portalAccessId), eq(portalAccess.tenantId, portalLocationAccess.tenantId)))
    .innerJoin(serviceLocations, and(
      eq(serviceLocations.id, portalLocationAccess.serviceLocationId),
      eq(serviceLocations.tenantId, portalLocationAccess.tenantId),
      eq(serviceLocations.customerId, portalAccess.customerId),
    ))
    .where(and(eq(portalLocationAccess.tenantId, tenant.id), inArray(portalLocationAccess.portalAccessId, accessIds), eq(portalAccess.status, "active")));
  const customerLocationIds = new Map<string, Set<string>>(sameTenant.map((row) => [row.access.customerId, new Set()]));
  for (const location of locations) customerLocationIds.get(location.customerId)?.add(location.locationId);
  return {
    kind: "customer", userId: session.user.id, tenantId: tenant.id, tenantName: tenant.name, packKey: tenant.industryPackKey,
    email: session.user.email, name: session.user.name,
    customerIds: new Set(customerLocationIds.keys()),
    locationIds: new Set([...customerLocationIds.values()].flatMap((ids) => [...ids])),
    customerLocationIds,
  };
}

export async function requireActor(request: Request): Promise<SessionActor> {
  const actor = await resolveActor(request);
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Sign in to continue.", 401);
  return actor;
}

export function requireStaff(actor: SessionActor): asserts actor is SessionActor & { kind: "staff"; membershipId: string; organizationId: string } {
  if (actor.kind !== "staff" || !actor.membershipId || !actor.organizationId) throw new DomainError("FORBIDDEN", "Staff access is required.", 403);
}

export function locationFilter(actor: SessionActor): string[] | null {
  if (actor.kind !== "staff") return [];
  return actor.allLocations ? null : [...actor.locationIds];
}

export async function assertCustomerServiceLocationAccess(actor: SessionActor, customerId: string | null, serviceLocationId: string | null): Promise<void> {
  if (actor.kind !== "customer" || !customerId || !serviceLocationId || !actor.customerLocationIds.get(customerId)?.has(serviceLocationId)) {
    throw new DomainError("NOT_FOUND", "Record not found.", 404);
  }
}

export async function assertCustomerDocumentAccess(actor: SessionActor, customerId: string | null, organizationLocationId: string | null): Promise<void> {
  const permittedLocationIds = actor.kind === "customer" && customerId ? actor.customerLocationIds.get(customerId) : undefined;
  if (actor.kind !== "customer" || !customerId || !actor.customerIds.has(customerId) || !organizationLocationId || !permittedLocationIds?.size) {
    throw new DomainError("NOT_FOUND", "Record not found.", 404);
  }
  const db = getDb();
  const [permitted] = await db.select({ id: serviceLocations.id }).from(serviceLocations)
    .where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.customerId, customerId),
      eq(serviceLocations.organizationLocationId, organizationLocationId), inArray(serviceLocations.id, [...permittedLocationIds]))).limit(1);
  const [outOfScope] = await db.select({ id: serviceLocations.id }).from(serviceLocations)
    .where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.customerId, customerId),
      eq(serviceLocations.organizationLocationId, organizationLocationId), notInArray(serviceLocations.id, [...permittedLocationIds]))).limit(1);
  if (!permitted || outOfScope) throw new DomainError("NOT_FOUND", "Record not found.", 404);
}
