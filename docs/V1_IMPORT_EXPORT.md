# V1 Import and Export Specification

## Goal

Make migration into Modular CRM easy enough that an owner can move from spreadsheets or another CRM without technical help.

## Import sources

V1 framework supports:

- CSV upload
- connector-driven import
- seeded/local test import

The normalized staging pipeline is shared across all sources.

## Import batch

Every import creates an ImportBatch containing:

- tenant
- source type
- source connector/file
- entity type
- mapping version
- status
- row counts
- created/committed actor
- timestamps
- error summary

## Supported initial entities

- customers
- customer contacts
- service locations
- customer assets
- leads
- service plans where enough data exists
- inventory items
- service catalog

Financial-history import may be added when a connector provides safe semantics; V1 should not guess historical accounting state from arbitrary spreadsheets.

## CSV pipeline

1. Upload.
2. Detect encoding/delimiter/header.
3. Infer columns.
4. Match known aliases.
5. Apply Industry Pack aliases.
6. Normalize phone/email/address/date/boolean formats.
7. Detect duplicates.
8. Display only uncertain mappings and validation failures.
9. Preview representative records.
10. Commit valid records.
11. Download errors for rows not committed.

## Auto-mapping confidence

Mapping results carry confidence:

- high: apply silently but show in summary
- medium: preselect and ask for confirmation
- low: require user choice or ignore column

Examples for pet waste:

- "Dog Name", "Pet", "Pet 1" -> pet asset candidate
- "Gate Code" -> service-location access field
- "Frequency" -> service-plan recurrence candidate

## Duplicate detection

Use configurable matching across:

- normalized email
- normalized phone
- address
- company/contact name
- provider external ID when present

Do not merge ambiguous customers automatically.

Choices:

- create new
- merge into existing
- skip
- update selected fields

## Transaction strategy

Small imports may commit transactionally.

Large imports:

- stage rows
- process in bounded batches
- record per-row status
- remain resumable/idempotent

A retry cannot create duplicate records.

## Provenance

Imported entities retain:

- import_batch_id
- source connector/provider ID where applicable
- original external key when useful

Provenance is not customer-visible by default.

## Export

Provide CSV exports for:

- customers
- contacts
- locations
- assets
- leads
- jobs
- service plans
- estimates
- invoices
- payments
- time/mileage
- payroll calculations
- inventory
- tickets
- major reports

Exports obey permissions and location scope.

Large exports run in background and produce expiring protected download links.

## Full tenant export

Owner/Admin can request a structured business-data export for portability.

It should include core tenant-owned data in machine-readable form plus file manifest.

Secrets, raw connector tokens, password/auth credential material, and provider-protected payment credentials are excluded.

## Deletion/offboarding

Product architecture should make tenant offboarding/export possible without proprietary database transformation.

Actual retention/deletion policy should be finalized before public launch.
