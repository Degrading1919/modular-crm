# Sweep&Go Feature Audit

Research date: 2026-09-22

Reference product: Sweep&Go / Scoop&Go pooper-scooper business software.

This document captures product capabilities observed in Sweep&Go's current public feature pages, tutorials, pricing, API documentation, and integration guides. It is a product reference, not a requirement that Modular CRM copy every feature.

## Account surfaces and roles

Sweep&Go exposes distinct experiences for:

- employee/office users
- field technicians
- residential clients
- commercial clients
- multi-location/franchise users
- support staff across multiple accounts

Staff roles include owner, manager, accountant, office staff, crew leader, and field tech.

Field technicians can be restricted to the field-tech experience while other roles may access broader employee tooling.

## Customer portal

Residential customers can:

- manage contact information
- manage yard/location details and gate/access codes
- maintain dog information and photos
- flag unsafe dogs
- review service days
- see completed, skipped, and missed jobs
- see completion timestamps and proof/photos
- review invoices, payments, balances, and subscriptions
- add and select payment methods
- configure notification preferences
- request service frequency changes
- request pauses or cancellation
- request address/dog/service changes subject to office approval
- manage recurring tips
- create and track support tickets when enabled

Commercial customers have a portal for contacts, billing information, service locations/work areas, subscriptions, invoices, payments, balances, payment methods, additional services, notifications, and schedule history.

A multi-account switcher exists for customers associated with multiple accounts.

## Client onboarding and lead conversion

- unique public signup URL per business
- zip/service-area qualification
- regular and premium pricing zones
- lead capture for prospects outside service area
- instant price calculator
- configurable service frequency/options
- initial and recurring price logic
- one-time service pricing
- configurable form fields
- coupons/promotions
- cross-sells
- notification preference capture
- yard/property-specific information
- terms-of-service acceptance and stored signed copy
- payment-method capture
- card validation
- client-portal credentials after signup
- business and customer confirmation email
- configurable branding, callouts, disclaimers, and thank-you content
- conversion tracking and WordPress embedding
- external onboarding via Open API, GoHighLevel workflows, and n8n templates

## Client management

- leads and active/inactive clients
- residential and commercial client types
- multiple commercial locations
- multiple contacts
- work areas
- location/geolocation data
- billing and subscription details
- scheduling details
- assigned staff
- activity log
- office notes
- field-tech notes
- client-submitted notes/changes
- change-request approval workflow
- CSV exports
- referral source tracking
- service-plan support
- tax-exempt status
- net payment terms
- client-level and zone-level sales tax

## Scheduling, dispatch, and routing

- recurring schedule
- one-time jobs
- initial jobs
- nightly job creation from recurring schedules
- dispatch board
- automatic dispatch to technicians
- master schedule
- master map
- unassigned-location workflow
- technician/service-day reassignment
- bulk reassignment
- route optimization
- up to 100 route stops on higher plans
- route reoptimization
- manual route reordering
- estimated drive and completion time
- estimated shift duration comparison
- maps/geolocation correction
- start/end technician addresses included in route optimization
- staff breadcrumbs/geolocation events
- cleanup-distance tolerance alerts
- cleanup-duration tolerance alerts
- skipped/missed/reclean/rescheduled job handling
- weather-related bulk skips
- workload metrics by technician/day
- new-client planning around route density

## Field-tech application

Available through web, iOS, and Android.

Technicians can:

- clock in/out
- record shift notes
- track mileage/odometer
- choose personal/company vehicle
- record breaks
- see optimized job list
- navigate with Google Maps, Apple Maps, or Waze
- send on-the-way notifications
- see safety warnings
- start/complete jobs
- record job time automatically
- add office-only notes
- add client-visible photos
- add job notes
- skip jobs with reason, note, and photo
- trigger completion notifications
- view/create tickets
- see selected client ratings/comments

## Billing and payments

- service plans
- subscription billing
- prepaid and postpaid billing
- daily, weekly, and monthly billing intervals
- rolling or chosen billing-cycle start
- preferred billing date
- recurring invoice drafts
- one-time and initial invoices
- card-on-file charging
- check payments
- partial/overpayments by check
- refunds
- net payment terms
- automated payments
- Stripe and Fiserv/CardPointe processing options
- service and product tax
- multiple sales-tax zones
- QuickBooks-assisted automated tax calculation
- invoice PDF/email template customization
- billing behavior for skipped jobs
- coupons/promotions
- cross-sells
- one-time and recurring technician tips
- payout reporting and processing-fee visibility

## Staff, time, payroll, and performance

- staff creation/deactivation
- role/permission assignment
- shift tracking
- break tracking
- time reports
- personal vehicle mileage reports
- manual shift corrections
- payroll based on hourly, bonus, and commission structures
- pay slips
- tips flowing into payroll reports
- performance targets such as revenue/hour and revenue/mile
- complaint thresholds
- staff ratings and customer comments
- average clients per technician
- jobs/yards per hour
- jobs/yards per route

Sweep&Go does not calculate payroll tax withholding itself.

## Reports and analytics

Examples include:

- route planning
- completed jobs
- cross-sell fulfillment
- open balances
- residential/commercial sales
- active clients
- new vs lost clients / net growth
- average client value
- cancellation reasons
- referral sources
- technician productivity
- route metrics
- ratings/comments
- tips
- sales tax
- invoice/payment/payout exports
- CSV exports

## Communication

- email notifications
- SMS notifications
- phone-call notifications
- on-the-way messages
- off-schedule messages
- completion messages
- notification preferences per customer
- portal-visible notification history
- business/customer signup confirmations

## Ticketing and forms

Sweep&Go includes a configurable ticketing system:

- custom statuses
- custom ticket types
- custom priority levels
- custom forms
- one-time tickets
- recurring tickets
- staff assignment
- due dates
- customer visibility
- sticky technician tickets
- client-created tickets
- technician-created tickets
- employee-created tickets
- comments and status updates
- form submissions
- filters and queues
- cross-account support tickets

## Commercial and franchise/multi-account capabilities

- multiple locations per commercial client
- multiple subscriptions per location
- multiple assigned technicians
- work areas
- commercial contacts
- multi-account owner portal
- cross-location login
- centralized brand/account control
- location volume discounts
- royalty invoices
- percentage or minimum royalty calculation
- ACH royalty payment
- support staff spanning selected locations

## Integrations and extensibility

- QuickBooks Online client/invoice/payment sync
- sync logs and manual client matching
- Open REST API
- webhooks
- Zapier-compatible workflows
- GoHighLevel onboarding workflow
- n8n onboarding workflow template
- MCP server for AI assistants
- WordPress signup-form embedding
- conversion tracking
- third-party communication/marketing workflow support

## Website capability

Sweep&Go offers a separate Scoopify WordPress/Elementor theme oriented around pet-waste businesses and embedding its client-onboarding flow. This reinforces the value of connecting a public website directly to CRM onboarding rather than treating the website as unrelated marketing infrastructure.

## Implication for Modular CRM account model

Sweep&Go strongly supports retaining a real customer portal in the initial Modular CRM product definition.

Secure links can still be used for low-friction actions, but customers benefit from a persistent account for service history, recurring-service management, billing/payment methods, profile/location data, notification preferences, change requests, and support tickets.

The portal should be simpler than the employee application and should expose only capabilities relevant to the customer's relationship with the service business.
