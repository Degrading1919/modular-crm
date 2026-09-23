import { DomainError } from "./errors.ts";

export const PERMISSIONS = [
  "tenant.read", "tenant.update", "tenant.billing_manage", "tenant.security_manage", "tenant.audit_read", "tenant.delete",
  "organization.read", "organization.update", "organization.locations_manage", "organization.franchise_manage", "organization.rollup_reports_read",
  "staff.read", "staff.invite", "staff.update", "staff.deactivate", "roles.read", "roles.manage", "compensation.read", "compensation.manage",
  "leads.read", "leads.create", "leads.update", "leads.convert", "leads.archive", "leads.export",
  "customers.read", "customers.create", "customers.update", "customers.status_manage", "customers.archive", "customers.export", "customers.sensitive_access_read",
  "estimates.read", "estimates.create", "estimates.update_draft", "estimates.send", "estimates.cancel",
  "services.read", "services.manage", "pricing.read", "pricing.manage", "promotions.manage",
  "service_plans.read", "service_plans.create", "service_plans.update", "service_plans.pause", "service_plans.cancel",
  "schedule.read", "schedule.manage", "jobs.read", "jobs.create", "jobs.update", "jobs.assign", "jobs.dispatch", "jobs.start", "jobs.complete", "jobs.skip", "jobs.cancel", "jobs.reopen", "jobs.forms_submit", "jobs.files_add",
  "routes.read", "routes.create", "routes.optimize", "routes.reorder", "routes.publish", "routes.reoptimize_live", "routes.close",
  "invoices.read", "invoices.create", "invoices.issue", "invoices.adjust", "invoices.void", "payments.read", "payments.collect", "payments.record_manual", "payments.refund", "billing.settings_manage", "tax.manage", "billing.export",
  "communications.read", "communications.send", "communications.templates_manage", "communications.settings_manage",
  "tickets.read", "tickets.create", "tickets.update", "tickets.assign", "tickets.close", "tickets.configure",
  "time.own_read", "time.own_create", "time.own_correct_request", "time.all_read", "time.correct", "time.approve", "mileage.own_manage", "mileage.all_read",
  "payroll.read", "payroll.calculate", "payroll.review", "payroll.approve", "payroll.export",
  "inventory.read", "inventory.manage_catalog", "inventory.receive", "inventory.transfer", "inventory.adjust", "inventory.consume", "inventory.reorder_manage",
  "automations.read", "automations.create", "automations.update", "automations.activate", "automations.archive", "automations.runs_read", "automations.runs_retry",
  "connectors.read", "connectors.install", "connectors.configure", "connectors.disconnect", "connectors.sync_manage", "connectors.logs_read",
  "website.read", "website.content_manage", "website.forms_manage", "website.preview", "website.publish", "website.domains_manage",
  "reports.operational_read", "reports.financial_read", "reports.staff_read", "reports.payroll_read", "reports.inventory_read", "reports.franchise_read", "reports.export",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type RoleTemplate = "owner" | "office" | "technician";

const officeDenied = new Set<Permission>([
  "tenant.update", "tenant.billing_manage", "tenant.security_manage", "tenant.audit_read", "tenant.delete",
  "organization.franchise_manage", "organization.rollup_reports_read", "roles.manage", "compensation.read", "compensation.manage",
  "staff.invite", "staff.deactivate", "services.manage", "pricing.manage", "promotions.manage",
  "invoices.void", "payments.refund", "billing.settings_manage", "tax.manage", "payroll.read", "payroll.calculate", "payroll.review", "payroll.approve", "payroll.export",
  "automations.create", "automations.update", "automations.activate", "automations.archive", "automations.runs_retry",
  "connectors.install", "connectors.configure", "connectors.disconnect", "connectors.sync_manage", "website.publish", "website.domains_manage",
  "reports.payroll_read", "reports.franchise_read",
]);

const technicianAllowed = new Set<Permission>([
  "schedule.read", "jobs.read", "jobs.start", "jobs.complete", "jobs.skip", "jobs.forms_submit", "jobs.files_add",
  "routes.read", "customers.read", "customers.sensitive_access_read", "service_plans.read", "communications.send", "communications.read",
  "tickets.read", "tickets.create", "tickets.update", "time.own_read", "time.own_create", "time.own_correct_request", "mileage.own_manage", "inventory.read", "inventory.consume",
]);

export function permissionsForRole(role: RoleTemplate): ReadonlySet<Permission> {
  if (role === "owner") return new Set(PERMISSIONS);
  if (role === "office") return new Set(PERMISSIONS.filter((permission) => !officeDenied.has(permission)));
  return technicianAllowed;
}

export interface StaffActor {
  kind: "staff";
  userId: string;
  tenantId: string;
  role: RoleTemplate;
  permissions: ReadonlySet<Permission>;
  locationIds: ReadonlySet<string>;
  allLocations: boolean;
}

export interface CustomerActor {
  kind: "customer";
  userId: string;
  tenantId: string;
  customerIds: ReadonlySet<string>;
  locationIds: ReadonlySet<string>;
}

export type Actor = StaffActor | CustomerActor;

export interface ScopedResource {
  tenantId: string;
  locationId?: string | null;
  assignedUserIds?: readonly string[];
  customerId?: string | null;
  customerVisible?: boolean;
}

export function requirePermission(actor: Actor, permission: Permission): asserts actor is StaffActor {
  if (actor.kind !== "staff" || !actor.permissions.has(permission)) {
    throw new DomainError("FORBIDDEN", "You do not have access to this action.", 403);
  }
}

export function canReadResource(actor: Actor, resource: ScopedResource, permission: Permission): boolean {
  if (actor.tenantId !== resource.tenantId) return false;
  if (actor.kind === "customer") {
    return resource.customerVisible === true && !!resource.customerId && actor.customerIds.has(resource.customerId)
      && (!resource.locationId || actor.locationIds.has(resource.locationId));
  }
  if (!actor.permissions.has(permission)) return false;
  if (actor.role === "technician") return !!resource.assignedUserIds?.includes(actor.userId);
  return actor.allLocations || !resource.locationId || actor.locationIds.has(resource.locationId);
}

export function requireScopedResource(actor: Actor, resource: ScopedResource | null | undefined, permission: Permission): asserts resource is ScopedResource {
  if (!resource || !canReadResource(actor, resource, permission)) {
    // A cross-tenant or out-of-scope ID must not reveal whether it exists.
    throw new DomainError("NOT_FOUND", "Record not found.", 404);
  }
}
