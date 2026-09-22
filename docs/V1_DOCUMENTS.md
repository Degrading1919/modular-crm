# V1 Customer Documents and Statements

## Goal

Provide professional customer-facing documents without requiring an external document service.

## Required document types

- estimate
- invoice
- payment receipt
- customer account statement
- service/completion report
- pay statement for staff
- royalty statement when franchise features are enabled

## Rendering

Documents should be generated from the same immutable snapshots used by the application.

Preferred implementation:

- responsive HTML view for browser
- print stylesheet
- server-generated PDF when download/email attachment is requested

Provider-specific PDF services are not required.

## Branding

Documents use tenant/customer-facing branding:

- business name/logo
- business contact information
- optional location/branch identity
- document number/date
- customer details
- relevant terms/notes
- totals/status

## Estimate

Show:

- estimate/revision number
- valid-through date
- services/items
- discounts
- tax
- total
- terms
- approval status

Approved estimates render the approved revision, not the latest draft if a later internal draft exists.

## Invoice

Show:

- invoice number
- issue/due date
- service/job references where useful
- line items
- discounts/tax
- total
- payments/credits
- remaining balance
- payment instructions/link when applicable

## Customer statement

For selected period:

- opening balance
- invoices
- payments
- refunds
- credits/credit memos
- closing balance

## Service/completion report

Configurable by Industry Pack.

Pet Waste Removal default may include:

- service address
- cleanup date/time
- technician
- completion status
- customer-visible note
- designated completion photo(s)
- add-on work

Other industries may supply richer inspection/compliance forms later using the same document framework.

## Delivery

Documents may be:

- viewed in portal
- downloaded
- printed
- attached/linked from outbound email

Secure customer document links must be authorization/signed-link protected.

## Versioning

Issued/approved customer documents preserve:

- template version
- business/customer snapshot
- line/item snapshot
- terms version
- generated timestamp

Regeneration should reproduce the historical business meaning even if current customer/service data has changed.
