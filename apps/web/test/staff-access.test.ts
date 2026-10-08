import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";

const { getDbMock, getSession, sendEmail } = vi.hoisted(() => ({ getDbMock: vi.fn(), getSession: vi.fn(), sendEmail: vi.fn() }));
vi.mock("../lib/db", () => ({ getDb: getDbMock }));
vi.mock("../lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("../lib/mail", () => ({ sendPlatformEmail: sendEmail }));
const { updateStaffAccess, inviteExistingStaff, handleStaffInvitation } = await import("../lib/api/staff-access");
const { resolveActor } = await import("../lib/api/actor");
const { apiError } = await import("../lib/api/http");
const { handleAuthRoute } = await import("../lib/api/auth-routes");
let pglite: PGlite, db: Database;
const owner: SessionActor = { kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia", role: "owner", permissions: permissionsForRole("owner"), allLocations: true, locationIds: new Set([seedIds.augusta, seedIds.northAugusta]), membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta };
const office: SessionActor = { ...owner, userId: "demo-happy-manager", role: "office", permissions: permissionsForRole("office"), allLocations: false, locationIds: new Set([seedIds.augusta]), membershipId: seedIds.morganMembership };
const person = { id: "staff-control-existing", name: "Existing Person", email: "staff-control@example.test" };
beforeAll(async () => {
  pglite = new PGlite(); const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database; getDbMock.mockReturnValue(db); await seedDevelopment(db);
  await db.insert(schema.user).values({ ...person, emailVerified: true });
}, 120_000);
afterAll(async () => { await pglite?.close(); });
const request = (data: unknown) => new Request("http://localhost/api/v1/staff", { method: "POST", body: JSON.stringify(data) });
const change = (id: string, data: unknown, actor = owner) => updateStaffAccess(request(data), id, actor);
const session = (id: string) => getSession.mockResolvedValue({ user: { id, email: person.email, name: person.name } });
const selected = (id: string) => new Request("http://localhost", { headers: { cookie: `crm_membership=${id}` } });
const accept = (id: string, token: string) => handleStaffInvitation(request({ membershipId: id, token }), ["staff-invitations", "accept"]);

it("reserves an invitation, binds acceptance to the existing account, and consumes it once", async () => {
  const response = await inviteExistingStaff(owner, person, "technician", seedIds.augusta);
  const { item, invite } = await response.json(); const url = new URL(invite.invitationUrl);
  const token = url.searchParams.get("token")!;
  expect(item.status).toBe("invited"); expect(sendEmail).toHaveBeenCalled();
  session(person.id); expect(await resolveActor(selected(item.id))).toBeNull();
  const [stored] = await db.select().from(schema.verification).where(eq(schema.verification.identifier, `staff_invite:${item.id}`));
  expect(stored!.value).not.toBe(token);
  session(owner.userId); await expect(accept(item.id, token)).rejects.toMatchObject({ status: 404 });
  session(person.id); expect((await accept(item.id, token))!.headers.get("set-cookie")).toContain(`crm_membership=${item.id}`);
  await expect(accept(item.id, token)).rejects.toMatchObject({ status: 404 });
  expect(await resolveActor(selected(item.id))).toMatchObject({ kind: "staff", role: "technician", tenantId: owner.tenantId });
  await change(item.id, { role: "office", locationIds: [seedIds.northAugusta] });
  const actor = await resolveActor(selected(item.id)); expect(actor).toMatchObject({ role: "office", allLocations: false });
  expect([...actor!.locationIds]).toEqual([seedIds.northAugusta]);
  await change(item.id, { status: "inactive" }); expect(await resolveActor(selected(item.id))).toBeNull();
  expect(await db.select().from(schema.memberships).where(eq(schema.memberships.id, item.id))).toHaveLength(1);
  await change(item.id, { status: "active" }); expect(await resolveActor(selected(item.id))).toMatchObject({ role: "office" });
  const history = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.tenantId, owner.tenantId), eq(schema.auditEvents.entityId, item.id)));
  expect(history.map(row => row.action)).toEqual(expect.arrayContaining(["staff.invited", "staff.invitation_accepted", "staff.access_updated"]));
  expect(history).toHaveLength(5);
  await expect(change(item.id, { locationIds: [seedIds.augusta] }, office)).rejects.toMatchObject({ status: 404 });
  await expect(change(item.id, { status: "inactive" }, office)).rejects.toMatchObject({ status: 403 });
  await expect(change(item.id, { role: "owner" }, office)).rejects.toMatchObject({ status: 403 });
  await expect(change(item.id, { locationIds: [seedIds.cleanBranch] })).rejects.toMatchObject({ status: 404 });
  await expect(change(item.id, { role: "owner" }, { ...owner, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization })).rejects.toMatchObject({ status: 404 });
});

it("does not allow self-removal or activation before acceptance; expired and revoked invitations fail", async () => {
  await expect(change(owner.membershipId!, { status: "inactive" })).rejects.toMatchObject({ status: 409 });
  const second = { id: "staff-expiry-existing", name: "Expired Person", email: "expiry@example.test" };
  await db.insert(schema.user).values({ ...second, emailVerified: true });
  const { item, invite } = await (await inviteExistingStaff(owner, second, "technician", seedIds.augusta)).json();
  const token = new URL(invite.invitationUrl).searchParams.get("token")!;
  await expect(inviteExistingStaff({ ...office, permissions: new Set([...office.permissions, "staff.invite" as const]), locationIds: new Set([seedIds.northAugusta]) }, second, "technician", seedIds.northAugusta)).rejects.toMatchObject({ status: 404 });
  await expect(inviteExistingStaff(owner, second, "technician", seedIds.cleanBranch)).rejects.toMatchObject({ status: 404 });
  await expect(change(item.id, { status: "active" })).rejects.toMatchObject({ status: 409 });
  await db.update(schema.verification).set({ expiresAt: new Date(0) }).where(eq(schema.verification.identifier, `staff_invite:${item.id}`));
  session(second.id); await expect(accept(item.id, token)).rejects.toMatchObject({ status: 404 });
  await change(item.id, { status: "inactive" });
  expect(await db.select().from(schema.verification).where(eq(schema.verification.identifier, `staff_invite:${item.id}`))).toEqual([]);
  await expect(accept(item.id, token)).rejects.toMatchObject({ status: 404 });
  await expect(change(item.id, { status: "active" })).rejects.toMatchObject({ status: 409 });
  const resent = await inviteExistingStaff(owner, second, "technician", seedIds.augusta);
  expect(await resent.json()).toMatchObject({ item: { id: item.id, status: "invited" } });
  await change(item.id, { status: "inactive" });
  expect(await resolveActor(new Request("http://localhost", { headers: { cookie: "crm_membership=invalid" } }))).toBeNull();
});

it("reactivates previously active legacy accounts without bypassing invitation acceptance", async () => {
  await db.update(schema.memberships).set({ joinedAt: null }).where(eq(schema.memberships.id, seedIds.terryMembership));
  await change(seedIds.terryMembership, { status: "inactive" });
  expect((await db.select().from(schema.memberships).where(eq(schema.memberships.id, seedIds.terryMembership)))[0]!.joinedAt).not.toBeNull();
  await change(seedIds.terryMembership, { status: "active" });
  session("demo-happy-tech"); expect(await resolveActor(selected(seedIds.terryMembership))).toMatchObject({ role: "technician" });
});

it("chooses the latest joined business consistently and only switches to this account's active memberships", async () => {
  const [happy] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, person.id));
  const [cleanRole] = await db.select().from(schema.roleTemplates).where(and(eq(schema.roleTemplates.tenantId, seedIds.cleanTenant), eq(schema.roleTemplates.key, "owner")));
  const [clean] = await db.insert(schema.memberships).values({ tenantId: seedIds.cleanTenant, userId: person.id, organizationId: seedIds.cleanOrganization,
    defaultLocationId: seedIds.cleanBranch, roleTemplateId: cleanRole!.id, status: "active", joinedAt: new Date("2020-01-01") }).returning();
  try {
    session(person.id);
    expect(await resolveActor(new Request("http://localhost"))).toMatchObject({ tenantId: owner.tenantId, membershipId: happy!.id });
    const listed = await handleAuthRoute(new Request("http://localhost/api/v1/auth/businesses"), ["auth", "businesses"]);
    expect((await listed.json()).items.map((item: { id: string }) => item.id).sort()).toEqual([clean!.id, happy!.id].sort());
    const switchTo = (id: string, origin?: string) => handleAuthRoute(new Request("http://localhost/api/v1/auth/switch-business", {
      method: "POST", body: JSON.stringify({ membershipId: id }), headers: origin ? { origin } : {},
    }), ["auth", "switch-business"]);
    const response = await switchTo(clean!.id);
    expect(response.headers.get("set-cookie")).toContain(`crm_membership=${clean!.id}; Path=/; HttpOnly; SameSite=Lax`);
    expect(await resolveActor(selected(clean!.id))).toMatchObject({ tenantId: seedIds.cleanTenant, role: "owner" });
    await expect(switchTo(seedIds.oliviaMembership)).rejects.toMatchObject({ status: 404 });
    await expect(switchTo(clean!.id, "https://foreign.example.test")).rejects.toMatchObject({ status: 403 });
    for (const status of ["invited", "inactive"]) {
      await db.update(schema.memberships).set({ status }).where(eq(schema.memberships.id, clean!.id));
      await expect(switchTo(clean!.id)).rejects.toMatchObject({ status: 404 });
      expect(await resolveActor(selected(clean!.id))).toBeNull();
      expect((await (await handleAuthRoute(new Request("http://localhost"), ["auth", "businesses"])).json()).items).toHaveLength(1);
    }
    getSession.mockResolvedValue(null);
    await expect(switchTo(happy!.id)).rejects.toMatchObject({ status: 401 });
    await expect(handleAuthRoute(new Request("http://localhost"), ["auth", "businesses"])).rejects.toMatchObject({ status: 401 });
  } finally { await db.delete(schema.memberships).where(eq(schema.memberships.id, clean!.id)); }
});

it("reuses the database seat guard for invitations and reactivation with a plain-language error", async () => {
  const [inactive] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, person.id));
  await change(inactive!.id, { status: "inactive" });
  const before = await db.select().from(schema.memberships).where(eq(schema.memberships.tenantId, owner.tenantId));
  const seats = before.filter(row => ["active", "invited"].includes(row.status)).length;
  await db.insert(schema.platformSubscriptions).values({ tenantId: owner.tenantId, provider: "mock", status: "active", planKey: "standard", capabilities: [], includedSeats: seats, trialEnd: new Date() }).onConflictDoUpdate({ target: schema.platformSubscriptions.tenantId, set: { includedSeats: seats, status: "active" } });
  try { await change(inactive!.id, { status: "active" }); throw new Error("Expected seat rejection"); }
  catch (error) { const response = apiError(error); expect(response.status).toBe(402); expect(await response.json()).toMatchObject({ error: { message: expect.stringMatching(/seat|team|plan/i) } }); }
  const third = { id: "staff-seat-existing", name: "Seat Person", email: "seat@example.test" };
  await db.insert(schema.user).values({ ...third, emailVerified: true });
  await expect(inviteExistingStaff(owner, third, "technician", seedIds.augusta)).rejects.toBeDefined();
  expect(await db.select().from(schema.memberships).where(eq(schema.memberships.userId, third.id))).toEqual([]);
});
