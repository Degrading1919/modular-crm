import { hasUsableFeature, loadTenantCapabilities, type TenantCapabilityState } from "@modular-crm/db";
import { DomainError } from "@modular-crm/domain";
import { getDb } from "../db";

/** Functional keys stay stable while the module groupings that provide them remain catalog data. */
export function requiredFeatureForApi(path: readonly string[], method: string): string | null {
  const [root, second, third, fourth] = path;
  const changesState = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (root === "reports") return "advanced_reporting";
  if (root === "franchise") return method === "GET" ? "advanced_reporting" : "multi_location_management";
  if (!changesState) return null;
  if (root === "estimates") return "estimate_management";
  if (root === "service-plans") return "recurring_service_management";
  if (root === "jobs") return third === "transition" ? "field_job_tracking" : "service_scheduling";
  if (root === "routes") return "route_planning";
  if (root === "invoices") {
    if (third === "pay") return "payment_collection";
    return changesState ? "invoicing" : null;
  }
  if (root === "payments") return "payment_collection";
  if (root === "field") {
    if (second === "time") return "time_tracking";
    if (second === "jobs") return "field_job_tracking";
    return null;
  }
  if (root === "payroll") return second === "statements" ? null : "payroll_inputs";
  if (root === "inventory" || root === "vendors" || root === "purchase-orders") return "inventory_tracking";
  if (root === "automations") return "automation_workflows";
  if (root === "communications") return "customer_notifications";
  if (root === "website") return "website_publishing";
  if (root === "organization" && second === "locations") return "multi_location_management";
  if (root === "portal") {
    if (second === "invoices" && fourth === "pay") return "payment_collection";
    if (second === "estimates" && ["approve", "decline"].includes(fourth ?? "")) return "estimate_management";
    if (["requests", "tickets", "feedback"].includes(second ?? "")) return "customer_self_service";
  }
  return null;
}

export async function requireTenantFeature(tenantId: string, featureKey: string, state?: TenantCapabilityState): Promise<void> {
  const capabilities = state ?? await loadTenantCapabilities(getDb(), tenantId);
  if (!hasUsableFeature(capabilities, featureKey)) {
    throw new DomainError("CAPABILITY_UNAVAILABLE", "Add or enable this capability in your business setup to continue.", 403);
  }
}

export async function requireApiCapability(tenantId: string, path: readonly string[], method: string): Promise<void> {
  const feature = requiredFeatureForApi(path, method);
  if (feature) await requireTenantFeature(tenantId, feature);
}
