# V1 Pricing Engine Specification

## Goal

Model pricing for many service industries without hard-coded vertical logic.

Pricing must be deterministic, explainable, effective-date aware, and snapshot results into customer-visible financial documents.

## Inputs

Pricing context may contain:

- tenant
- organization/location
- customer type
- customer
- service location
- service/pricing zone
- service
- frequency/recurrence
- quantity
- date
- Industry Pack asset counts/fields
- selected add-ons
- coupon/promotion
- manually authorized override

## Rule format

A rule includes:

- name
- priority
- effective period
- conditions
- effects
- source
- active state

Conditions use the same safe declarative comparison model as automations where practical.

## Effect types

V1:

- set_base_amount
- add_fixed
- subtract_fixed
- add_percentage
- subtract_percentage
- per_unit
- quantity_tier
- set_minimum
- set_maximum
- mark_quote_required

## Evaluation order

Default:

1. find applicable base price
2. apply quantity/per-unit/tier adjustments
3. apply location/zone adjustments
4. apply add-ons
5. apply tenant-authorized discounts/promotions
6. apply minimum/maximum
7. calculate tax separately
8. round once according to currency rules

Rules have explicit priority where order matters.

## Itemized document calculation

The shared domain `priceDocument` contract uses integer minor units and BigInt intermediate arithmetic. Quantities have at most four decimal places; rates use integer basis points. Extended quantity × unit price rounds half-up to a minor unit. Deduct each line's amount discount, then calculate the document amount/percent discount on the remaining subtotal (percent discounts round half-up).

Allocate the document discount proportionally across net lines: the cumulative allocation is the floor of discount × cumulative net / total net, and each line gets the difference from the previous cumulative allocation. This sums exactly to the discount, including any final remainder, in stored line order. Taxable basis is each taxable line after both discounts. Compute cumulative tax at the configured rate half-up and assign cumulative differences to taxable lines: this rounds tax once per document, not independently on each line. Non-taxable lines receive zero tax. Line totals and displayed subtotal − discount + tax always reconcile exactly.

Quote previews include all optional lines. Customer-choice previews and approval run this same calculator on only required and selected optional lines using the revision's frozen rate and discount. Save approved pricing separately from the immutable offered revision; conversion copies amounts without another calculation. Legacy records without this versioned contract retain their recorded amounts. Reject invalid quantities, unsafe amounts and discounts exceeding the selected subtotal; never fabricate prices for missing catalog data.

## Explainability

Pricing result returns:

- subtotal
- each applied rule
- adjustment amount
- discount
- taxable basis
- tax estimate
- total
- quote_required
- warnings

UI can show an owner "why this price" without exposing unnecessary internals to the customer.

## Overrides

Authorized staff may override a price.

Override requires:

- new amount or adjustment
- reason
- actor
- timestamp

The override is snapshotted into estimate/job/invoice.

## Effective dating

Rule changes apply only to pricing decisions on/after effective date unless explicitly used to reprice future unbilled work.

Historical estimates/invoices never recalculate because the pricing catalog changed.

Service Plan pricing behavior is configurable:

- locked until manually changed
- follows future catalog prices
- follows catalog after notice/effective date

Any automatic plan repricing must create a plan-change history event.

## Pet Waste reference examples

No dollar values are hard-coded.

Possible rules:

- Weekly cleanup base price
- + amount per dog after first
- biweekly surcharge
- one-time cleanup quote-required above configured pet/yard threshold
- zone surcharge for outer service area
- deodorizer fixed add-on
- coupon percentage discount
- minimum recurring visit price

## Public instant quote

The public site may show a deterministic price only when:

- required fields exist
- service area is eligible
- no applicable rule marks quote_required
- pricing result has no unresolved ambiguity

Otherwise create a lead/request for review.

## Tests

Unit tests must cover:

- rule precedence
- effective dates
- quantity tiers
- multiple simultaneous adjustments
- coupon limits
- minimum/maximum
- taxes separated from price adjustments
- snapshot immutability
- pet-waste sample matrices
