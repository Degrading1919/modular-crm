import { describe, expect, it } from "vitest";
import { requiredFeatureForApi } from "../lib/api/capability-enforcement.ts";

describe("capability boundaries for new operations", () => {
  it("gates creation and execution while retaining ordinary historical reads", () => {
    expect(requiredFeatureForApi(["routes"], "POST")).toBe("route_planning");
    expect(requiredFeatureForApi(["routes", "old-route"], "GET")).toBeNull();
    expect(requiredFeatureForApi(["estimates"], "POST")).toBe("estimate_management");
    expect(requiredFeatureForApi(["invoices", "old-invoice"], "GET")).toBeNull();
    expect(requiredFeatureForApi(["invoices", "invoice-id", "pay"], "POST")).toBe("payment_collection");
    expect(requiredFeatureForApi(["invoices", "invoice-id", "issue"], "POST")).toBe("invoicing");
    expect(requiredFeatureForApi(["jobs", "job-id", "transition"], "POST")).toBe("field_job_tracking");
    expect(requiredFeatureForApi(["portal", "invoices", "invoice-id", "pay"], "POST")).toBe("payment_collection");
    expect(requiredFeatureForApi(["portal", "estimates", "estimate-id", "approve"], "POST")).toBe("estimate_management");
    expect(requiredFeatureForApi(["payroll", "statements"], "GET")).toBeNull();
    expect(requiredFeatureForApi(["reports"], "GET")).toBe("advanced_reporting");
  });
});
