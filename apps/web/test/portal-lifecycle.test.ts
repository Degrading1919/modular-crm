import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { seedDevelopment, seedIds, seedUserIds, schema, type Database } from "@modular-crm/db";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock, sendDevelopmentEmailMock, authApiMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(), sendDevelopmentEmailMock: vi.fn(),
  authApiMock: { signUpEmail: vi.fn(), requestPasswordReset: vi.fn() },
}));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
vi.mock("../lib/mail.ts", () => ({ sendDevelopmentEmail: sendDevelopmentEmailMock }));
vi.mock("../lib/auth.ts", () => ({ auth: { api: authApiMock } }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
let pglite: PGlite;
let db: Database;
let handlePortal: typeof import("../lib/api/portal.ts").handlePortal;
let handlePortalLifecycle: typeof import("../lib/api/portal-lifecycle.ts").handlePortalLifecycle;
let handlePortalActivation: typeof import("../lib/api/portal-lifecycle.ts").handlePortalActivation;
let customerActor: SessionActor;
let officeActor: SessionActor;

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  await seedDevelopment(db);
  ({ handlePortal } = await import("../lib/api/portal.ts"));
  ({ handlePortalLifecycle, handlePortalActivation } = await import("../lib/api/portal-lifecycle.ts"));
  customerActor = {
    kind: "customer", userId: seedUserIds.happyCustomer, tenantId: seedIds.happyTenant,
    tenantName: "Happy Yards Pet Waste", packKey: "pet-waste-removal", email: "customer@happyyards.test", name: "Alex Carter",
    customerIds: new Set([seedIds.carter]), locationIds: new Set([seedIds.carterLocation]),
    customerLocationIds: new Map([[seedIds.carter, new Set([seedIds.carterLocation])]]),
  };
  officeActor = {
    kind: "staff", userId: seedUserIds.happyManager, tenantId: seedIds.happyTenant,
    tenantName: "Happy Yards Pet Waste", packKey: "pet-waste-removal", email: "manager@happyyards.test", name: "Morgan Manager",
    role: "office", permissions: new Set(["customers.read", "customers.update", "service_plans.pause", "service_plans.cancel"]),
    locationIds: new Set([seedIds.augusta]), allLocations: false, membershipId: seedIds.morganMembership, organizationId: seedIds.happyOrganization,
  };
}, 120_000);

afterAll(async () => { await pglite?.close(); });

function request(path: string, method = "GET", body?: Record<string, unknown>) {
  return new Request(`http://localhost/api/v1/${path}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

async function staffCall(path: string, method = "GET", body?: Record<string, unknown>, actor = officeActor) {
  const response = await handlePortalLifecycle(request(path, method, body), path.split("/").filter(Boolean), actor);
  if (!response) throw new Error(`Lifecycle API did not handle ${path}.`);
  return response;
}

async function customerCall(path: string, method = "GET", body?: Record<string, unknown>) {
  const response = await handlePortal(request(path, method, body), path.split("/").filter(Boolean), customerActor);
  if (!response) throw new Error(`Portal API did not handle ${path}.`);
  return response;
}

describe("customer portal lifecycle", () => {
  it("rejects cross-tenant and out-of-branch location grants before creating access", async () => {
    const address = "portal-scope-test@example.test";
    await db.insert(schema.user).values({ id: "portal-scope-test-user", name: "Portal Scope", email: address });
    await expect(staffCall(`/customers/${seedIds.carter}/portal-access`, "POST", { email: address, serviceLocationIds: [seedIds.cleanCarterLocation] }))
      .rejects.toMatchObject({ status: 404 });

    const siblingLocation = crypto.randomUUID();
    await db.insert(schema.serviceLocations).values({
      id: siblingLocation, tenantId: seedIds.happyTenant, customerId: seedIds.carter, organizationLocationId: seedIds.northAugusta,
      name: "Out of office scope", addressLine1: "4 Pine Road", city: "North Augusta", region: "SC", postalCode: "29841",
    });
    await expect(staffCall(`/customers/${seedIds.carter}/portal-access`, "POST", { email: address, serviceLocationIds: [siblingLocation] }))
      .rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(schema.portalAccess).where(eq(schema.portalAccess.userId, "portal-scope-test-user"))).toHaveLength(0);
    await expect(staffCall(`/customers/${seedIds.cleanCarter}/portal-access`)).rejects.toMatchObject({ status: 404 });
  });

  it("invites with a hashed expiring activation token and revokes without erasing grants", async () => {
    const email = "portal-lifecycle-test@example.test";
    await db.insert(schema.user).values({ id: "portal-lifecycle-test-user", name: "Portal Customer", email });
    sendDevelopmentEmailMock.mockClear();
    const invited = await staffCall(`/customers/${seedIds.carter}/portal-access`, "POST", { email, serviceLocationIds: [seedIds.carterLocation] });
    expect(invited.status).toBe(201);
    const { item } = await invited.json() as { item: { id: string; status: string; serviceLocationIds: string[] } };
    expect(item).toMatchObject({ status: "invited", serviceLocationIds: [seedIds.carterLocation] });
    expect(sendDevelopmentEmailMock).toHaveBeenCalledOnce();
    const invitation = String(sendDevelopmentEmailMock.mock.calls[0]?.[2]);
    const activationUrl = new URL(invitation.slice(invitation.lastIndexOf("http")));
    const token = activationUrl.searchParams.get("token")!;
    const [storedToken] = await db.select().from(schema.verification).where(eq(schema.verification.identifier, `portal_invite:${item.id}`));
    expect(storedToken?.value).not.toBe(token);
    expect(createHash("sha256").update(token).digest("hex")).toBe(storedToken?.value);

    const activation = await handlePortalActivation(request("auth/portal-activate", "POST", { accessId: item.id, token }), ["auth", "portal-activate"]);
    expect(activation?.status).toBe(200);
    expect(await activation?.json()).toMatchObject({ item: { id: item.id, status: "active" } });
    await expect(handlePortalActivation(request("auth/portal-activate", "POST", { accessId: item.id, token }), ["auth", "portal-activate"]))
      .rejects.toMatchObject({ status: 404 });

    const revoked = await staffCall(`/customers/${seedIds.carter}/portal-access/${item.id}`, "DELETE");
    expect((await revoked.json()).item.status).toBe("revoked");
    const [saved] = await db.select().from(schema.portalAccess).where(eq(schema.portalAccess.id, item.id));
    const grants = await db.select().from(schema.portalLocationAccess).where(and(eq(schema.portalLocationAccess.tenantId, seedIds.happyTenant), eq(schema.portalLocationAccess.portalAccessId, item.id)));
    expect(saved?.status).toBe("revoked");
    expect(grants.map((grant) => grant.serviceLocationId)).toEqual([seedIds.carterLocation]);
    const audit = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityType, "portal_access"), eq(schema.auditEvents.entityId, item.id)));
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining(["customer.portal_access_invite", "customer.portal_access_activate", "customer.portal_access_revoke"]));
  });

  it("creates new customer credentials only with a password-setup email that redirects through activation", async () => {
    const userId = crypto.randomUUID();
    authApiMock.signUpEmail.mockImplementationOnce(async ({ body }: { body: { email: string; name: string } }) => {
      await db.insert(schema.user).values({ id: userId, name: body.name, email: body.email });
      return new Response(JSON.stringify({ user: { id: userId } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    authApiMock.requestPasswordReset.mockResolvedValueOnce({ status: true });
    const response = await staffCall(`/customers/${seedIds.carter}/portal-access`, "POST", { email: "new-portal-user@example.test", name: "New Portal User", serviceLocationIds: [seedIds.carterLocation] });
    expect(response.status).toBe(201);
    expect(authApiMock.signUpEmail).toHaveBeenCalledOnce();
    expect(authApiMock.requestPasswordReset).toHaveBeenCalledOnce();
    const args = authApiMock.requestPasswordReset.mock.calls[0]?.[0] as { body: { email: string; redirectTo: string } };
    expect(args.body.email).toBe("new-portal-user@example.test");
    expect(args.body.redirectTo).toContain("/portal/activate?accessId=");
    expect(args.body.redirectTo).toContain("&token=");
  });

  it("rolls back a staged invite and its audit trail when email delivery fails", async () => {
    const email = "portal-mail-failure@example.test";
    await db.insert(schema.user).values({ id: "portal-mail-failure-user", name: "Mail Failure", email });
    const priorInviteEvents = await db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.tenantId, seedIds.happyTenant), eq(schema.domainEvents.eventType, "customer_portal_access.invited")));
    const priorInviteAudits = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.tenantId, seedIds.happyTenant), eq(schema.auditEvents.action, "customer.portal_access_invite")));
    sendDevelopmentEmailMock.mockRejectedValueOnce(new Error("SMTP unavailable"));
    await expect(staffCall(`/customers/${seedIds.carter}/portal-access`, "POST", { email, serviceLocationIds: [seedIds.carterLocation] }))
      .rejects.toMatchObject({ status: 503 });
    const [savedUser] = await db.select().from(schema.user).where(eq(schema.user.id, "portal-mail-failure-user"));
    expect(savedUser).toBeTruthy();
    expect(await db.select().from(schema.portalAccess).where(and(eq(schema.portalAccess.tenantId, seedIds.happyTenant), eq(schema.portalAccess.userId, "portal-mail-failure-user")))).toHaveLength(0);
    expect(await db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.tenantId, seedIds.happyTenant), eq(schema.domainEvents.eventType, "customer_portal_access.invited")))).toHaveLength(priorInviteEvents.length + 1);
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.tenantId, seedIds.happyTenant), eq(schema.auditEvents.action, "customer.portal_access_invite")))).toHaveLength(priorInviteAudits.length + 1);
    const [failureEvent] = await db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.tenantId, seedIds.happyTenant), eq(schema.domainEvents.eventType, "customer_portal_access.invitation_failed")));
    const [failureAudit] = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.tenantId, seedIds.happyTenant), eq(schema.auditEvents.action, "customer.portal_access_invitation_failed")));
    expect(failureEvent?.payload).toMatchObject({ customerId: seedIds.carter, reason: "email_delivery_failed" });
    expect(failureAudit?.afterData).toMatchObject({ status: "none", serviceLocationIds: [] });
  });

  it("limits office access management reads and revocations to assigned service branches", async () => {
    const siblingLocation = crypto.randomUUID();
    const accessId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await db.insert(schema.user).values({ id: userId, name: "Multi-branch Portal", email: `branch-scope-${userId}@example.test` });
    await db.insert(schema.serviceLocations).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter, organizationLocationId: seedIds.northAugusta, name: "Other branch", addressLine1: "10 Pine Road", city: "North Augusta", region: "SC", postalCode: "29841", id: siblingLocation });
    await db.insert(schema.portalAccess).values({ id: accessId, tenantId: seedIds.happyTenant, userId, customerId: seedIds.carter, status: "active" });
    await db.insert(schema.portalLocationAccess).values([
      { tenantId: seedIds.happyTenant, portalAccessId: accessId, serviceLocationId: seedIds.carterLocation },
      { tenantId: seedIds.happyTenant, portalAccessId: accessId, serviceLocationId: siblingLocation },
    ]);
    const list = await staffCall(`/customers/${seedIds.carter}/portal-access`);
    const { items } = await list.json() as { items: Array<{ id: string; serviceLocationIds: string[] }> };
    expect(items).toContainEqual(expect.objectContaining({ id: accessId, serviceLocationIds: [seedIds.carterLocation] }));
    await expect(staffCall(`/customers/${seedIds.carter}/portal-access/${accessId}`, "DELETE")).rejects.toMatchObject({ status: 404 });
  });

  it("reviews and applies a location-consistent pause request transactionally, while hiding out-of-scope requests", async () => {
    const response = await customerCall("portal/requests", "POST", { type: "pause", servicePlanId: seedIds.carterPlan, effectiveDate: "2026-10-01", details: "Please pause for October." });
    expect(response.status).toBe(201);
    const submitted = await response.json() as { item: { id: string; status: string } };
    expect(submitted.item.status).toBe("submitted");
    const review = await staffCall(`/customer-change-requests/${submitted.item.id}/review`, "POST", {});
    expect((await review.json()).item.status).toBe("reviewing");
    const approved = await staffCall(`/customer-change-requests/${submitted.item.id}/approve`, "POST", {});
    expect((await approved.json()).item.status).toBe("approved");
    const [plan] = await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.id, seedIds.carterPlan));
    expect(plan).toMatchObject({ status: "paused", pauseFrom: "2026-10-01" });
    const [event] = await db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.entityId, submitted.item.id), eq(schema.domainEvents.eventType, "customer_change_request.approved")));
    const [audit] = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityId, submitted.item.id), eq(schema.auditEvents.action, "customer.request_approved")));
    expect(event?.payload).toMatchObject({ customerId: seedIds.carter, servicePlanId: seedIds.carterPlan, serviceLocationId: seedIds.carterLocation });
    expect(audit?.beforeData).toMatchObject({ status: "reviewing", servicePlan: { status: "active" } });
    expect(audit?.afterData).toMatchObject({ status: "approved", servicePlan: { status: "paused" } });

    const siblingLocation = crypto.randomUUID();
    await db.insert(schema.serviceLocations).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter, organizationLocationId: seedIds.northAugusta, name: "Other branch", addressLine1: "8 Pine Road", city: "North Augusta", region: "SC", postalCode: "29841", id: siblingLocation });
    const [outOfScope] = await db.insert(schema.customerChangeRequests).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter, serviceLocationId: siblingLocation, requestType: "change", status: "submitted", customerMessage: "Change at the other branch" }).returning();
    await expect(staffCall(`/customer-change-requests/${outOfScope!.id}/review`, "POST", {})).rejects.toMatchObject({ status: 404 });
    const [otherTenant] = await db.insert(schema.customerChangeRequests).values({ tenantId: seedIds.cleanTenant, customerId: seedIds.cleanCarter, serviceLocationId: seedIds.cleanCarterLocation, requestType: "pause", status: "submitted" }).returning();
    await expect(staffCall(`/customer-change-requests/${otherTenant!.id}/review`, "POST", {})).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a reviewed request with a customer-visible response and records the decision", async () => {
    const response = await customerCall("portal/requests", "POST", { type: "change", details: "Please move the visit to Friday." });
    expect(response.status).toBe(201);
    const submitted = await response.json() as { item: { id: string } };
    await staffCall(`/customer-change-requests/${submitted.item.id}/review`, "POST", {});
    const rejected = await staffCall(`/customer-change-requests/${submitted.item.id}/reject`, "POST", { reason: "Friday routes are full. Please choose another day." });
    expect((await rejected.json()).item.status).toBe("rejected");

    const customerRequests = await customerCall("portal/requests");
    expect((await customerRequests.json()).items).toContainEqual(expect.objectContaining({
      id: submitted.item.id,
      status: "rejected",
      response: "Friday routes are full. Please choose another day.",
    }));
    const [event] = await db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.entityId, submitted.item.id), eq(schema.domainEvents.eventType, "customer_change_request.rejected")));
    const [audit] = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityId, submitted.item.id), eq(schema.auditEvents.action, "customer.request_rejected")));
    expect(event?.payload).toMatchObject({ customerId: seedIds.carter, customerResponse: "Friday routes are full. Please choose another day." });
    expect(audit?.afterData).toMatchObject({ status: "rejected", customerResponse: "Friday routes are full. Please choose another day." });
  });
});
