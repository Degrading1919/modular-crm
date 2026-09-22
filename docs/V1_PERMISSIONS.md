# V1 Permission Model

Permissions are server-enforced capability keys. Role names are convenience templates only.

## Rules

- Owner/Admin receives all tenant permissions by default.
- Office/Manager receives operational permissions but not tenant ownership, subscription, security administration, or unrestricted compensation visibility.
- Field Technician receives only assigned/scoped field-operation capabilities.
- Customer portal authorization is separate and not represented by staff permissions.
- Location scope further limits a permission; having `jobs.read` does not imply access to jobs outside the user's organization/location scope.
- Any permission may be overridden by a custom role later without changing service code.

## Permission catalog

### Tenant and security

- `tenant.read`
- `tenant.update`
- `tenant.billing_manage`
- `tenant.security_manage`
- `tenant.audit_read`
- `tenant.delete`

Default:
- Owner/Admin: all
- Office/Manager: tenant.read
- Field Technician: none

### Organization and locations

- `organization.read`
- `organization.update`
- `organization.locations_manage`
- `organization.franchise_manage`
- `organization.rollup_reports_read`

Default:
- Owner/Admin: all
- Office/Manager: read, location operational read as needed
- Field Technician: read assigned/basic location info only through scoped view models

### Staff and access

- `staff.read`
- `staff.invite`
- `staff.update`
- `staff.deactivate`
- `roles.read`
- `roles.manage`
- `compensation.read`
- `compensation.manage`

Default:
- Owner/Admin: all
- Office/Manager: staff.read/update; invite/deactivate optionally enabled; no roles.manage or compensation by default
- Field Technician: own profile only through separate self-service rule

### Leads

- `leads.read`
- `leads.create`
- `leads.update`
- `leads.convert`
- `leads.archive`
- `leads.export`

Owner/Admin + Office/Manager: all
Field Technician: none by default

### Customers

- `customers.read`
- `customers.create`
- `customers.update`
- `customers.status_manage`
- `customers.archive`
- `customers.export`
- `customers.sensitive_access_read`

Owner/Admin: all
Office/Manager: all operational permissions
Field Technician:
- scoped customers.read for assigned jobs
- sensitive access read only for assigned/current work

### Estimates and sales

- `estimates.read`
- `estimates.create`
- `estimates.update_draft`
- `estimates.send`
- `estimates.cancel`
- `services.read`
- `services.manage`
- `pricing.read`
- `pricing.manage`
- `promotions.manage`

Owner/Admin: all
Office/Manager: estimates all; services/pricing read; manage configurable by role
Field Technician: read estimate/job price only when explicitly enabled

### Service plans

- `service_plans.read`
- `service_plans.create`
- `service_plans.update`
- `service_plans.pause`
- `service_plans.cancel`

Owner/Admin + Office/Manager: all
Field Technician: read scoped summary only

### Scheduling and jobs

- `schedule.read`
- `schedule.manage`
- `jobs.read`
- `jobs.create`
- `jobs.update`
- `jobs.assign`
- `jobs.dispatch`
- `jobs.start`
- `jobs.complete`
- `jobs.skip`
- `jobs.cancel`
- `jobs.reopen`
- `jobs.forms_submit`
- `jobs.files_add`

Owner/Admin + Office/Manager: all
Field Technician:
- schedule.read scoped
- jobs.read assigned/scoped
- start/complete/skip/forms/files for assigned jobs
- no create/assign/dispatch/cancel/reopen by default

### Routing

- `routes.read`
- `routes.create`
- `routes.optimize`
- `routes.reorder`
- `routes.publish`
- `routes.reoptimize_live`
- `routes.close`

Owner/Admin + Office/Manager: all
Field Technician:
- read assigned route
- reoptimize_live only when explicitly enabled
- no publish/create by default

### Billing and payments

- `invoices.read`
- `invoices.create`
- `invoices.issue`
- `invoices.adjust`
- `invoices.void`
- `payments.read`
- `payments.collect`
- `payments.record_manual`
- `payments.refund`
- `billing.settings_manage`
- `tax.manage`
- `billing.export`

Owner/Admin: all
Office/Manager: operational invoice/payment permissions; settings/tax/void/refund may be limited by custom role
Field Technician:
- collect payment for assigned jobs when enabled
- no refund/void/settings

### Communications

- `communications.read`
- `communications.send`
- `communications.templates_manage`
- `communications.settings_manage`

Owner/Admin: all
Office/Manager: all
Field Technician:
- send job-related template messages
- read only relevant delivery status

### Tickets

- `tickets.read`
- `tickets.create`
- `tickets.update`
- `tickets.assign`
- `tickets.close`
- `tickets.configure`

Owner/Admin: all
Office/Manager: all except configure optionally restricted
Field Technician: scoped read/create/update for assigned/job-related tickets

### Time and mileage

- `time.own_read`
- `time.own_create`
- `time.own_correct_request`
- `time.all_read`
- `time.correct`
- `time.approve`
- `mileage.own_manage`
- `mileage.all_read`

Owner/Admin: all
Office/Manager: all operational time/mileage; compensation-sensitive views separate
Field Technician: own permissions only

### Payroll

- `payroll.read`
- `payroll.calculate`
- `payroll.review`
- `payroll.approve`
- `payroll.export`

Owner/Admin: all
Office/Manager: none by default unless payroll responsibility granted
Field Technician: own pay statement access through a dedicated self-service rule, not payroll.read

### Inventory

- `inventory.read`
- `inventory.manage_catalog`
- `inventory.receive`
- `inventory.transfer`
- `inventory.adjust`
- `inventory.consume`
- `inventory.reorder_manage`

Owner/Admin: all
Office/Manager: all
Field Technician:
- read scoped stock
- consume assigned/available stock
- transfer only when explicitly enabled

### Automations

- `automations.read`
- `automations.create`
- `automations.update`
- `automations.activate`
- `automations.archive`
- `automations.runs_read`
- `automations.runs_retry`

Owner/Admin: all
Office/Manager: read/runs_read by default; authoring may be granted
Field Technician: none

### Connectors

- `connectors.read`
- `connectors.install`
- `connectors.configure`
- `connectors.disconnect`
- `connectors.sync_manage`
- `connectors.logs_read`

Owner/Admin: all
Office/Manager: read/logs; install/configure optionally granted
Field Technician: none

### Website

- `website.read`
- `website.content_manage`
- `website.forms_manage`
- `website.preview`
- `website.publish`
- `website.domains_manage`

Owner/Admin: all
Office/Manager: read/content/forms/preview; publish optional
Field Technician: none

### Reports

- `reports.operational_read`
- `reports.financial_read`
- `reports.staff_read`
- `reports.payroll_read`
- `reports.inventory_read`
- `reports.franchise_read`
- `reports.export`

Owner/Admin: all
Office/Manager:
- operational
- financial
- staff
- inventory
- export
- payroll/franchise only when granted
Field Technician: own performance summary only through dedicated self-view

## Object-level enforcement

Permission checks are necessary but insufficient.

Repositories/services must additionally enforce:

- tenant scope
- organization scope
- location scope
- assignment scope for technicians
- customer relationship scope for portal users
- visibility field for files/notes/forms
- sensitive-field restrictions

## UI behavior

Hide unavailable actions instead of presenting buttons that always fail, while still enforcing every action server-side.

For a denied direct request return a normalized forbidden error without revealing whether an unauthorized cross-tenant object exists.
