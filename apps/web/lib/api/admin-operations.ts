import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  auditEvents, domainEvents, inventoryItems, inventoryLocations, jobAssignments, jobMaterialUsage, jobs,
  membershipLocationScopes, memberships, organizationLocations, purchaseOrderItems, purchaseOrders,
  reorderRules, roleTemplates, stockMovements, tenants, user, vendors,
} from "@modular-crm/db";
import { DomainError, requirePermission, type Permission } from "@modular-crm/domain";
import { z } from "zod";
import { auth } from "../auth";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { json, readBody } from "./http";
import { normalized } from "./sql";

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;
type StaffActor = SessionActor & { kind: "staff"; membershipId: string; organizationId: string };

function authorize(actor: SessionActor, permission: Permission): asserts actor is StaffActor {
  requireStaff(actor);
  requirePermission(actor, permission);
}

function hasLocationAccess(actor: StaffActor, locationId: string): boolean {
  return actor.allLocations || actor.locationIds.has(locationId);
}

function assertLocationAccess(actor: StaffActor, locationId: string): void {
  if (!hasLocationAccess(actor, locationId)) throw new DomainError("NOT_FOUND", "Location not found.", 404);
}

function quantityUnits(value: unknown): bigint {
  const source = String(value).trim();
  const match = /^(-?)(\d{1,10})(?:\.(\d{1,4}))?$/.exec(source);
  if (!match) throw new DomainError("VALIDATION_ERROR", "Enter a quantity with up to four decimal places.", 422);
  const units = BigInt(match[2]!) * 10_000n + BigInt((match[3] ?? "").padEnd(4, "0") || "0");
  return match[1] ? -units : units;
}

function formatQuantity(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  const whole = absolute / 10_000n;
  const fraction = (absolute % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function quantityInput(value: unknown, allowZero = false): string {
  const units = quantityUnits(value);
  if (units < 0n || (!allowZero && units === 0n)) {
    throw new DomainError("VALIDATION_ERROR", allowZero ? "Quantity cannot be negative." : "Quantity must be greater than zero.", 422);
  }
  return formatQuantity(units);
}

function amountForQuantity(unitCostMinor: number | bigint, units: bigint): bigint {
  const scaled = BigInt(unitCostMinor) * units;
  return (scaled + 5_000n) / 10_000n;
}

async function recordOperation(tx: Transaction, actor: StaffActor, input: {
  eventType: string;
  entityType: string;
  entityId: string;
  locationId?: string | null;
  payload?: Record<string, unknown>;
  auditAction?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  await tx.insert(domainEvents).values({
    tenantId: actor.tenantId,
    eventType: input.eventType,
    actorType: "staff",
    actorId: actor.userId,
    entityType: input.entityType,
    entityId: input.entityId,
    organizationId: actor.organizationId,
    locationId: input.locationId ?? null,
    payload: input.payload ?? {},
  });
  if (input.auditAction) {
    await tx.insert(auditEvents).values({
      tenantId: actor.tenantId,
      actorType: "staff",
      actorId: actor.userId,
      action: input.auditAction,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeData: input.before ?? undefined,
      afterData: input.after ?? undefined,
    });
  }
}

async function listOrganizationLocations(db: Executor, actor: StaffActor) {
  const conditions = [
    eq(organizationLocations.tenantId, actor.tenantId),
    eq(organizationLocations.organizationId, actor.organizationId),
  ];
  if (!actor.allLocations) conditions.push(inArray(organizationLocations.id, [...actor.locationIds]));
  return db.select().from(organizationLocations).where(and(...conditions)).orderBy(asc(organizationLocations.name));
}

async function requireOrganizationLocation(db: Executor, actor: StaffActor, locationId: string) {
  assertLocationAccess(actor, locationId);
  const [location] = await db.select().from(organizationLocations).where(and(
    eq(organizationLocations.id, locationId),
    eq(organizationLocations.tenantId, actor.tenantId),
    eq(organizationLocations.organizationId, actor.organizationId),
  )).limit(1);
  if (!location) throw new DomainError("NOT_FOUND", "Location not found.", 404);
  return location;
}

async function defaultOrganizationLocation(db: Executor, actor: StaffActor, requestedId?: string | null) {
  if (requestedId) return requireOrganizationLocation(db, actor, requestedId);
  if (actor.defaultLocationId && hasLocationAccess(actor, actor.defaultLocationId)) {
    const [preferred] = await db.select().from(organizationLocations).where(and(
      eq(organizationLocations.id, actor.defaultLocationId),
      eq(organizationLocations.tenantId, actor.tenantId),
      eq(organizationLocations.organizationId, actor.organizationId),
    )).limit(1);
    if (preferred) return preferred;
  }
  const [location] = await listOrganizationLocations(db, actor);
  if (!location) throw new DomainError("VALIDATION_ERROR", "Add an accessible business location before managing stock.", 422);
  return location;
}

async function visibleInventoryLocations(db: Executor, actor: StaffActor) {
  const branches = await listOrganizationLocations(db, actor);
  const branchIds = branches.map((location) => location.id);
  const branchStocks = branchIds.length ? await db.select({
    id: inventoryLocations.id,
    name: inventoryLocations.name,
    locationType: inventoryLocations.locationType,
    organizationLocationId: inventoryLocations.organizationLocationId,
    membershipId: inventoryLocations.membershipId,
    branchName: organizationLocations.name,
    membershipName: sql<string | null>`null`,
  }).from(inventoryLocations).innerJoin(organizationLocations, and(
    eq(inventoryLocations.organizationLocationId, organizationLocations.id),
    eq(organizationLocations.tenantId, actor.tenantId),
    eq(organizationLocations.organizationId, actor.organizationId),
  )).where(and(eq(inventoryLocations.tenantId, actor.tenantId), inArray(inventoryLocations.organizationLocationId, branchIds))) : [];

  const members = await db.select({
    id: memberships.id,
    defaultLocationId: memberships.defaultLocationId,
    name: user.name,
  }).from(memberships).innerJoin(user, eq(memberships.userId, user.id)).where(and(
    eq(memberships.tenantId, actor.tenantId),
    eq(memberships.organizationId, actor.organizationId),
    inArray(memberships.status, ["active", "invited"]),
  ));
  const memberScopeRows = members.length ? await db.select({ membershipId: membershipLocationScopes.membershipId, locationId: membershipLocationScopes.locationId })
    .from(membershipLocationScopes).where(and(
      eq(membershipLocationScopes.tenantId, actor.tenantId),
      inArray(membershipLocationScopes.membershipId, members.map((member) => member.id)),
    )) : [];
  const memberScopeIds = new Map<string, Set<string>>();
  for (const scope of memberScopeRows) {
    const set = memberScopeIds.get(scope.membershipId) ?? new Set<string>();
    set.add(scope.locationId);
    memberScopeIds.set(scope.membershipId, set);
  }
  const memberIds = members.filter((member) => {
    if (actor.role === "technician") return member.id === actor.membershipId;
    if (actor.allLocations) return true;
    if (member.defaultLocationId && hasLocationAccess(actor, member.defaultLocationId)) return true;
    return [...(memberScopeIds.get(member.id) ?? [])].some((id) => hasLocationAccess(actor, id));
  });
  const personalStocks = memberIds.length ? await db.select({
    id: inventoryLocations.id,
    name: inventoryLocations.name,
    locationType: inventoryLocations.locationType,
    organizationLocationId: inventoryLocations.organizationLocationId,
    membershipId: inventoryLocations.membershipId,
    branchName: sql<string | null>`null`,
    membershipName: user.name,
  }).from(inventoryLocations).innerJoin(memberships, and(
    eq(inventoryLocations.membershipId, memberships.id),
    eq(memberships.tenantId, actor.tenantId),
    eq(memberships.organizationId, actor.organizationId),
  )).innerJoin(user, eq(memberships.userId, user.id)).where(and(
    eq(inventoryLocations.tenantId, actor.tenantId),
    isNull(inventoryLocations.organizationLocationId),
    inArray(inventoryLocations.membershipId, memberIds.map((member) => member.id)),
  )) : [];
  return [...branchStocks, ...personalStocks];
}

async function requireInventoryLocation(db: Executor, actor: StaffActor, inventoryLocationId: string) {
  const location = (await visibleInventoryLocations(db, actor)).find((item) => item.id === inventoryLocationId);
  if (!location) throw new DomainError("NOT_FOUND", "Stock location not found.", 404);
  return location;
}

async function ensureBranchStockLocation(tx: Transaction, actor: StaffActor, organizationLocationId: string) {
  const branch = await requireOrganizationLocation(tx, actor, organizationLocationId);
  await tx.execute(sql`select id from organization_locations where id = ${branch.id} and tenant_id = ${actor.tenantId} for update`);
  const [existing] = await tx.select().from(inventoryLocations).where(and(
    eq(inventoryLocations.tenantId, actor.tenantId),
    eq(inventoryLocations.organizationLocationId, branch.id),
    eq(inventoryLocations.locationType, "branch"),
  )).limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(inventoryLocations).values({
    tenantId: actor.tenantId,
    organizationLocationId: branch.id,
    name: `${branch.name} stock`,
    locationType: "branch",
  }).returning();
  if (!created) throw new Error("Could not create stock location");
  return created;
}

async function ensureMemberStockLocation(tx: Transaction, actor: StaffActor, membershipId: string) {
  await tx.execute(sql`select id from memberships where id = ${membershipId} and tenant_id = ${actor.tenantId} and organization_id = ${actor.organizationId} for update`);
  const [member] = await tx.select({ membership: memberships, personName: user.name }).from(memberships)
    .innerJoin(user, eq(memberships.userId, user.id)).where(and(
      eq(memberships.id, membershipId),
      eq(memberships.tenantId, actor.tenantId),
      eq(memberships.organizationId, actor.organizationId),
      inArray(memberships.status, ["active", "invited"]),
    )).limit(1);
  if (!member) throw new DomainError("NOT_FOUND", "Team member not found.", 404);
  if (actor.role === "technician" && member.membership.id !== actor.membershipId) throw new DomainError("NOT_FOUND", "Team member not found.", 404);
  if (!actor.allLocations && actor.role !== "technician") {
    const scopes = await tx.select({ locationId: membershipLocationScopes.locationId }).from(membershipLocationScopes).where(and(
      eq(membershipLocationScopes.tenantId, actor.tenantId),
      eq(membershipLocationScopes.membershipId, membershipId),
    ));
    const memberLocationIds = new Set(scopes.map((scope) => scope.locationId));
    if (member.membership.defaultLocationId) memberLocationIds.add(member.membership.defaultLocationId);
    if (![...memberLocationIds].some((id) => hasLocationAccess(actor, id))) throw new DomainError("NOT_FOUND", "Team member not found.", 404);
  }
  const [existing] = await tx.select().from(inventoryLocations).where(and(
    eq(inventoryLocations.tenantId, actor.tenantId),
    eq(inventoryLocations.membershipId, membershipId),
    inArray(inventoryLocations.locationType, ["vehicle", "technician"]),
  )).limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(inventoryLocations).values({
    tenantId: actor.tenantId,
    membershipId,
    name: `${member.personName}'s vehicle stock`,
    locationType: "vehicle",
  }).returning();
  if (!created) throw new Error("Could not create team stock location");
  return created;
}

async function resolveInventoryLocation(db: Transaction, actor: StaffActor, input: {
  inventoryLocationId?: string;
  locationId?: string;
  membershipId?: string;
}) {
  if (input.inventoryLocationId) return requireInventoryLocation(db, actor, input.inventoryLocationId);
  if (input.locationId) {
    const visible = await visibleInventoryLocations(db, actor);
    const stockLocation = visible.find((item) => item.id === input.locationId);
    if (stockLocation) return stockLocation;
    const branch = await requireOrganizationLocation(db, actor, input.locationId);
    return ensureBranchStockLocation(db, actor, branch.id);
  }
  if (input.membershipId) return ensureMemberStockLocation(db, actor, input.membershipId);
  const branch = await defaultOrganizationLocation(db, actor);
  return ensureBranchStockLocation(db, actor, branch.id);
}

async function getStockBalance(tx: Transaction, actor: StaffActor, itemId: string, inventoryLocationId: string): Promise<bigint> {
  const result = await tx.execute(sql`select coalesce(sum(case
    when movement_type in ('receive', 'transfer_in', 'return', 'sale_return') then quantity
    when movement_type in ('transfer_out', 'consume', 'sell') then -quantity
    when movement_type = 'adjust' then quantity
    else 0 end), 0)::text as balance
    from stock_movements
    where tenant_id = ${actor.tenantId} and inventory_item_id = ${itemId} and inventory_location_id = ${inventoryLocationId}`);
  const balance = result.rows[0]?.balance ?? "0";
  return quantityUnits(balance);
}

async function recordLowStock(tx: Transaction, actor: StaffActor, itemId: string, inventoryLocationId: string, locationId: string | null, balanceUnits: bigint) {
  const [rule] = await tx.select().from(reorderRules).where(and(
    eq(reorderRules.tenantId, actor.tenantId),
    eq(reorderRules.inventoryItemId, itemId),
    eq(reorderRules.inventoryLocationId, inventoryLocationId),
    eq(reorderRules.active, true),
  )).limit(1);
  if (!rule || balanceUnits >= quantityUnits(rule.reorderThreshold)) return;
  await recordOperation(tx, actor, {
    eventType: "inventory.low_stock",
    entityType: "inventory_item",
    entityId: itemId,
    locationId,
    payload: { inventoryLocationId, quantity: formatQuantity(balanceUnits), reorderThreshold: rule.reorderThreshold },
  });
}

function locationLabel(location: { name: string; branchName?: string | null; membershipName?: string | null }) {
  return location.branchName ? `${location.branchName} stock` : location.name || `${location.membershipName ?? "Team member"} stock`;
}

async function organizationView(actor: StaffActor, locationId?: string) {
  const db = getDb();
  const locations = await listOrganizationLocations(db, actor);
  const members = await db.select({
    id: memberships.id,
    defaultLocationId: memberships.defaultLocationId,
    name: user.name,
    role: roleTemplates.key,
  }).from(memberships).innerJoin(user, eq(memberships.userId, user.id)).innerJoin(roleTemplates, eq(memberships.roleTemplateId, roleTemplates.id)).where(and(
    eq(memberships.tenantId, actor.tenantId),
    eq(memberships.organizationId, actor.organizationId),
    inArray(memberships.status, ["active", "invited"]),
  ));
  const scopes = members.length ? await db.select({ membershipId: membershipLocationScopes.membershipId, locationId: membershipLocationScopes.locationId })
    .from(membershipLocationScopes).where(and(
      eq(membershipLocationScopes.tenantId, actor.tenantId),
      inArray(membershipLocationScopes.membershipId, members.map((member) => member.id)),
    )) : [];
  const scopesByMember = new Map<string, Set<string>>();
  for (const scope of scopes) {
    const memberScopes = scopesByMember.get(scope.membershipId) ?? new Set<string>();
    memberScopes.add(scope.locationId);
    scopesByMember.set(scope.membershipId, memberScopes);
  }
  const items = locations.map((location) => {
    const assigned = members.filter((member) => member.defaultLocationId === location.id || scopesByMember.get(member.id)?.has(location.id));
    const manager = assigned.find((member) => member.role === "office" || member.role === "owner");
    const address = [location.addressLine1, location.addressLine2, location.city, location.region, location.postalCode].filter(Boolean).join(", ");
    return {
      id: location.id,
      name: location.name,
      address,
      phone: location.phone,
      email: location.email,
      timezone: location.timezone,
      managerName: manager?.name ?? "",
      staffCount: assigned.length,
      status: location.active ? "active" : "inactive",
      code: location.code,
      createdAt: location.createdAt,
    };
  });
  if (locationId) {
    const item = items.find((location) => location.id === locationId);
    if (!item) throw new DomainError("NOT_FOUND", "Location not found.", 404);
    return item;
  }
  return items;
}

const organizationCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(240).optional(),
  city: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(30).optional(),
  countryCode: z.string().length(2).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.email().optional().or(z.literal("")),
});

async function createOrganizationLocation(request: Request, actor: StaffActor): Promise<Response> {
  const body = await readBody(request, organizationCreateSchema);
  const db = getDb();
  const created = await db.transaction(async (tx) => {
    const codeBase = body.name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "LOC";
    let code = `${codeBase}-${randomUUID().slice(0, 4).toUpperCase()}`;
    let attempt = 0;
    while (attempt < 3) {
      const [existing] = await tx.select({ id: organizationLocations.id }).from(organizationLocations).where(and(
        eq(organizationLocations.tenantId, actor.tenantId),
        eq(organizationLocations.organizationId, actor.organizationId),
        eq(organizationLocations.code, code),
      )).limit(1);
      if (!existing) break;
      code = `${codeBase}-${randomUUID().slice(0, 4).toUpperCase()}`;
      attempt += 1;
    }
    const [location] = await tx.insert(organizationLocations).values({
      tenantId: actor.tenantId,
      organizationId: actor.organizationId,
      name: body.name,
      code,
      addressLine1: body.address || null,
      city: body.city || null,
      region: body.region || null,
      postalCode: body.postalCode || null,
      countryCode: body.countryCode?.toUpperCase() ?? "US",
      timezone: body.timezone ?? "America/New_York",
      phone: body.phone || null,
      email: body.email || null,
      active: true,
    }).returning();
    if (!location) throw new Error("Could not create location");
    await tx.insert(inventoryLocations).values({
      tenantId: actor.tenantId,
      organizationLocationId: location.id,
      name: `${location.name} stock`,
      locationType: "branch",
    });
    await recordOperation(tx, actor, {
      eventType: "organization.location_created",
      entityType: "organization_location",
      entityId: location.id,
      locationId: location.id,
      auditAction: "organization.location_create",
      after: { name: location.name, code: location.code, active: location.active },
    });
    return location;
  });
  const address = [created.addressLine1, created.addressLine2, created.city, created.region, created.postalCode].filter(Boolean).join(", ");
  return json({ item: normalized({ ...created, address, managerName: "", staffCount: 0, status: created.active ? "active" : "inactive" }) }, 201);
}

async function listStaff(actor: StaffActor, memberId?: string) {
  const db = getDb();
  const members = await db.select({
    membership: memberships,
    name: user.name,
    email: user.email,
    role: roleTemplates.key,
  }).from(memberships).innerJoin(user, eq(memberships.userId, user.id)).innerJoin(roleTemplates, eq(memberships.roleTemplateId, roleTemplates.id)).where(and(
    eq(memberships.tenantId, actor.tenantId),
    eq(memberships.organizationId, actor.organizationId),
  )).orderBy(asc(user.name));
  const scopes = members.length ? await db.select({ membershipId: membershipLocationScopes.membershipId, locationId: membershipLocationScopes.locationId })
    .from(membershipLocationScopes).where(and(
      eq(membershipLocationScopes.tenantId, actor.tenantId),
      inArray(membershipLocationScopes.membershipId, members.map((entry) => entry.membership.id)),
    )) : [];
  const locationIdsByMember = new Map<string, Set<string>>();
  for (const scope of scopes) {
    const ids = locationIdsByMember.get(scope.membershipId) ?? new Set<string>();
    ids.add(scope.locationId);
    locationIdsByMember.set(scope.membershipId, ids);
  }
  const locations = await listOrganizationLocations(db, actor);
  const scoped = members.filter((entry) => {
    if (actor.allLocations) return true;
    if (entry.membership.defaultLocationId && hasLocationAccess(actor, entry.membership.defaultLocationId)) return true;
    return [...(locationIdsByMember.get(entry.membership.id) ?? [])].some((id) => hasLocationAccess(actor, id));
  }).map((entry) => {
    const ids = locationIdsByMember.get(entry.membership.id) ?? new Set<string>();
    if (entry.membership.defaultLocationId) ids.add(entry.membership.defaultLocationId);
    const names = locations.filter((location) => ids.has(location.id)).map((location) => location.name);
    return {
      id: entry.membership.id,
      userId: entry.membership.userId,
      name: entry.name,
      email: entry.email,
      role: entry.role,
      locationName: names.join(", "),
      locationIds: names.length ? [...ids].filter((id) => locations.some((location) => location.id === id)) : [],
      status: entry.membership.status,
      createdAt: entry.membership.createdAt,
    };
  });
  if (memberId) {
    const item = scoped.find((entry) => entry.id === memberId);
    if (!item) throw new DomainError("NOT_FOUND", "Team member not found.", 404);
    return item;
  }
  return scoped;
}

const staffCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().transform((email) => email.trim().toLowerCase()),
  role: z.enum(["office", "technician"]).default("technician"),
  locationId: z.uuid().optional(),
});

async function createStaffMember(request: Request, actor: StaffActor): Promise<Response> {
  const body = await readBody(request, staffCreateSchema);
  const db = getDb();
  const location = await defaultOrganizationLocation(db, actor, body.locationId);
  const existingRows = await db.select().from(user).where(sql`lower(${user.email}) = ${body.email}`).limit(1);
  const existingUser = existingRows[0];
  if (existingUser) {
    const [activeMember] = await db.select({ id: memberships.id }).from(memberships).where(and(
      eq(memberships.tenantId, actor.tenantId),
      eq(memberships.organizationId, actor.organizationId),
      eq(memberships.userId, existingUser.id),
      eq(memberships.status, "active"),
    )).limit(1);
    if (activeMember) throw new DomainError("CONFLICT", "This person is already on your team.", 409);
    throw new DomainError("CONFLICT", "This email already has an account and needs to accept an invitation before joining another team.", 409);
  }
  let userId: string | undefined;
  let temporaryPassword: string | undefined;
  let newlyCreatedUser = false;
  if (!userId) {
    temporaryPassword = randomBytes(24).toString("base64url");
    const signup = await auth.api.signUpEmail({
      body: { name: body.name, email: body.email, password: temporaryPassword },
      headers: request.headers,
      asResponse: true,
    });
    const signupPayload = await signup.clone().json().catch(() => null) as { user?: { id?: string } } | null;
    if (!signup.ok || !signupPayload?.user?.id) throw new DomainError("CONFLICT", "This email could not be invited. Check whether it already has an account.", 409);
    userId = signupPayload.user.id;
    newlyCreatedUser = true;
  }

  let createdMembershipId: string | undefined;
  try {
    const member = await db.transaction(async (tx) => {
      const [role] = await tx.select().from(roleTemplates).where(and(
        eq(roleTemplates.tenantId, actor.tenantId),
        eq(roleTemplates.key, body.role),
        eq(roleTemplates.active, true),
      )).limit(1);
      const resolvedRole = role ?? (await tx.insert(roleTemplates).values({
        tenantId: actor.tenantId,
        key: body.role,
        name: body.role === "office" ? "Office / Manager" : "Field Technician",
        description: body.role === "office" ? "Office manager" : "Field technician",
        system: true,
        active: true,
      }).returning())[0];
      if (!resolvedRole || !userId) throw new Error("Could not set up staff role");
      const [previous] = await tx.select().from(memberships).where(and(
        eq(memberships.tenantId, actor.tenantId),
        eq(memberships.organizationId, actor.organizationId),
        eq(memberships.userId, userId),
      )).limit(1);
      if (previous?.status === "active") throw new DomainError("CONFLICT", "This person is already on your team.", 409);
      const now = new Date();
      let membership;
      if (previous) {
        [membership] = await tx.update(memberships).set({
          defaultLocationId: location.id,
          roleTemplateId: resolvedRole.id,
          status: "active",
          invitedAt: now,
          joinedAt: newlyCreatedUser ? null : now,
          updatedAt: now,
        }).where(and(eq(memberships.id, previous.id), eq(memberships.tenantId, actor.tenantId))).returning();
        await tx.delete(membershipLocationScopes).where(and(
          eq(membershipLocationScopes.tenantId, actor.tenantId),
          eq(membershipLocationScopes.membershipId, previous.id),
        ));
      } else {
        [membership] = await tx.insert(memberships).values({
          tenantId: actor.tenantId,
          userId,
          organizationId: actor.organizationId,
          defaultLocationId: location.id,
          roleTemplateId: resolvedRole.id,
          status: "active",
          invitedAt: now,
          joinedAt: newlyCreatedUser ? null : now,
        }).returning();
      }
      if (!membership) throw new Error("Could not add staff member");
      createdMembershipId = membership.id;
      await tx.insert(membershipLocationScopes).values({ tenantId: actor.tenantId, membershipId: membership.id, locationId: location.id }).onConflictDoNothing();
      const [person] = await tx.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
      await recordOperation(tx, actor, {
        eventType: "staff.invited",
        entityType: "membership",
        entityId: membership.id,
        locationId: location.id,
        auditAction: "staff.invite",
        before: previous ? { status: previous.status, roleTemplateId: previous.roleTemplateId } : null,
        after: { email: person?.email ?? body.email, role: body.role, locationId: location.id, status: "active" },
      });
      return { membership, name: person?.name ?? body.name, email: person?.email ?? body.email };
    });

    let invite: { email: string; loginUrl?: string; temporaryPassword?: string; passwordResetEmailSent?: boolean } | undefined;
    if (newlyCreatedUser) {
      const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
      if (process.env.NODE_ENV !== "production" && actor.role === "owner") {
        invite = { email: body.email, loginUrl: `${baseUrl.replace(/\/$/, "")}/login`, temporaryPassword };
      } else {
        try {
          await auth.api.requestPasswordReset({
            body: { email: body.email, redirectTo: `${baseUrl.replace(/\/$/, "")}/login?invite=1` },
            headers: request.headers,
          });
          invite = { email: body.email, passwordResetEmailSent: true };
        } catch {
          await db.transaction(async (tx) => {
            if (createdMembershipId) {
              await tx.delete(membershipLocationScopes).where(and(eq(membershipLocationScopes.tenantId, actor.tenantId), eq(membershipLocationScopes.membershipId, createdMembershipId)));
              await tx.delete(memberships).where(and(eq(memberships.id, createdMembershipId), eq(memberships.tenantId, actor.tenantId)));
            }
            if (userId) await tx.delete(user).where(eq(user.id, userId));
          });
          throw new DomainError("EXTERNAL_SERVICE_ERROR", "We couldn't send the invitation setup email, so the new account was removed. Check email delivery and try again.", 503);
        }
      }
    }
    const item = {
      id: member.membership.id,
      userId,
      name: member.name,
      email: member.email,
      role: body.role,
      locationName: location.name,
      locationIds: [location.id],
      status: member.membership.status,
      createdAt: member.membership.createdAt,
    };
    return json({ item: normalized(item), ...(invite ? { invite } : {}) }, 201);
  } catch (error) {
    if (newlyCreatedUser && userId) {
      await db.transaction(async (tx) => {
        if (createdMembershipId) {
          await tx.delete(membershipLocationScopes).where(and(eq(membershipLocationScopes.tenantId, actor.tenantId), eq(membershipLocationScopes.membershipId, createdMembershipId)));
          await tx.delete(memberships).where(and(eq(memberships.id, createdMembershipId), eq(memberships.tenantId, actor.tenantId)));
        }
        await tx.delete(user).where(eq(user.id, userId!));
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function handleOrganization(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length > 2) return null;
  if (request.method === "GET") {
    authorize(actor, "organization.read");
    if (path.length === 2) return json({ item: await organizationView(actor, path[1]) });
    return json({ items: await organizationView(actor) });
  }
  if (request.method === "POST" && path.length === 1) {
    authorize(actor, "organization.locations_manage");
    return createOrganizationLocation(request, actor);
  }
  return null;
}

async function handleStaff(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length > 2) return null;
  if (request.method === "GET") {
    authorize(actor, "staff.read");
    if (path.length === 2) return json({ item: await listStaff(actor, path[1]) });
    return json({ items: await listStaff(actor) });
  }
  if (request.method === "POST" && path.length === 1) {
    authorize(actor, "staff.invite");
    return createStaffMember(request, actor);
  }
  return null;
}

async function inventoryView(actor: StaffActor, itemId?: string) {
  const db = getDb();
  const items = await db.select().from(inventoryItems).where(and(
    eq(inventoryItems.tenantId, actor.tenantId),
    itemId ? eq(inventoryItems.id, itemId) : undefined,
  )).orderBy(asc(inventoryItems.name));
  if (itemId && !items[0]) throw new DomainError("NOT_FOUND", "Inventory item not found.", 404);
  const locations = await visibleInventoryLocations(db, actor);
  const locationIds = locations.map((location) => location.id);
  const balances = locationIds.length ? await db.select({
    itemId: stockMovements.inventoryItemId,
    locationId: stockMovements.inventoryLocationId,
    quantity: sql<string>`coalesce(sum(case
      when ${stockMovements.movementType} in ('receive', 'transfer_in', 'return', 'sale_return') then ${stockMovements.quantity}
      when ${stockMovements.movementType} in ('transfer_out', 'consume', 'sell') then -${stockMovements.quantity}
      when ${stockMovements.movementType} = 'adjust' then ${stockMovements.quantity}
      else 0 end), 0)::text`,
  }).from(stockMovements).where(and(
    eq(stockMovements.tenantId, actor.tenantId),
    inArray(stockMovements.inventoryLocationId, locationIds),
    itemId ? eq(stockMovements.inventoryItemId, itemId) : undefined,
  )).groupBy(stockMovements.inventoryItemId, stockMovements.inventoryLocationId) : [];
  const rules = locationIds.length ? await db.select().from(reorderRules).where(and(
    eq(reorderRules.tenantId, actor.tenantId),
    eq(reorderRules.active, true),
    inArray(reorderRules.inventoryLocationId, locationIds),
    itemId ? eq(reorderRules.inventoryItemId, itemId) : undefined,
  )) : [];
  const balancesByItem = new Map<string, Map<string, bigint>>();
  for (const balance of balances) {
    const byLocation = balancesByItem.get(balance.itemId) ?? new Map<string, bigint>();
    byLocation.set(balance.locationId, quantityUnits(balance.quantity));
    balancesByItem.set(balance.itemId, byLocation);
  }
  const rulesByItem = new Map<string, Map<string, bigint>>();
  for (const rule of rules) {
    const byLocation = rulesByItem.get(rule.inventoryItemId) ?? new Map<string, bigint>();
    byLocation.set(rule.inventoryLocationId, quantityUnits(rule.reorderThreshold));
    rulesByItem.set(rule.inventoryItemId, byLocation);
  }
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const result = items.map((item) => {
    const itemBalances = balancesByItem.get(item.id) ?? new Map<string, bigint>();
    const itemRules = rulesByItem.get(item.id) ?? new Map<string, bigint>();
    const perLocation = locations.map((location) => ({
      locationId: location.id,
      locationName: locationLabel(location),
      quantity: formatQuantity(itemBalances.get(location.id) ?? 0n),
      reorderThreshold: itemRules.has(location.id) ? formatQuantity(itemRules.get(location.id)!) : null,
    }));
    const quantity = [...itemBalances.values()].reduce((total, value) => total + value, 0n);
    const threshold = [...itemRules.values()].reduce((total, value) => total + value, 0n);
    const firstLocation = locations[0];
    return {
      id: item.id,
      name: item.name,
      sku: item.sku,
      description: item.description,
      unit: item.unit,
      active: item.active,
      status: item.active ? "active" : "inactive",
      quantity: formatQuantity(quantity),
      reorderThreshold: formatQuantity(threshold),
      locationName: locations.length > 1 ? "Across accessible locations" : firstLocation ? locationLabel(firstLocation) : "No stock location",
      locations: perLocation,
      createdAt: item.createdAt,
    };
  });
  if (!itemId) return result;
  const item = result[0]!;
  const movementRows = locationIds.length ? await db.select().from(stockMovements).where(and(
    eq(stockMovements.tenantId, actor.tenantId),
    eq(stockMovements.inventoryItemId, itemId),
    inArray(stockMovements.inventoryLocationId, locationIds),
  )).orderBy(sql`${stockMovements.occurredAt} desc`).limit(50) : [];
  return {
    ...item,
    movements: movementRows.map((movement) => ({
      id: movement.id,
      movementType: movement.movementType,
      quantity: movement.quantity,
      locationName: locationById.has(movement.inventoryLocationId) ? locationLabel(locationById.get(movement.inventoryLocationId)!) : "Stock location",
      jobId: movement.jobId,
      reason: movement.reason,
      occurredAt: movement.occurredAt,
    })),
  };
}

const quantitySchema = z.union([z.number().finite(), z.string().trim().min(1)]).refine((value) => {
  try { quantityInput(value, true); return true; } catch { return false; }
}, "Enter a non-negative quantity with up to four decimal places.");
const positiveQuantitySchema = z.union([z.number().finite(), z.string().trim().min(1)]).refine((value) => {
  try { quantityInput(value); return true; } catch { return false; }
}, "Quantity must be greater than zero and have up to four decimal places.");

const inventoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  sku: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  unit: z.string().trim().min(1).max(40).optional(),
  quantity: quantitySchema.optional(),
  reorderThreshold: quantitySchema.optional(),
  locationId: z.uuid().optional(),
  unitCostMinor: z.number().int().nonnegative().optional(),
});

async function createInventoryItem(request: Request, actor: StaffActor): Promise<Response> {
  const body = await readBody(request, inventoryCreateSchema);
  const initialQuantity = quantityInput(body.quantity ?? 0, true);
  const threshold = body.reorderThreshold === undefined ? undefined : quantityInput(body.reorderThreshold, true);
  if (quantityUnits(initialQuantity) > 0n) requirePermission(actor, "inventory.receive");
  if (threshold !== undefined) requirePermission(actor, "inventory.reorder_manage");
  const location = await defaultOrganizationLocation(getDb(), actor, body.locationId);
  const db = getDb();
  const created = await db.transaction(async (tx) => {
    const [item] = await tx.insert(inventoryItems).values({
      tenantId: actor.tenantId,
      name: body.name,
      sku: body.sku || null,
      description: body.description || null,
      unit: body.unit ?? "unit",
      defaultCostMinor: body.unitCostMinor === undefined ? null : BigInt(body.unitCostMinor),
      currency: body.unitCostMinor === undefined ? null : (await tx.select({ currency: tenants.defaultCurrency }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1))[0]?.currency ?? "USD",
      active: true,
    }).returning();
    if (!item) throw new Error("Could not create inventory item");
    const stockLocation = await ensureBranchStockLocation(tx, actor, location.id);
    await recordOperation(tx, actor, {
      eventType: "inventory.item_created",
      entityType: "inventory_item",
      entityId: item.id,
      locationId: location.id,
      auditAction: "inventory.item.create",
      after: { name: item.name, sku: item.sku, unit: item.unit, locationId: location.id },
    });
    if (quantityUnits(initialQuantity) > 0n) {
      const movementId = randomUUID();
      await tx.insert(stockMovements).values({
        id: movementId,
        tenantId: actor.tenantId,
        inventoryItemId: item.id,
        inventoryLocationId: stockLocation.id,
        movementType: "receive",
        quantity: initialQuantity,
        unitCostMinor: body.unitCostMinor === undefined ? null : BigInt(body.unitCostMinor),
        currency: body.unitCostMinor === undefined ? null : item.currency ?? "USD",
        reason: "Starting stock",
        actorMembershipId: actor.membershipId,
        metadata: { source: "inventory_item_create" },
      });
      await recordOperation(tx, actor, {
        eventType: "inventory.moved",
        entityType: "stock_movement",
        entityId: movementId,
        locationId: location.id,
        auditAction: "inventory.receive",
        after: { inventoryItemId: item.id, inventoryLocationId: stockLocation.id, movementType: "receive", quantity: initialQuantity },
      });
    }
    if (threshold !== undefined) {
      requirePermission(actor, "inventory.reorder_manage");
      await tx.insert(reorderRules).values({
        tenantId: actor.tenantId,
        inventoryItemId: item.id,
        inventoryLocationId: stockLocation.id,
        reorderThreshold: threshold,
        active: true,
      });
    }
    await recordLowStock(tx, actor, item.id, stockLocation.id, location.id, quantityUnits(initialQuantity));
    return item;
  });
  return json({ item: await inventoryView(actor, created.id) }, 201);
}

const movementSchema = z.object({
  quantity: positiveQuantitySchema,
  inventoryLocationId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  unitCostMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  reason: z.string().trim().max(500).optional(),
  jobId: z.uuid().optional(),
  toInventoryLocationId: z.uuid().optional(),
  toLocationId: z.uuid().optional(),
  toMembershipId: z.uuid().optional(),
});

async function requireInventoryItem(db: Executor, actor: StaffActor, itemId: string) {
  const [item] = await db.select().from(inventoryItems).where(and(
    eq(inventoryItems.id, itemId),
    eq(inventoryItems.tenantId, actor.tenantId),
  )).limit(1);
  if (!item) throw new DomainError("NOT_FOUND", "Inventory item not found.", 404);
  return item;
}

async function createMovement(tx: Transaction, actor: StaffActor, input: {
  itemId: string;
  location: { id: string; organizationLocationId: string | null };
  type: "receive" | "transfer_out" | "transfer_in" | "consume";
  quantity: string;
  reason?: string;
  unitCostMinor?: bigint | null;
  currency?: string | null;
  jobId?: string | null;
  linkedMovementId?: string | null;
  movementId?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const movementId = input.movementId ?? randomUUID();
  await tx.insert(stockMovements).values({
    id: movementId,
    tenantId: actor.tenantId,
    inventoryItemId: input.itemId,
    inventoryLocationId: input.location.id,
    linkedMovementId: input.linkedMovementId ?? null,
    movementType: input.type,
    quantity: input.quantity,
    unitCostMinor: input.unitCostMinor ?? null,
    currency: input.currency ?? null,
    jobId: input.jobId ?? null,
    reason: input.reason || null,
    actorMembershipId: actor.membershipId,
    metadata: input.metadata ?? {},
  });
  await recordOperation(tx, actor, {
    eventType: "inventory.moved",
    entityType: "stock_movement",
    entityId: movementId,
    locationId: input.location.organizationLocationId,
    auditAction: `inventory.${input.type}`,
    after: { inventoryItemId: input.itemId, inventoryLocationId: input.location.id, movementType: input.type, quantity: input.quantity, jobId: input.jobId ?? null, reason: input.reason ?? null },
  });
  return movementId;
}

async function performInventoryMovement(request: Request, actor: StaffActor, itemId: string, action: "receive" | "transfer" | "consume"): Promise<Response> {
  const permission: Permission = action === "receive" ? "inventory.receive" : action === "transfer" ? "inventory.transfer" : "inventory.consume";
  requirePermission(actor, permission);
  const body = await readBody(request, movementSchema);
  const quantity = quantityInput(body.quantity);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const item = await requireInventoryItem(tx, actor, itemId);
    if (!item.active) throw new DomainError("CONFLICT", "This inventory item is inactive.", 409);
    await tx.execute(sql`select id from inventory_items where id = ${item.id} and tenant_id = ${actor.tenantId} for update`);
    const source = await resolveInventoryLocation(tx, actor, { inventoryLocationId: body.inventoryLocationId, locationId: body.locationId });
    const sourceLocation = { id: source.id, organizationLocationId: source.organizationLocationId };
    const sourceBalance = await getStockBalance(tx, actor, item.id, source.id);
    let jobId: string | undefined;
    if (action === "consume") {
      if (!body.jobId) throw new DomainError("VALIDATION_ERROR", "Choose the job this material was used on.", 422);
      requirePermission(actor, "jobs.read");
      const [job] = await tx.select().from(jobs).where(and(
        eq(jobs.id, body.jobId),
        eq(jobs.tenantId, actor.tenantId),
        eq(jobs.organizationId, actor.organizationId),
        actor.allLocations ? undefined : inArray(jobs.organizationLocationId, [...actor.locationIds]),
      )).limit(1);
      if (!job) throw new DomainError("NOT_FOUND", "Job not found.", 404);
      if (actor.role === "technician") {
        const [assigned] = await tx.select({ id: jobAssignments.id }).from(jobAssignments).where(and(
          eq(jobAssignments.tenantId, actor.tenantId),
          eq(jobAssignments.jobId, job.id),
          eq(jobAssignments.membershipId, actor.membershipId),
          isNull(jobAssignments.removedAt),
        )).limit(1);
        if (!assigned) throw new DomainError("NOT_FOUND", "Job not found.", 404);
      }
      if (actor.role === "technician" && job.status !== "in_progress") throw new DomainError("CONFLICT", "Material can be recorded after the assigned job has started.", 409);
      if (sourceBalance < quantityUnits(quantity)) throw new DomainError("CONFLICT", "There isn't enough stock at that location.", 409);
      jobId = job.id;
      const movementId = await createMovement(tx, actor, { itemId: item.id, location: sourceLocation, type: "consume", quantity, jobId, reason: body.reason });
      const [usage] = await tx.insert(jobMaterialUsage).values({
        tenantId: actor.tenantId,
        jobId: job.id,
        inventoryItemId: item.id,
        inventoryLocationId: source.id,
        quantity,
        stockMovementId: movementId,
      }).returning({ id: jobMaterialUsage.id });
      if (!usage) throw new Error("Could not record job material usage");
      await recordOperation(tx, actor, {
        eventType: "job_material.used",
        entityType: "job_material_usage",
        entityId: usage.id,
        locationId: job.organizationLocationId,
        payload: { jobId: job.id, inventoryItemId: item.id, inventoryLocationId: source.id, quantity },
        auditAction: "inventory.consume_for_job",
        after: { jobId: job.id, inventoryItemId: item.id, inventoryLocationId: source.id, quantity },
      });
      await recordLowStock(tx, actor, item.id, source.id, source.organizationLocationId, sourceBalance - quantityUnits(quantity));
      return { movementId, balance: sourceBalance - quantityUnits(quantity), locationId: source.id, jobId };
    }
    if (action === "receive") {
      const movementId = await createMovement(tx, actor, {
        itemId: item.id,
        location: sourceLocation,
        type: "receive",
        quantity,
        reason: body.reason,
        unitCostMinor: body.unitCostMinor === undefined ? null : BigInt(body.unitCostMinor),
        currency: body.currency?.toUpperCase() ?? item.currency ?? null,
      });
      const balance = sourceBalance + quantityUnits(quantity);
      await recordLowStock(tx, actor, item.id, source.id, source.organizationLocationId, balance);
      return { movementId, balance, locationId: source.id };
    }
    const destinationInput = {
      inventoryLocationId: body.toInventoryLocationId,
      locationId: body.toLocationId,
      membershipId: body.toMembershipId,
    };
    if (!destinationInput.inventoryLocationId && !destinationInput.locationId && !destinationInput.membershipId) {
      throw new DomainError("VALIDATION_ERROR", "Choose where the stock is going.", 422);
    }
    const destination = await resolveInventoryLocation(tx, actor, destinationInput);
    if (destination.id === source.id) throw new DomainError("VALIDATION_ERROR", "Choose a different destination location.", 422);
    if (sourceBalance < quantityUnits(quantity)) throw new DomainError("CONFLICT", "There isn't enough stock to transfer.", 409);
    const outId = randomUUID();
    const inId = randomUUID();
    await createMovement(tx, actor, { itemId: item.id, location: sourceLocation, type: "transfer_out", quantity, reason: body.reason, linkedMovementId: inId, movementId: outId });
    await createMovement(tx, actor, { itemId: item.id, location: { id: destination.id, organizationLocationId: destination.organizationLocationId }, type: "transfer_in", quantity, reason: body.reason, linkedMovementId: outId, movementId: inId });
    const destinationBalance = await getStockBalance(tx, actor, item.id, destination.id);
    await recordLowStock(tx, actor, item.id, source.id, source.organizationLocationId, sourceBalance - quantityUnits(quantity));
    await recordLowStock(tx, actor, item.id, destination.id, destination.organizationLocationId, destinationBalance);
    return { movementId: outId, linkedMovementId: inId, balance: sourceBalance - quantityUnits(quantity), locationId: source.id, destinationId: destination.id };
  });
  return json({ item: await inventoryView(actor, itemId), movement: normalized(result) }, 201);
}

async function handleInventory(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length === 1 && request.method === "GET") {
    authorize(actor, "inventory.read");
    return json({ items: await inventoryView(actor) });
  }
  if (path.length === 2 && request.method === "GET") {
    authorize(actor, "inventory.read");
    return json({ item: await inventoryView(actor, path[1]) });
  }
  if (path.length === 1 && request.method === "POST") {
    authorize(actor, "inventory.manage_catalog");
    return createInventoryItem(request, actor);
  }
  if (path.length === 3 && path[1] !== "movements" && request.method === "POST" && ["receive", "transfer", "consume"].includes(path[2]!)) {
    authorize(actor, path[2] === "receive" ? "inventory.receive" : path[2] === "transfer" ? "inventory.transfer" : "inventory.consume");
    return performInventoryMovement(request, actor, path[1]!, path[2] as "receive" | "transfer" | "consume");
  }
  if (path.length === 3 && path[1] === "movements" && request.method === "POST" && ["receive", "transfer", "consume"].includes(path[2]!)) {
    authorize(actor, path[2] === "receive" ? "inventory.receive" : path[2] === "transfer" ? "inventory.transfer" : "inventory.consume");
    const body = await readBody(request, movementSchema.extend({ inventoryItemId: z.uuid() }));
    const requestWithBody = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) });
    return performInventoryMovement(requestWithBody, actor, body.inventoryItemId, path[2] as "receive" | "transfer" | "consume");
  }
  return null;
}

const vendorSchema = z.object({
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(120).optional(),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  website: z.url().optional().or(z.literal("")),
  address: z.string().trim().max(500).optional(),
  accountReference: z.string().trim().max(160).optional(),
});

async function handleVendors(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length !== 1) return null;
  if (request.method === "GET") {
    authorize(actor, "inventory.read");
    const list = await getDb().select().from(vendors).where(eq(vendors.tenantId, actor.tenantId)).orderBy(asc(vendors.name));
    return json({ items: normalized(list.map((vendor) => ({ ...vendor, status: vendor.active ? "active" : "inactive" }))) });
  }
  if (request.method === "POST") {
    authorize(actor, "inventory.reorder_manage");
    const body = await readBody(request, vendorSchema);
    const db = getDb();
    const vendor = await db.transaction(async (tx) => {
      const [created] = await tx.insert(vendors).values({
        tenantId: actor.tenantId,
        name: body.name,
        contactName: body.contactName || null,
        email: body.email || null,
        phone: body.phone || null,
        website: body.website || null,
        address: body.address ? { line1: body.address } : null,
        accountReference: body.accountReference || null,
        active: true,
      }).returning();
      if (!created) throw new Error("Could not create vendor");
      await recordOperation(tx, actor, {
        eventType: "inventory.vendor_created",
        entityType: "vendor",
        entityId: created.id,
        auditAction: "inventory.vendor.create",
        after: { name: created.name, email: created.email, active: created.active },
      });
      return created;
    });
    return json({ item: normalized({ ...vendor, status: "active" }) }, 201);
  }
  return null;
}

const purchaseOrderLineSchema = z.object({
  inventoryItemId: z.uuid(),
  quantity: positiveQuantitySchema,
  unitCostMinor: z.number().int().nonnegative().optional(),
  unitCostCents: z.number().int().nonnegative().optional(),
  description: z.string().trim().max(240).optional(),
}).refine((line) => line.unitCostMinor === undefined || line.unitCostCents === undefined, "Use one unit cost field.");

const purchaseOrderCreateSchema = z.object({
  vendorId: z.uuid(),
  locationId: z.uuid().optional(),
  status: z.enum(["draft", "ordered"]).default("ordered"),
  expectedAt: z.union([z.iso.datetime(), z.iso.date()]).optional(),
  currency: z.string().length(3).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(purchaseOrderLineSchema).min(1).max(100),
});

function dateFromInput(value?: string): Date | undefined {
  if (!value) return undefined;
  return value.length === 10 ? new Date(`${value}T12:00:00.000Z`) : new Date(value);
}

async function purchaseOrderView(actor: StaffActor, orderId?: string) {
  const db = getDb();
  const locations = await listOrganizationLocations(db, actor);
  const accessibleLocationIds = locations.map((location) => location.id);
  const orders = accessibleLocationIds.length ? await db.select({ order: purchaseOrders, vendorName: vendors.name, locationName: organizationLocations.name })
    .from(purchaseOrders).innerJoin(vendors, and(eq(purchaseOrders.vendorId, vendors.id), eq(vendors.tenantId, actor.tenantId)))
    .leftJoin(organizationLocations, and(eq(purchaseOrders.organizationLocationId, organizationLocations.id), eq(organizationLocations.tenantId, actor.tenantId), eq(organizationLocations.organizationId, actor.organizationId)))
    .where(and(
      eq(purchaseOrders.tenantId, actor.tenantId),
      inArray(purchaseOrders.organizationLocationId, accessibleLocationIds),
      orderId ? eq(purchaseOrders.id, orderId) : undefined,
    )).orderBy(sql`${purchaseOrders.createdAt} desc`) : [];
  if (orderId && !orders[0]) throw new DomainError("NOT_FOUND", "Purchase order not found.", 404);
  const orderIds = orders.map((entry) => entry.order.id);
  const lines = orderIds.length ? await db.select({
    line: purchaseOrderItems,
    inventoryItemName: inventoryItems.name,
    sku: inventoryItems.sku,
  }).from(purchaseOrderItems).innerJoin(inventoryItems, and(
    eq(purchaseOrderItems.inventoryItemId, inventoryItems.id),
    eq(inventoryItems.tenantId, actor.tenantId),
  )).where(and(eq(purchaseOrderItems.tenantId, actor.tenantId), inArray(purchaseOrderItems.purchaseOrderId, orderIds))) : [];
  const linesByOrder = new Map<string, unknown[]>();
  for (const entry of lines) {
    const values = linesByOrder.get(entry.line.purchaseOrderId) ?? [];
    values.push(normalized({ ...entry.line, inventoryItemName: entry.inventoryItemName, sku: entry.sku }));
    linesByOrder.set(entry.line.purchaseOrderId, values);
  }
  const result = orders.map(({ order, vendorName, locationName }) => normalized({
    ...order,
    vendorName,
    locationName: locationName ?? "",
    items: linesByOrder.get(order.id) ?? [],
  }));
  return orderId ? result[0] : result;
}

async function handlePurchaseOrders(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length === 1 && request.method === "GET") {
    authorize(actor, "inventory.read");
    return json({ items: await purchaseOrderView(actor) });
  }
  if (path.length === 1 && request.method === "POST") {
    authorize(actor, "inventory.reorder_manage");
    const body = await readBody(request, purchaseOrderCreateSchema);
    const db = getDb();
    const createdId = await db.transaction(async (tx) => {
      const [vendor] = await tx.select({ id: vendors.id }).from(vendors).where(and(
        eq(vendors.id, body.vendorId),
        eq(vendors.tenantId, actor.tenantId),
        eq(vendors.active, true),
      )).limit(1);
      if (!vendor) throw new DomainError("NOT_FOUND", "Vendor not found.", 404);
      const location = await defaultOrganizationLocation(tx, actor, body.locationId);
      const items = await tx.select().from(inventoryItems).where(and(
        eq(inventoryItems.tenantId, actor.tenantId),
        inArray(inventoryItems.id, body.lines.map((line) => line.inventoryItemId)),
        eq(inventoryItems.active, true),
      ));
      const itemById = new Map(items.map((item) => [item.id, item]));
      if (itemById.size !== new Set(body.lines.map((line) => line.inventoryItemId)).size) throw new DomainError("NOT_FOUND", "One or more inventory items could not be found.", 404);
      const details = body.lines.map((line) => {
        const item = itemById.get(line.inventoryItemId)!;
        const quantity = quantityInput(line.quantity);
        const unitCostMinor = line.unitCostMinor !== undefined
          ? BigInt(line.unitCostMinor)
          : line.unitCostCents !== undefined ? BigInt(line.unitCostCents) : item.defaultCostMinor ?? 0n;
        return {
          inventoryItemId: item.id,
          description: line.description || item.name,
          quantityOrdered: quantity,
          unitCostMinor,
          totalMinor: amountForQuantity(unitCostMinor, quantityUnits(quantity)),
        };
      });
      const subtotalMinor = details.reduce((total, line) => total + line.totalMinor, 0n);
      const orderNumber = `PO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const currency = body.currency?.toUpperCase() ?? (await tx.select({ currency: tenants.defaultCurrency }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1))[0]?.currency ?? "USD";
      const orderedAt = body.status === "ordered" ? new Date() : null;
      const [order] = await tx.insert(purchaseOrders).values({
        tenantId: actor.tenantId,
        vendorId: vendor.id,
        organizationLocationId: location.id,
        status: body.status,
        orderNumber,
        orderedAt,
        expectedAt: dateFromInput(body.expectedAt) ?? null,
        subtotalMinor,
        totalMinor: subtotalMinor,
        currency,
        notes: body.notes || null,
      }).returning();
      if (!order) throw new Error("Could not create purchase order");
      await tx.insert(purchaseOrderItems).values(details.map((line) => ({
        tenantId: actor.tenantId,
        purchaseOrderId: order.id,
        ...line,
      })));
      await recordOperation(tx, actor, {
        eventType: "purchase_order.created",
        entityType: "purchase_order",
        entityId: order.id,
        locationId: location.id,
        auditAction: "inventory.purchase_order.create",
        after: { orderNumber: order.orderNumber, vendorId: order.vendorId, status: order.status, totalMinor: subtotalMinor.toString(), lineCount: details.length },
      });
      return order.id;
    });
    return json({ item: await purchaseOrderView(actor, createdId) }, 201);
  }
  if (path.length === 2 && request.method === "GET") {
    authorize(actor, "inventory.read");
    return json({ item: await purchaseOrderView(actor, path[1]) });
  }
  if (path.length === 3 && path[2] === "receive" && request.method === "POST") {
    authorize(actor, "inventory.receive");
    return receivePurchaseOrder(request, actor, path[1]!);
  }
  return null;
}

const receiveLineSchema = z.object({
  purchaseOrderItemId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  inventoryItemId: z.uuid().optional(),
  quantity: positiveQuantitySchema,
}).refine((line) => [line.purchaseOrderItemId, line.itemId, line.inventoryItemId].filter(Boolean).length === 1, "Choose one purchase order line or inventory item.");

const receiveOrderSchema = z.object({
  lines: z.array(receiveLineSchema).min(1).max(100),
  inventoryLocationId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  reason: z.string().trim().max(500).optional(),
});

async function receivePurchaseOrder(request: Request, actor: StaffActor, orderId: string): Promise<Response> {
  const body = await readBody(request, receiveOrderSchema);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from purchase_orders where id = ${orderId} and tenant_id = ${actor.tenantId} for update`);
    const [order] = await tx.select().from(purchaseOrders).where(and(
      eq(purchaseOrders.id, orderId),
      eq(purchaseOrders.tenantId, actor.tenantId),
    )).limit(1);
    if (!order || !order.organizationLocationId) throw new DomainError("NOT_FOUND", "Purchase order not found.", 404);
    await requireOrganizationLocation(tx, actor, order.organizationLocationId);
    if (!["ordered", "partially_received"].includes(order.status)) throw new DomainError("CONFLICT", "Only an open purchase order can be received.", 409);
    const orderLines = await tx.select().from(purchaseOrderItems).where(and(
      eq(purchaseOrderItems.tenantId, actor.tenantId),
      eq(purchaseOrderItems.purchaseOrderId, order.id),
    ));
    if (body.locationId && body.locationId !== order.organizationLocationId) {
      throw new DomainError("VALIDATION_ERROR", "Receive this order at its assigned business location.", 422);
    }
    const stockLocation = body.inventoryLocationId
      ? await requireInventoryLocation(tx, actor, body.inventoryLocationId)
      : await ensureBranchStockLocation(tx, actor, order.organizationLocationId);
    if (stockLocation.organizationLocationId !== order.organizationLocationId) {
      throw new DomainError("VALIDATION_ERROR", "Purchase order stock must be received at its assigned business location.", 422);
    }
    const newQuantities = new Map<string, string>();
    const movementIds: string[] = [];
    for (const receipt of body.lines) {
      const key = receipt.purchaseOrderItemId ?? receipt.itemId ?? receipt.inventoryItemId;
      const matching = orderLines.filter((line) => receipt.purchaseOrderItemId
        ? line.id === receipt.purchaseOrderItemId
        : line.inventoryItemId === key);
      if (matching.length !== 1) throw new DomainError("NOT_FOUND", "Purchase order line not found or ambiguous.", 404);
      const line = matching[0]!;
      if (newQuantities.has(line.id)) throw new DomainError("VALIDATION_ERROR", "Receive each purchase order line once per request.", 422);
      const orderedUnits = quantityUnits(line.quantityOrdered);
      const receivedUnits = quantityUnits(line.quantityReceived);
      const receiveUnits = quantityUnits(receipt.quantity);
      if (receivedUnits + receiveUnits > orderedUnits) throw new DomainError("CONFLICT", "Received quantity cannot exceed the amount ordered.", 409);
      const updatedQuantity = formatQuantity(receivedUnits + receiveUnits);
      newQuantities.set(line.id, updatedQuantity);
      await tx.update(purchaseOrderItems).set({ quantityReceived: updatedQuantity, updatedAt: new Date() }).where(and(
        eq(purchaseOrderItems.id, line.id),
        eq(purchaseOrderItems.tenantId, actor.tenantId),
        eq(purchaseOrderItems.purchaseOrderId, order.id),
      ));
      const movementId = await createMovement(tx, actor, {
        itemId: line.inventoryItemId,
        location: { id: stockLocation.id, organizationLocationId: stockLocation.organizationLocationId },
        type: "receive",
        quantity: quantityInput(receipt.quantity),
        reason: body.reason || `Received on ${order.orderNumber}`,
        unitCostMinor: BigInt(line.unitCostMinor),
        currency: order.currency,
        metadata: { purchaseOrderId: order.id, purchaseOrderItemId: line.id },
      });
      movementIds.push(movementId);
      const balance = await getStockBalance(tx, actor, line.inventoryItemId, stockLocation.id);
      await recordLowStock(tx, actor, line.inventoryItemId, stockLocation.id, stockLocation.organizationLocationId, balance);
    }
    const latestLines = await tx.select().from(purchaseOrderItems).where(and(
      eq(purchaseOrderItems.tenantId, actor.tenantId),
      eq(purchaseOrderItems.purchaseOrderId, order.id),
    ));
    const fullyReceived = latestLines.length > 0 && latestLines.every((line) => quantityUnits(line.quantityReceived) >= quantityUnits(line.quantityOrdered));
    const status = fullyReceived ? "received" : "partially_received";
    const [updatedOrder] = await tx.update(purchaseOrders).set({
      status,
      receivedAt: fullyReceived ? new Date() : null,
      updatedAt: new Date(),
    }).where(and(eq(purchaseOrders.id, order.id), eq(purchaseOrders.tenantId, actor.tenantId))).returning();
    await recordOperation(tx, actor, {
      eventType: fullyReceived ? "purchase_order.received" : "purchase_order.partially_received",
      entityType: "purchase_order",
      entityId: order.id,
      locationId: order.organizationLocationId,
      auditAction: "inventory.purchase_order.receive",
      before: { status: order.status },
      after: { status, movementIds, receivedLines: [...newQuantities.entries()].map(([id, quantityReceived]) => ({ purchaseOrderItemId: id, quantityReceived })) },
    });
    return { orderId: updatedOrder?.id ?? order.id, status, movementIds };
  });
  return json({ item: await purchaseOrderView(actor, result.orderId), receipt: normalized(result) });
}

export async function handleAdminOperations(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  const root = path[0];
  if (root === "staff") return handleStaff(request, path, actor);
  if (root === "organization") {
    if (path[1] === "locations") {
      if (path.length === 2 && request.method === "GET") {
        authorize(actor, "organization.read");
        return json({ items: await organizationView(actor) });
      }
      if (path.length === 2 && request.method === "POST") {
        authorize(actor, "organization.locations_manage");
        return createOrganizationLocation(request, actor);
      }
      if (path.length === 3 && request.method === "GET") {
        authorize(actor, "organization.read");
        return json({ item: await organizationView(actor, path[2]) });
      }
      return null;
    }
    return handleOrganization(request, path, actor);
  }
  if (root === "inventory") return handleInventory(request, path, actor);
  if (root === "vendors") return handleVendors(request, path, actor);
  if (root === "purchase-orders") return handlePurchaseOrders(request, path, actor);
  return null;
}
