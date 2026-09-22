# V1 Screen and Navigation Map

The initial frontend should provide four distinct experiences: business administration, office operations, field technician, and customer portal.

## Business application navigation

### Dashboard
- today overview
- unassigned/late jobs
- route status
- revenue and open balances
- new/lost customers
- staff/time summary
- inventory alerts
- actionable integration/automation errors

### Leads
- lead list
- lead detail
- convert to customer
- source tracking
- estimate creation

### Customers
- customer list/search
- customer detail
- contacts
- service locations
- Industry Pack assets
- service plans
- job/service history
- estimates
- invoices/payments
- communications
- tickets
- files/photos
- ratings/feedback
- activity timeline

### Schedule
- calendar
- dispatch board
- unassigned jobs
- recurring schedule
- bulk reschedule/skip tools

### Routes
- map
- route list by date/technician
- route optimization
- manual stop ordering
- drive/service-time estimates
- route status
- unassigned geographic work

### Jobs
- job list
- job detail
- assignments
- forms/checklists
- notes/files
- status history
- completion proof
- materials used
- billing linkage

### Sales
- estimates
- service catalog
- products
- pricing rules
- coupons/promotions
- add-ons/cross-sells

### Billing
- invoices
- payments
- refunds
- billing schedules
- open balances
- customer credits / credit memos
- account statements
- tax configuration
- payout/payment-provider reconciliation views

### Staff
- employees
- invitations
- roles/permissions
- shifts/time entries
- mileage
- compensation profiles
- payroll periods/calculations
- pay statements
- performance reporting

### Inventory
- items
- stock by location/vehicle
- movements/transfers
- job material usage
- reorder alerts
- vendors
- purchase orders / receiving

### Automations
- recommended recipes
- active recipes
- rule builder
- trigger/condition/action editor
- execution history/errors

### Communications
- templates
- outbound message history
- notification settings
- delivery failures

### Tickets
- queues
- types/statuses
- assignments
- ticket detail/comments/forms

### Reports
- operational reports
- financial reports
- routing/productivity reports
- customer growth/retention reports
- staff/payroll reports
- inventory reports
- franchise/multi-location rollups
- saved views/exports

### Website
- guided business/site setup
- template selection
- structured content editor
- services/rates
- photos/logo
- forms/booking/signup
- preview
- publish
- domains

### Connections
- capability-first marketplace
- installed connections
- connection health
- reconnect/repair
- resource mappings
- sync history/errors

### Developer

Advanced/optional surface:

- API credentials
- scopes
- outbound webhook subscriptions
- webhook delivery logs/test/retry
- API documentation links

### Organization
- locations/branches
- parent/franchise structure
- cross-location staff access
- location settings
- rolled-up reporting access

### Settings
- business profile
- branding
- service areas/zones
- default job/service behavior
- notifications
- billing defaults
- security
- audit log
- subscription/platform billing

## Field technician application

Mobile-first and intentionally simplified.

### Today
- clock in/out
- current route
- next stop
- route progress
- alerts

### Route
- ordered stops
- estimated arrival/drive time
- navigation launch
- reoptimization when permitted

### Job
- customer/location summary
- access/safety instructions
- Industry Pack asset information
- start/pause/complete/skip
- forms/checklists
- notes
- photos/signature
- materials used
- collect payment when permitted
- completion summary

### Time / Mileage
- shifts
- breaks
- mileage/odometer
- corrections/requested edits

### Tickets
- assigned or job-related tickets

### Profile
- personal settings and permitted availability/preferences

## Customer portal

### Home
- next service
- account balance
- recent service
- outstanding estimate/invoice/request

### Services
- active service plans
- upcoming service
- service history
- completion proof
- pause/change/cancel requests

### Profile
- contacts
- service addresses
- Industry Pack customer assets
- access instructions
- notification preferences

### Estimates
- view
- approve/reject
- requested changes when supported

### Billing
- invoices
- balances
- payments
- saved payment methods
- tips where supported

### Requests / Support
- tickets
- change requests
- comments/status

### Files
- shared documents/photos/forms

## Public website

- home
- services
- service-area/eligibility
- pricing or instant quote when enabled
- signup/request-service form
- booking when enabled
- contact
- customer login
- payment/approval secure-link pages
- industry-specific content sections

## UX rule

Navigation should progressively disclose complexity. A solo owner using the pet-waste pack should not be confronted with franchise, payroll, inventory, or advanced automation setup during onboarding unless those capabilities are relevant or intentionally enabled.
