import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { DomainError } from "@modular-crm/domain";
import type { ReportingActor } from "../lib/api/reporting";

process.env.DATABASE_URL ??= "postgres://localhost:5432/modular_crm_test";
const { buildReportScopeCtes, handleReporting, reportRowsToCsv } = await import("../lib/api/reporting");

const tenantId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000010";
const allowedLocationId = "00000000-0000-4000-8000-000000000011";
const forbiddenLocationId = "00000000-0000-4000-8000-000000000012";

function actor(options: { allLocations?: boolean; locationIds?: string[]; permissions?: string[] } = {}): ReportingActor {
  return {
    kind: "staff", tenantId, organizationId, membershipId: "member-1", userId: "user-1",
    name: "Owner", email: "owner@example.test", tenantName: "Example", packKey: null,
    role: "office", permissions: new Set((options.permissions ?? ["reports.operational_read", "reports.financial_read", "reports.staff_read", "reports.payroll_read", "reports.inventory_read", "reports.franchise_read", "organization.rollup_reports_read", "reports.export"]) as never[]),
    locationIds: new Set(options.locationIds ?? [allowedLocationId]), allLocations: options.allLocations ?? false,
  };
}

describe("reporting API", () => {
  it("binds tenant and allowed locations before report aggregation", () => {
    const query = new PgDialect().sqlToQuery(buildReportScopeCtes(actor()));
    expect(query.sql).toContain("authorized_organizations");
    expect(query.sql).toContain("allowed_locations");
    expect(query.sql).toContain("l.tenant_id");
    expect(query.params).toContain(tenantId);
    expect(query.params).toContain(organizationId);
    expect(query.params).toContain(allowedLocationId);
    expect(query.params).not.toContain(forbiddenLocationId);
  });

  it("uses recursive child-location scope only for an authorized rollup", () => {
    const allowed = new PgDialect().sqlToQuery(buildReportScopeCtes(actor(), { rollup: true }));
    const denied = new PgDialect().sqlToQuery(buildReportScopeCtes(actor({ permissions: ["reports.operational_read"] }), { rollup: true }));
    expect(allowed.sql).toContain("child.parent_organization_id = parent.id");
    expect(allowed.params).toContain(true);
    expect(denied.params).toContain(false);
  });

  it("intersects a requested location with the actor's location scope", () => {
    const query = new PgDialect().sqlToQuery(buildReportScopeCtes(actor(), { locationId: forbiddenLocationId }));
    expect(query.sql).toContain("l.id =");
    expect(query.params).toContain(allowedLocationId);
    expect(query.params).toContain(forbiddenLocationId);
  });

  it("does not let technician or customer actors open broad reports", async () => {
    const technician = actor({ permissions: [] });
    await expect(handleReporting(new Request("https://crm.example/api/v1/reports?type=jobs"), ["reports"], technician))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const customer = { ...technician, kind: "customer" as const, customerIds: new Set(["customer-1"]) } as unknown as ReportingActor;
    await expect(handleReporting(new Request("https://crm.example/api/v1/dashboard"), ["dashboard"], customer))
      .rejects.toBeInstanceOf(DomainError);
  });

  it.each([
    ["financial", "reports.financial_read"],
    ["customers", "reports.operational_read"],
    ["jobs", "reports.operational_read"],
    ["routes", "reports.operational_read"],
    ["staff", "reports.staff_read"],
    ["inventory", "reports.inventory_read"],
    ["locations", "reports.franchise_read"],
  ])("requires %s report permission", async (type, permission) => {
    const reportActor = actor({ permissions: [
      "reports.operational_read", "reports.financial_read", "reports.staff_read", "reports.inventory_read",
      "reports.franchise_read", "organization.rollup_reports_read",
    ].filter((candidate) => candidate !== permission) });
    await expect(handleReporting(new Request(`https://crm.example/api/v1/reports?type=${type}`), ["reports"], reportActor))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires export permission separately from report access", async () => {
    const reportActor = actor({ permissions: ["reports.financial_read"] });
    await expect(handleReporting(new Request("https://crm.example/api/v1/reports/export?type=financial"), ["reports", "export"], reportActor))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires rollup permission for the location report", async () => {
    const reportActor = actor({ permissions: ["reports.franchise_read"] });
    await expect(handleReporting(new Request("https://crm.example/api/v1/reports?type=locations"), ["reports"], reportActor))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("quotes CSV cells and neutralizes spreadsheet formulas", () => {
    const csv = reportRowsToCsv([
      { itemName: "=1+1", detail: "a,\"b\"\r\nsecond line", note: " \t@SUM(A1:A2)" },
    ], [
      { key: "itemName", label: "Item" }, { key: "detail", label: "Detail" }, { key: "note", label: "Note" },
    ]);
    expect(csv).toBe('"Item","Detail","Note"\r\n"\'=1+1","a,""b""\r\nsecond line","\' \t@SUM(A1:A2)"');
  });
});
