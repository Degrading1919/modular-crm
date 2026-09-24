# Industry Packs

## Purpose

Industry Packs make the shared platform feel purpose-built for a niche without creating a separate application fork.

An Industry Pack should primarily be configuration.

## Industry Pack responsibilities

A pack may define:

- terminology
- customer/location labels
- asset types
- custom fields
- job types
- status workflows
- recurring service defaults
- forms and checklists
- reports
- automations
- dashboard defaults
- structured product capability recommendations, including conditional recommendations based on onboarding answers
- recommended connector capabilities
- website copy/content defaults
- website template preferences
- inventory/part defaults where relevant
- route/service-duration assumptions

## First reference Industry Pack: Pet Waste Removal

Pet waste removal is the first complete reference implementation and should prove that the shared platform can support a route-dense recurring service business end to end.

The pack should cover at minimum:

- residential and commercial customers
- service addresses
- yards/work areas
- pets/dogs, including names, photos, and safety flags
- gate/access instructions
- recurring service frequencies
- one-time/initial cleanups
- route-oriented scheduling
- service-day assignment
- completion proof/photos
- skip/missed/reclean handling
- weather or operational bulk changes
- zone/service-area pricing
- payment method capture
- recurring billing
- customer notification preferences
- on-the-way and completion notifications
- customer pause/change/cancel requests
- technician notes
- time/mileage tracking
- tips
- customer ratings/comments
- referral source tracking
- cross-sells/add-on services
- commercial multi-location support
- pet-waste-specific website signup/onboarding defaults

The reference pack should demonstrate Industry Pack configuration rather than introduce pet-waste-specific tables unless a shared configurable entity cannot reasonably represent the requirement.

## Future examples

### Septic service

Possible configuration:

- Asset: Septic System
- Fields: tank size, tank material, system type, number of lids, last pump date
- Recurrence: multi-year service reminders
- Job types: pump, inspection, repair
- Recommended capabilities: payments, accounting, SMS reminders, maps, calendar, photo storage

### Appliance repair

Possible configuration:

- Asset: Appliance
- Fields: appliance type, manufacturer, model, serial number, warranty status
- Workflow: diagnose -> parts needed -> parts received -> return visit -> completed
- Recommended capabilities: payments, calendar, email/SMS, accounting

## Design rule

Do not create industry-specific database tables unless a real product requirement cannot reasonably be modeled through the shared platform.

Industry Packs should remain easy to add and revise without destabilizing the core product.

Packs configure available functionality and recommend a small, relevant starting stack. They do not grant commercial entitlement or define fixed prices. A recommendation can be normally recommended, optional, usually unnecessary, or conditional; the tenant can accept it or customize the setup. The subscription system determines which modules the tenant owns, and capability enforcement remains outside the pack.
