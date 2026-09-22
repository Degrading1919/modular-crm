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
- recommended capabilities
- website copy/content defaults
- website template preferences

## Example: septic service

Possible configuration:

- Asset: Septic System
- Fields: tank size, tank material, system type, number of lids, last pump date
- Recurrence: multi-year service reminders
- Job types: pump, inspection, repair
- Recommended capabilities: payments, accounting, SMS reminders, maps, calendar, photo storage

## Example: appliance repair

Possible configuration:

- Asset: Appliance
- Fields: appliance type, manufacturer, model, serial number, warranty status
- Workflow: diagnose -> parts needed -> parts received -> return visit -> completed
- Recommended capabilities: payments, calendar, email/SMS, accounting

## Design rule

Do not create industry-specific database tables unless a real product requirement cannot reasonably be modeled through the shared platform.

Industry Packs should remain easy to add and revise without destabilizing the core product.
