import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { SessionActor } from "../lib/api/actor";

process.env.DATABASE_URL ??= "postgres://localhost:5432/modular_crm_test";
const {
  buildInvoiceActivityQuery,
  calculateRoyaltyAmountMinor,
  franchiseLocationCode,
  handleFranchiseRoyalty,
  isDirectChildOrganization,
  isDirectParentAgreementScope,
  parseRoyaltyPeriod,
} = await import("../lib/api/franchise-royalty");

const tenantId = "00000000-0000-4000-8000-000000000001";
const parentOrganizationId = "00000000-0000-4000-8000-000000000010";
const childOrganizationId = "00000000-0000-4000-8000-000000000020";
const siblingOrganizationId = "00000000-0000-4000-8000-000000000030";

function actor(options: { organizationId?: string; permissions?: string[]; tenantId?: string } = {}): SessionActor {
  return {
    kind: "staff", tenantId: options.tenantId ?? tenantId, organizationId: options.organizationId ?? parentOrganizationId,
    membershipId: "00000000-0000-4000-8000-000000000040", userId: "owner-1", role: "owner",
    name: "Parent Owner", email: "owner@example.test", tenantName: "Example", packKey: null,
    permissions: new Set((options.permissions ?? ["organization.franchise_manage", "reports.franchise_read"]) as never[]),
    locationIds: new Set(), allLocations: true,
  };
}

describe("franchise royalty calculations", () => {
  it("uses deterministic integer half-up rounding", () => {
    expect(calculateRoyaltyAmountMinor(1n, 4_999)).toBe(0n);
    expect(calculateRoyaltyAmountMinor(1n, 5_000)).toBe(1n);
    expect(calculateRoyaltyAmountMinor(9_999n, 2_500)).toBe(2_500n);
    expect(calculateRoyaltyAmountMinor(0n, 1_000)).toBe(0n);
    expect(() => calculateRoyaltyAmountMinor(100n, 10_001)).toThrowError(/percentage is invalid/i);
  });

  it("uses an inclusive UTC date range and rejects malformed or oversized periods", () => {
    const period = parseRoyaltyPeriod({ periodStart: "2024-02-29", periodEnd: "2024-03-01" });
    expect(period.startAt.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(period.endExclusiveAt.toISOString()).toBe("2024-03-02T00:00:00.000Z");
    expect(() => parseRoyaltyPeriod({ periodStart: "2024-02-30", periodEnd: "2024-03-01" })).toThrowError(/valid period/i);
    expect(() => parseRoyaltyPeriod({ periodStart: "2024-01-01", periodEnd: "2025-01-02" })).toThrowError(/366 days/i);
  });

  it("binds invoice activity to the tenant, child organization, period, and valid child locations", () => {
    const query = new PgDialect().sqlToQuery(buildInvoiceActivityQuery(
      tenantId,
      childOrganizationId,
      new Date("2024-04-01T00:00:00.000Z"),
      new Date("2024-05-01T00:00:00.000Z"),
    ));
    expect(query.sql).toContain("i.tenant_id = $1");
    expect(query.sql).toContain("i.organization_id = $2");
    expect(query.sql).toContain("i.issued_at >= $3");
    expect(query.sql).toContain("i.issued_at < $4");
    expect(query.sql).toContain("i.status NOT IN ('draft', 'void')");
    expect(query.sql).toContain("i.voided_at IS NULL");
    expect(query.sql).toContain("l.tenant_id = i.tenant_id");
    expect(query.sql).toContain("l.organization_id = i.organization_id");
    expect(query.params).toEqual([
      tenantId, childOrganizationId,
      new Date("2024-04-01T00:00:00.000Z"), new Date("2024-05-01T00:00:00.000Z"),
    ]);
  });

  it("requires direct parent scope within the same tenant", () => {
    const parent = actor();
    const agreementScope = { tenantId, parentOrganizationId, childParentOrganizationId: parentOrganizationId };
    expect(isDirectParentAgreementScope(parent, agreementScope)).toBe(true);
    expect(isDirectParentAgreementScope(actor({ organizationId: siblingOrganizationId }), agreementScope)).toBe(false);
    expect(isDirectParentAgreementScope(actor({ tenantId: "00000000-0000-4000-8000-000000000999" }), agreementScope)).toBe(false);
    expect(isDirectParentAgreementScope(parent, { ...agreementScope, childParentOrganizationId: siblingOrganizationId })).toBe(false);
  });

  it("accepts only same-tenant direct child organizations and creates stable location codes", () => {
    const parent = { id: parentOrganizationId, tenantId };
    expect(isDirectChildOrganization(parent, { tenantId, parentOrganizationId })).toBe(true);
    expect(isDirectChildOrganization(parent, { tenantId: "00000000-0000-4000-8000-000000000999", parentOrganizationId })).toBe(false);
    expect(isDirectChildOrganization(parent, { tenantId, parentOrganizationId: siblingOrganizationId })).toBe(false);
    expect(franchiseLocationCode("North Augusta Branch", childOrganizationId)).toBe("NORTHAUG-0020");
  });

  it("rejects staff without franchise management permission before database access", async () => {
    await expect(handleFranchiseRoyalty(
      new Request("https://crm.example/api/v1/franchise/agreements/00000000-0000-4000-8000-000000000099/rules"),
      ["franchise", "agreements", "00000000-0000-4000-8000-000000000099", "rules"],
      actor({ permissions: [] }),
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(handleFranchiseRoyalty(
      new Request("https://crm.example/api/v1/franchise/agreements", { method: "GET" }),
      ["franchise", "agreements"],
      actor({ permissions: [] }),
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(handleFranchiseRoyalty(
      new Request("https://crm.example/api/v1/franchise/units", { method: "POST" }),
      ["franchise", "units"],
      actor({ permissions: [] }),
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("validates agreement and unit payloads before making database calls", async () => {
    await expect(handleFranchiseRoyalty(
      new Request("https://crm.example/api/v1/franchise/agreements", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ childOrganizationId: "not-a-uuid", effectiveFrom: "2024-01-01" }),
      }),
      ["franchise", "agreements"], actor(),
    )).rejects.toMatchObject({ name: "ZodError" });
    await expect(handleFranchiseRoyalty(
      new Request("https://crm.example/api/v1/franchise/units", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Unit One", effectiveFrom: "2024-01-01" }),
      }),
      ["franchise", "units"], actor(),
    )).rejects.toMatchObject({ name: "ZodError" });
  });
});
