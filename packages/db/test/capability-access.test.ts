import { describe, expect, it } from "vitest";
import { evaluateTenantCapabilities, type CapabilityCatalogRows } from "../src/capability-access.ts";

const at = new Date("2026-09-23T12:00:00.000Z");
const moduleRow = (id: string, key: string) => ({
  id, key, name: key, description: null, lifecycleState: "active", availability: {}, compatibility: {}, metadata: {},
}) as CapabilityCatalogRows["modules"][number];
const featureRow = (id: string, key: string) => ({
  id, key, name: key, description: null, lifecycleState: "active", availability: {}, metadata: {},
}) as CapabilityCatalogRows["features"][number];
const grantRow = (moduleId: string, overrides: Record<string, unknown> = {}) => ({
  tenantId: "tenant-a", moduleId, source: "test", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveUntil: null, revokedAt: null, ...overrides,
}) as CapabilityCatalogRows["grants"][number];

function fixture(): CapabilityCatalogRows {
  return {
    modules: [moduleRow("core", "core"), moduleRow("route", "route")],
    features: [featureRow("schedule", "service_scheduling"), featureRow("routing", "route_planning")],
    moduleFeatures: [
      { moduleId: "core", featureId: "schedule", sortOrder: 0, required: true },
      { moduleId: "route", featureId: "routing", sortOrder: 0, required: true },
    ],
    moduleDependencies: [{ moduleId: "route", dependsOnModuleId: "core", dependencyType: "requires", conditions: {} }],
    featureDependencies: [{ featureId: "routing", dependsOnFeatureId: "schedule", dependencyType: "requires", conditions: {} }],
    grants: [grantRow("core"), grantRow("route")],
    settings: [],
  };
}

describe("effective tenant capabilities", () => {
  it("separates entitlement, enablement, and UI prominence", () => {
    const rows = fixture();
    rows.settings = [{
      id: "setting-route", createdAt: at, updatedAt: at,
      tenantId: "tenant-a", moduleId: "route", enabled: true, uiProminence: "hidden", configuration: { routeMode: "manual" },
    }];
    const state = evaluateTenantCapabilities("tenant-a", rows, at);
    expect(state.modules.route).toMatchObject({ entitled: true, enabled: true, usable: true, uiProminence: "hidden" });
    expect(state.features.route_planning).toMatchObject({ entitled: true, usable: true, visible: false });
    expect(state.features.service_scheduling).toMatchObject({ usable: true, visible: true });
    expect(evaluateTenantCapabilities("tenant-b", rows, at).features.route_planning?.usable).toBe(false);
  });

  it("blocks new use after disabling or revoking a grant while retaining distinct state", () => {
    const rows = fixture();
    rows.settings = [{
      id: "setting-route", createdAt: at, updatedAt: at,
      tenantId: "tenant-a", moduleId: "route", enabled: false, uiProminence: "featured", configuration: {},
    }];
    expect(evaluateTenantCapabilities("tenant-a", rows, at).features.route_planning)
      .toMatchObject({ entitled: true, enabled: false, usable: false });
    rows.settings = [];
    rows.grants = [grantRow("core"), grantRow("route", { revokedAt: new Date("2026-09-22T12:00:00.000Z") })];
    expect(evaluateTenantCapabilities("tenant-a", rows, at).features.route_planning)
      .toMatchObject({ entitled: false, usable: false });
    expect(evaluateTenantCapabilities("tenant-a", rows, at).features.service_scheduling?.usable).toBe(true);
  });

  it("enforces dependencies and fails closed on dependency cycles", () => {
    const rows = fixture();
    rows.grants = [grantRow("route")];
    expect(evaluateTenantCapabilities("tenant-a", rows, at).modules.route?.blockedBy).toContain("requires:core");
    rows.grants = [grantRow("core"), grantRow("route")];
    rows.moduleDependencies = [...rows.moduleDependencies, { moduleId: "core", dependsOnModuleId: "route", dependencyType: "requires", conditions: {} }];
    expect(evaluateTenantCapabilities("tenant-a", rows, at).features.route_planning?.usable).toBe(false);
  });

  it("fails closed when catalog dependency conditions have not been interpreted", () => {
    const rows = fixture();
    rows.moduleDependencies = [{
      moduleId: "route", dependsOnModuleId: "core", dependencyType: "requires", conditions: { plan: "enterprise" },
    }];
    const state = evaluateTenantCapabilities("tenant-a", rows, at);
    expect(state.modules.route?.usable).toBe(false);
    expect(state.modules.route?.blockedBy).toContain("conditional_dependency_unsupported");
  });
});
