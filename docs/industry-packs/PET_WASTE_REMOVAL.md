# Pet Waste Removal Reference Industry Pack

This is the first complete Industry Pack and the reference implementation for proving that Modular CRM can support a recurring route-based service business without pet-waste-specific core code.

## Pack identity

- key: `pet-waste-removal`
- display name: Pet Waste Removal
- primary customer types: residential, commercial
- service model: recurring route service plus one-time work
- default scheduling style: service day/window rather than exact appointment time
- routing importance: high
- recurring billing importance: high

## Terminology

Default labels:

- Customer -> Client
- Service Location -> Service Address
- Customer Asset -> Pet
- Work Area -> Yard / Service Area
- Job -> Cleanup
- Service Plan -> Service Plan
- Field Technician -> Technician

Labels remain tenant-editable.

## Configurable pet asset

Default fields:

- name: text, required
- species: enum, default dog
- breed: text
- size: enum small/medium/large/extra-large
- date_of_birth_or_age: optional
- photo: media
- active_at_location: boolean
- safety_flag: boolean
- safety_notes: text
- waste_notes: text
- customer_visible: true

Multiple pets may belong to one service address.

## Service-location fields

Default fields:

- gate_access_method
- gate_code
- yard_size
- fenced
- waste_disposal_location
- preferred_entry_point
- access_notes
- technician_safety_notes
- geocode
- service_zone
- route_day_preference
- customer_notification_preferences

Sensitive access data is shown only to authorized staff assigned to relevant work and is never exposed through public pages.

## Default services

- Recurring Cleanup
- One-Time Cleanup
- Initial Cleanup
- Commercial Station / Property Cleanup
- Deodorizer / Yard Treatment
- Waste Station Service
- Additional Yard / Work Area
- Reclean / Service Recovery

Tenants may add, rename, disable, or price services differently.

## Recurring frequencies

Pack defaults should include:

- twice weekly
- weekly
- every two weeks
- every four weeks
- custom recurrence

The recurrence engine remains generic and is not restricted to these presets.

## Pricing model

The pack installs configurable price inputs rather than hard-coded prices.

Common pricing dimensions:

- service frequency
- number of active pets
- yard/work-area size
- service/pricing zone
- recurring vs one-time
- initial-cleanup condition
- additional work areas
- commercial location/site
- optional add-ons
- taxes
- coupon/promotion

Suggested default formula behavior:

1. Select base service/frequency.
2. Apply active-pet quantity rule.
3. Apply zone/yard-size adjustments.
4. Add optional add-ons.
5. Apply promotion/discount.
6. Calculate tax if applicable.

Tenants may replace the formula with fixed pricing, quote-required behavior, or their own price rules.

## Public signup flow

Default pet-waste signup form:

1. service address
2. service-area eligibility
3. contact information
4. service type/frequency
5. pet count and pet details
6. yard/access information
7. instant price or request-a-quote result
8. add-ons/cross-sells
9. preferred service-day information
10. notification preferences
11. payment method when required
12. terms acceptance
13. account/portal activation

If address is outside supported service area, create a Lead rather than discarding the submission.

## Lead conversion defaults

A successful self-service signup may bypass a manual estimate when pricing rules resolve confidently.

Possible default path:

`Website Signup -> Customer -> Service Location -> Pets -> Active Service Plan -> Payment Method -> Initial/Recurring Job Generation -> Portal Invite`

If price or eligibility cannot be resolved:

`Website Submission -> Lead -> Office Review -> Estimate -> Approval -> Service Plan`

## Cleanup job defaults

Required/available field workflow:

- confirm correct property
- review access/safety notes
- optional on-the-way notification
- start cleanup
- record issue/safety condition when present
- perform service
- optional/required completion photo according to tenant setting
- technician note
- material/add-on usage when relevant
- complete cleanup
- send completion notification

Default terminal reasons for non-completion:

- gate locked/no access
- unsafe animal
- customer requested skip
- weather
- property condition
- technician issue
- address/problem locating property
- other

Each tenant can decide which reasons are billable.

## Reclean/service recovery

Customer or staff may create a reclean request linked to the original cleanup.

Default behavior:

- original cleanup remains completed
- follow-up Job created with `needs_return` relationship
- optional no-charge pricing
- reason and customer complaint retained
- reclean rate included in technician/service reporting

## Routing defaults

Optimization should use:

- assigned service day
- technician start/end location
- estimated cleanup duration
- geocoded service address
- locked stops
- route zone
- technician/location assignment
- optional customer time constraints

Default estimated service duration may use pet count, yard size, service frequency, and historical average when sufficient data exists.

## Default customer notifications

Suggested recipes, all tenant-configurable:

- signup confirmation
- portal invitation
- service reminder
- technician on the way
- cleanup completed
- cleanup skipped/missed
- schedule changed
- payment receipt
- payment failed
- invoice due/overdue
- service-plan paused/resumed/canceled

## Default automation recipes

### New self-service signup
Trigger: valid website signup

Actions:
- create/update customer
- create location and pet assets
- create service plan when pricing/eligibility permits
- create first cleanup
- send signup confirmation
- invite customer to portal
- notify office if manual review is required

### Cleanup completed
Trigger: job.completed

Actions:
- send completion notification
- attach designated completion proof
- update service history
- create/issue invoice or add to billing cycle according to plan
- record route completion
- evaluate cross-sell/follow-up rules

### Payment failed
Trigger: payment.failed

Actions:
- send configured customer notification
- create office alert/ticket after configured retry threshold
- retry according to payment policy

### Customer pause request
Trigger: customer_change_request submitted with type pause

Actions:
- create review item
- optionally auto-approve when request fits tenant policy
- suspend future generation for effective dates after approval
- notify customer

### Route published
Trigger: route.published

Actions:
- update technician field view
- optionally send service-day reminders to affected customers

## Customer portal defaults

Customers may:

- view next cleanup
- view service history/completion proof
- manage contact information
- manage pets
- request address/access changes
- manage notification preferences
- view service plan/frequency
- request pause/resume/cancel/change
- view estimates
- view/pay invoices
- manage payment method through connector
- manage tips when enabled
- create support/reclean tickets
- view shared photos/files

Changes that affect routes, price, service eligibility, or billing require approval unless tenant policy explicitly allows automatic application.

## Technician defaults

Technician Today screen emphasizes:

- clock in
- route
- next stop
- access/safety warning
- pet count/names
- start/complete cleanup
- skip reason
- completion proof
- route progress
- time/mileage

Pet safety flags receive prominent visual treatment.

## Time/payroll defaults

Useful compensation inputs:

- hourly shift time
- paid/unpaid breaks
- per-cleanup bonus
- revenue commission
- tips
- personal vehicle mileage
- route/customer-count bonuses

The pack defines defaults only; compensation is controlled by the shared payroll model.

## Inventory defaults

Pet waste removal usually needs lightweight consumables rather than parts.

Example items:

- waste bags
- deodorizer/treatment
- gloves
- boot covers
- waste-station liners
- sanitizer

Inventory tracking is optional and should not clutter a small operator that disables it.

## Commercial clients

Commercial clients may have:

- multiple service locations
- multiple work areas per location
- multiple contacts
- different billing contact
- PO/account references
- multiple service plans
- net terms
- consolidated or per-location invoices

## Default reports

- active clients
- new/lost/net clients
- average client value
- recurring revenue
- cleanups completed/skipped/missed/reclean
- cleanups per technician/hour
- revenue per technician/hour
- route miles and drive time
- route density
- service time by pet count/yard size
- tips
- payment failures/open balances
- referral source
- service-frequency mix
- zone profitability inputs
- commercial vs residential revenue
- customer ratings/comments

## Website defaults

Suggested sections:

- hero/value proposition
- how it works
- services
- pricing/instant quote
- service-area checker
- why choose us
- FAQs
- reviews/testimonials
- request service / signup
- customer login
- contact

The template should prioritize mobile conversion and allow a business to publish using only the structured onboarding data.

## Reference-pack success test

The pack is successful when its entire workflow can be implemented using shared entities, fields, forms, pricing rules, automations, reports, and templates without introducing pet-waste-specific application branches.
