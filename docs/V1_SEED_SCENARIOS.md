# V1 Seed and Playtest Scenarios

Seed data exists to make the entire system immediately usable after local startup.

## Tenant A — Happy Yards Pet Waste

Organization:
- Happy Yards Pet Waste
- one parent organization
- Augusta Branch
- North Augusta Branch

Staff:
- Olivia Owner — Owner/Admin, both branches
- Morgan Manager — Office/Manager, Augusta
- Terry Tech — Field Technician, Augusta
- Casey Tech — Field Technician, North Augusta

Customers:

### Carter Household
- residential
- Augusta
- weekly recurring cleanup
- two dogs
- autopay enabled
- gate code/access notes
- active upcoming jobs

### Nguyen Household
- residential
- Augusta
- every-two-weeks
- one dog with safety flag
- overdue invoice
- payment retry scenario

### Riverfront Apartments
- commercial
- two work areas
- net terms
- multiple contacts
- multiple weekly visits

### Johnson Lead
- website-generated lead
- outside instant-pricing confidence
- estimate pending

Include:
- completed jobs with proof
- skipped job
- reclean-linked job
- active/paused service plans
- estimate states
- invoice/payment/refund examples
- tips
- tickets/change requests
- route plans
- time/mileage
- payroll period
- inventory movements
- automation runs
- connector statuses

## Tenant B — CleanPaws Route Service

Separate tenant using the same Pet Waste Removal Industry Pack.

Seed overlapping names/addresses where useful to prove tenant isolation.

- one owner
- one technician
- at least two customers
- one route
- invoices/payments
- distinct site branding

## Connector fixtures

Mock/test connector registry includes:

- payments
- email
- SMS
- routing/geocoding
- calendar
- accounting
- file/storage if core local storage is abstracted
- payroll export target

Mocks should expose configurable success/failure states so playtesting can exercise degraded behavior.

## Playtest accounts

Local seed credentials should be documented clearly and be obviously non-production.

Provide accounts for:

- Tenant A owner
- Tenant A manager
- Tenant A technician
- Tenant A customer
- Tenant B owner
- Tenant B customer

## Purpose

Seed data must be rich enough that a developer can open every major screen, see realistic content, and exercise edge cases without manually creating a business from scratch before evaluating the product.
