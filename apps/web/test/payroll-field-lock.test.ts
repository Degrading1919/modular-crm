import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import {
  breaks, mileageRecords, organizationLocations, organizations, payrollPeriods, schema, seedDevelopment, seedIds, shifts, timeEntries,
  type Database,
} from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRoutesField } = await import("../lib/api/routes-field.ts");
const { assertPayrollSourceEditable } = await import("../lib/api/payroll.ts");

const id = (number: number) => "00000000-0000-4000-8000-" + number.toString(16).padStart(12, "0");
const localDate = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
};

let pglite: PGlite;
let db: Database;

function technician(membershipId: string, locationId: string): SessionActor {
  return {
    kind: "staff", userId: "test-user-" + membershipId, tenantId: seedIds.happyTenant, tenantName: "Payroll test",
    packKey: null, email: "tech@example.test", name: "Test Technician", role: "technician",
    permissions: permissionsForRole("technician"), locationIds: new Set([locationId]), allLocations: false,
    membershipId, organizationId: seedIds.happyOrganization, defaultLocationId: locationId,
  };
}

async function postTime(actor: SessionActor, action: string, extra: Record<string, unknown> = {}) {
  const request = new Request("http://localhost/api/v1/field/time", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }),
  });
  const response = await handleRoutesField(request, ["field", "time"], actor);
  if (!response) throw new Error("Field time endpoint did not handle the request");
  return response;
}

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
  await db.update(shifts).set({ clockInAt: new Date("2020-01-01T10:00:00.000Z"), clockOutAt: new Date("2020-01-01T18:00:00.000Z") }).where(eq(shifts.id, id(600)));
  await db.update(organizations).set({ timezone: "America/Los_Angeles" }).where(eq(organizations.id, seedIds.happyOrganization));
  await db.update(organizationLocations).set({ timezone: "Asia/Tokyo" }).where(eq(organizationLocations.id, seedIds.augusta));
  await db.update(organizationLocations).set({ timezone: "Asia/Tokyo" }).where(eq(organizationLocations.id, seedIds.northAugusta));
}, 120_000);

afterAll(async () => { await pglite?.close(); });

describe("field time and mileage payroll locks", () => {
  it("blocks approved/exported source changes, permits review work, and uses the location date for mileage", async () => {
    const now = new Date();
    const happyTech = technician(seedIds.terryMembership, seedIds.augusta);
    const secondTech = technician(seedIds.caseyMembership, seedIds.northAugusta);
    const organizationDate = localDate(now, "America/Los_Angeles");
    const locationDate = localDate(now, "Asia/Tokyo");
    const startDate = organizationDate < locationDate ? organizationDate : locationDate;
    const endDate = organizationDate > locationDate ? organizationDate : locationDate;
    await db.insert(payrollPeriods).values({
      id: id(900), tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization,
      periodStart: startDate, periodEnd: endDate, status: "approved",
    });
    await db.insert(shifts).values({
      id: id(901), tenantId: seedIds.happyTenant, membershipId: happyTech.membershipId!,
      organizationLocationId: seedIds.augusta, status: "clocked_in",
      clockInAt: new Date(now.getTime() - 5 * 60 * 1000),
    });
    await db.insert(breaks).values({
      id: id(902), tenantId: seedIds.happyTenant, shiftId: id(901), breakType: "meal",
      startedAt: new Date(now.getTime() - 3 * 60 * 1000),
    });
    await db.insert(shifts).values({
      id: id(903), tenantId: seedIds.happyTenant, membershipId: secondTech.membershipId!,
      organizationLocationId: seedIds.northAugusta, status: "clocked_in",
      clockInAt: new Date(now.getTime() - 5 * 60 * 1000),
    });

    await expect(postTime(happyTech, "clock_out")).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect((await db.select().from(shifts).where(eq(shifts.id, id(901))))[0]?.status).toBe("clocked_in");
    expect((await db.select().from(breaks).where(eq(breaks.id, id(902))))[0]?.endedAt).toBeNull();
    expect((await db.select().from(timeEntries).where(eq(timeEntries.shiftId, id(901)))).length).toBe(0);
    await expect(postTime(secondTech, "mileage", { miles: 2.5 })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(db.transaction((tx) => assertPayrollSourceEditable(tx, happyTech, { occurredOn: locationDate })))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    await db.update(payrollPeriods).set({ status: "exported" }).where(eq(payrollPeriods.id, id(900)));
    await expect(db.transaction((tx) => assertPayrollSourceEditable(tx, happyTech, { startsAt: now, endsAt: now })))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await db.update(payrollPeriods).set({ status: "reviewed" }).where(eq(payrollPeriods.id, id(900)));

    expect((await postTime(happyTech, "clock_out")).status).toBe(200);
    expect((await db.select().from(shifts).where(eq(shifts.id, id(901))))[0]?.status).toBe("clocked_out");
    expect((await db.select().from(breaks).where(eq(breaks.id, id(902))))[0]?.endedAt).not.toBeNull();
    expect((await db.select().from(timeEntries).where(eq(timeEntries.shiftId, id(901)))).length).toBe(1);

    expect((await postTime(secondTech, "mileage", { miles: 2.5 })).status).toBe(200);
    const mileage = await db.select().from(mileageRecords).where(eq(mileageRecords.membershipId, secondTech.membershipId!));
    expect(mileage.at(-1)?.occurredOn).toBe(locationDate);

    await db.insert(payrollPeriods).values({
      id: id(904), tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization,
      periodStart: startDate, periodEnd: startDate, status: "exported",
    });
    await expect(db.transaction((tx) => assertPayrollSourceEditable(tx, happyTech, { occurredOn: startDate }))).resolves.toBeUndefined();
  });
});
