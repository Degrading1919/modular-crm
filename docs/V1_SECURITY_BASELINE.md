# V1 Security and Privacy Engineering Baseline

This document defines product engineering requirements, not legal certification.

## Authentication

- use the maintained authentication library for password/session handling
- require secure session cookies
- support email verification and password reset
- support session revocation
- rate-limit authentication attempts
- preserve room for future MFA

## Authorization

- enforce permissions on the server
- enforce tenant, organization, location, assignment, and customer-relationship scope
- never trust a client-provided tenant identifier as authorization
- deny sensitive actions by default

## Secrets and credentials

- keep secrets server-side
- store connector authorization material using encrypted or secret-store-backed mechanisms
- do not log secrets
- do not return secrets in ordinary API responses
- support revocation and rotation

## Payments

- do not store raw card or bank-account credentials
- store provider-safe references/tokens only
- keep payment-processor responsibilities behind payment connectors

## Sensitive business data

Apply stronger handling to:

- customer contact information
- property access instructions
- technician route/location data
- compensation/payroll information
- connector credentials
- payment references
- private notes and files

Support field-level encryption for especially sensitive access information.

## Messaging preferences

Record:

- notification preference
- channel preference
- preference-change source/time
- suppression state

Transactional and marketing message categories should remain distinguishable.

## Retention and offboarding

Before public launch, define production retention rules for business, employee, financial, file, and integration-event data.

Architecture must support:

- archive
- export
- connector revocation
- custom-domain removal
- policy-driven deletion

## Web application protections

Use maintained framework/platform protections and secure defaults for:

- session/cookie handling
- request validation
- safe content rendering
- database parameterization through the data layer
- file-upload validation
- protected file access
- webhook authenticity checks
- public-form abuse controls

## Audit

Audit at minimum:

- role and permission changes
- staff invitations/deactivation
- sensitive customer-data changes
- estimate approval
- invoice issue/void/adjustment
- payment/refund
- payroll approval/export
- connector connect/disconnect
- domain changes
- automation activation
- developer credential creation/revocation
- protected exports

## Staff location privacy

If technician location or breadcrumbs are used:

- limit collection to legitimate work purposes
- make the behavior visible in business settings
- scope it to active work/shift policy
- prevent customer access

Continuous tracking should not be an invisible default.

## Logging

Production logs should prefer identifiers and correlation IDs over private record contents.

Do not intentionally include:

- passwords
- authorization tokens
- connector secrets
- full payment credentials
- sensitive property-access details

## Backups and recovery

Production deployment documentation must include:

- managed database backups
- object-storage durability policy
- restore procedure
- periodic restore testing

## Dependency and code hygiene

- commit lockfiles
- run automated tests in CI
- use dependency/security update workflows
- use secret scanning
- review license compatibility before reusing source from reference projects
