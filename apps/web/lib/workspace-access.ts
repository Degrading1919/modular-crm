import type { Permission } from "@modular-crm/domain";

export type WorkspaceAccess = {
  role: string;
  permissions: readonly string[];
  features: Record<string, { usable?: boolean; visible?: boolean }>;
};
type Requirement = { feature?: string; permissions: readonly Permission[]; owner?: boolean };
type AccessRule = readonly Requirement[];
const tool = (feature: string | undefined, ...permissions: Permission[]): AccessRule => [{ feature, permissions }];

// Each alternative pairs its capability with its own permissions. A permission
// for one hub child must never unlock a different, enabled child.
export const workspaceRules: Record<string, AccessRule> = {
  dashboard: tool("basic_reporting", "reports.operational_read", "reports.financial_read"),
  leads: tool("lead_management", "leads.read"),
  customers: tool("customer_records", "customers.read"),
  schedule: tool("service_scheduling", "schedule.read", "jobs.read"),
  jobs: tool("field_job_tracking", "jobs.read"),
  routes: tool("route_planning", "routes.read"),
  estimates: tool("estimate_management", "estimates.read"),
  services: tool("service_catalog", "services.read"),
  "service-plans": tool("recurring_service_management", "service_plans.read"),
  invoices: tool("invoicing", "invoices.read"),
  payments: tool("payment_collection", "payments.read"),
  tickets: tool(undefined, "tickets.read"),
  website: tool("website_publishing", "website.read"),
  connections: tool(undefined, "connectors.read"),
  staff: tool("staff_access_management", "staff.read"),
  payroll: tool("payroll_inputs", "payroll.read"),
  inventory: tool("inventory_tracking", "inventory.read"),
  automations: tool("automation_workflows", "automations.read"),
  communications: tool("customer_notifications", "communications.read"),
  organization: tool("multi_location_management", "organization.read"),
  franchise: tool("multi_location_management", "organization.franchise_manage"),
  import: [...tool("data_import_export", "customers.create"), ...tool("data_import_export", "customers.export")],
  capabilities: tool(undefined, "tenant.billing_manage"),
  settings: tool("platform_settings", "tenant.read"),
  // Developer endpoints explicitly require an owner, not a granular permission.
  developer: [{ owner: true, permissions: [] }],
  // Document reads retain historical access, matching the API's read contract.
  "documents/invoice": tool(undefined, "invoices.read"),
  "documents/receipt": tool(undefined, "payments.read"),
  "documents/statement": tool(undefined, "invoices.read", "payments.read"),
  "documents/estimate": tool(undefined, "estimates.read"),
  "documents/completion": tool(undefined, "jobs.read"),
};
workspaceRules.sales = [...workspaceRules.estimates, ...workspaceRules.services, ...workspaceRules["service-plans"], ...workspaceRules.leads];
workspaceRules.billing = [...workspaceRules.invoices, ...workspaceRules.payments];

export const reportPermissions: Record<string, readonly Permission[]> = {
  financial: ["reports.financial_read"], customers: ["reports.operational_read"],
  jobs: ["reports.operational_read"], routes: ["reports.operational_read"],
  staff: ["reports.staff_read"], inventory: ["reports.inventory_read"],
  locations: ["reports.franchise_read", "organization.rollup_reports_read"],
};
workspaceRules.reports = Object.values(reportPermissions).map((permissions) => ({ feature: "advanced_reporting", permissions }));

export type AccessDecision = "allowed" | "permission-denied" | "capability-unavailable";
export function surfaceAccess(access: WorkspaceAccess, surface: string, navigation = false): AccessDecision {
  const rules = workspaceRules[surface];
  if (!rules) return "permission-denied"; // Unmapped destinations fail closed.
  const permitted = rules.filter((rule) => (!rule.owner || access.role === "owner") && rule.permissions.every((key) => access.permissions.includes(key)));
  if (!permitted.length) return "permission-denied";
  return permitted.some((rule) => !rule.feature || (access.features[rule.feature]?.usable === true && (!navigation || access.features[rule.feature]?.visible === true))) ? "allowed" : "capability-unavailable";
}

export function canUseSurface(access: WorkspaceAccess, destination: string, navigation = false): boolean {
  const segments = destination.startsWith("/app/") ? destination.slice(5).split(/[/?#]/) : [destination];
  const surface = segments[0] === "documents" ? `documents/${segments[1]}` : segments[0];
  return surfaceAccess(access, surface, navigation) === "allowed";
}

export function canUseAction(access: WorkspaceAccess, surface: string, permissions: readonly Permission[], feature?: string): boolean {
  return canUseSurface(access, surface) && permissions.every((key) => access.permissions.includes(key))
    && (!feature || access.features[feature]?.usable === true);
}

export const createPermissions: Record<string, Permission> = {
  leads: "leads.create", customers: "customers.create", jobs: "jobs.create", estimates: "estimates.create",
  invoices: "invoices.create", "service-plans": "service_plans.create", tickets: "tickets.create",
  services: "services.manage", staff: "staff.invite", communications: "communications.send",
  organization: "organization.locations_manage",
  payments: "payments.record_manual",
};
