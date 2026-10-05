import { describe, expect, it } from "vitest";
import { PERMISSIONS, permissionsForRole } from "@modular-crm/domain";
import { canUseAction, canUseSurface, surfaceAccess, workspaceRules, type WorkspaceAccess } from "../lib/workspace-access";

const features = Object.fromEntries(Object.values(workspaceRules).flatMap((rules) => rules.flatMap((rule) => rule.feature ? [[rule.feature, { usable: true, visible: true }]] : [])));
const office: WorkspaceAccess = { role: "office", permissions: [...permissionsForRole("office")], features };

describe("effective business workspace access", () => {
  it.each(["schedule", "jobs", "routes", "invoices", "payments", "communications", "tickets", "staff", "connections", "settings"])("opens permitted office tool %s", (tool) => {
    expect(surfaceAccess(office, tool)).toBe("allowed");
    expect(canUseSurface(office, `/app/${tool}`, true)).toBe(true);
  });
  it.each(["capabilities", "developer", "payroll", "franchise"])("hides and guards restricted office tool %s", (tool) => {
    expect(surfaceAccess(office, tool)).toBe("permission-denied");
    expect(canUseSurface(office, tool, true)).toBe(false);
  });
  it("does not let an enabled capability grant permission", () => {
    const restricted = { ...office, permissions: ["customers.read"] };
    expect(surfaceAccess(restricted, "jobs")).toBe("permission-denied");
    expect(canUseSurface(restricted, "/app/jobs/record", true)).toBe(false);
    expect(canUseAction(restricted, "jobs", ["jobs.create"])).toBe(false);
  });
  it("does not let a permission bypass an unavailable capability", () => {
    const unavailable = { ...office, features: { ...features, route_planning: { usable: false, visible: true } } };
    expect(surfaceAccess(unavailable, "routes")).toBe("capability-unavailable");
    expect(canUseSurface(unavailable, "routes", true)).toBe(false);
    expect(canUseAction(unavailable, "routes", ["routes.create"])).toBe(false);
  });
  it("preserves usable-but-hidden capability prominence", () => {
    const hidden = { ...office, features: { ...features, route_planning: { usable: true, visible: false } } };
    expect(surfaceAccess(hidden, "routes")).toBe("allowed");
    expect(canUseSurface(hidden, "routes", true)).toBe(false);
  });
  it("pairs any-of hub permissions with their own enabled capability", () => {
    const invoicesOnly = { ...office, permissions: ["invoices.read"], features: { ...features, invoicing: { usable: false, visible: false } } };
    expect(surfaceAccess(invoicesOnly, "billing")).toBe("capability-unavailable");
    expect(canUseSurface({ ...invoicesOnly, features }, "billing")).toBe(true);
    expect(canUseSurface({ ...invoicesOnly, features }, "payments")).toBe(false);
  });
  it("uses granular permissions, not office/owner labels, for normal administration", () => {
    const custom = { ...office, permissions: ["staff.read", "tenant.billing_manage", "payroll.read"] };
    expect(canUseSurface(custom, "staff")).toBe(true);
    expect(canUseSurface(custom, "capabilities")).toBe(true);
    expect(canUseSurface(custom, "payroll")).toBe(true);
    expect(canUseSurface(custom, "developer")).toBe(false); // API explicitly requires owner.
  });
  it("gates creation and sensitive actions separately from read access", () => {
    expect(canUseAction(office, "staff", ["staff.invite"])).toBe(false);
    expect(canUseAction(office, "settings", ["tenant.update"])).toBe(false);
    expect(canUseAction(office, "invoices", ["payments.refund"], "payment_collection")).toBe(false);
    expect(canUseAction(office, "jobs", ["jobs.create"], "service_scheduling")).toBe(true);
    expect(canUseAction({ ...office, permissions: ["jobs.read"] }, "jobs", ["jobs.create"])).toBe(false);
  });
  it("retains all owner destinations and fails closed for unmapped surfaces", () => {
    const owner = { ...office, role: "owner", permissions: PERMISSIONS };
    for (const tool of Object.keys(workspaceRules)) expect(surfaceAccess(owner, tool), tool).toBe("allowed");
    expect(canUseSurface(owner, "unknown")).toBe(false);
  });
});
