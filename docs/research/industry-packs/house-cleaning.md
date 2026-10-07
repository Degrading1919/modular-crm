# House cleaning — minimal reference pack

Research date: 2026-10-06. Scope: a small residential recurring/one-time cleaning business, not commercial facilities, remediation or a universal cleaning specification. Confidence: medium; defaults need operator validation before commercial use.

## Identity, terminology and customers

Clients own properties where work happens. Jobber models property-level custom fields separately from client information [Properties](https://help.getjobber.com/en/articles/properties/) and supports typed custom fields on clients, properties and jobs [API documentation](https://developer.getjobber.com/docs/using_jobbers_api/custom_fields/). Use Customer, Home, Room, Cleaning visit and Cleaner. One customer can own multiple homes; billing contacts remain core. Company sizes, regional requirements and franchise behavior are unknown and do not become defaults.

## Property fields, service objects and import

Record room count, home type, preferred first visit date, supplies provided and encrypted entry instructions. Persistent room names and floor surfaces help describe the agreed scope across visits (inference, medium confidence); room naming and care notes are customer editable, private entry instructions are not portal-visible. These are configuration on existing locations and customer-owned service objects, not new tables. Import recognizes room name, floor surface, room count and entry instructions through pack aliases.

## Services, recurrence, pricing and conversion

Offer recurring cleaning and one-time deep cleaning. Weekly/every-two-weeks/every-four-weeks are supported scheduling choices, not claims that every operator follows them. Per-room, flat-rate, hourly and area-based pricing vary by operator [Jobber cleaning pricing guide](https://www.getjobber.com/academy/cleaning/how-much-to-charge-for-house-cleaning/). Configure room count as the example quantity dimension; amounts belong to each business. Website address → contact → service/rooms → property details → price/terms uses the existing quote and recurring-plan path. One-time visits and uncertain prices remain office-reviewed leads. Do not infer deposits, market rates, certifications or guarantees.

## Field workflow, recovery, portal and communications

Confirm the property, clean agreed rooms, leave the property secure; required checklist keys are pack-defined. No-access, unsafe-conditions and customer-requested skips are nonbillable defaults pending business configuration. This minimal pack uses the shared job state machine and portal estimates, invoices, upcoming visits and customer profile; scope changes still need office approval. Jobber's [cleaning checklist examples](https://getjobber.com/wp-content/uploads/2022/12/12-Professional-House-Cleaning-Checklists-Jobber.pdf) support room-specific work; no checklist wording or code is copied. Detailed regulatory forms, inventory levels, payroll rules, routing assumptions and automated marketing are intentionally absent.

## Capability, software and commercial evidence

The practical starting stack is customers/properties, scheduling, recurring service, pricing, website requests, portal and billing. Payments, email, calendar and storage are provider-neutral connector recommendations. Multi-crew routing, inventory, payroll and advanced reports remain optional shared capabilities; no researched evidence here establishes packaging, willingness to pay, repeated software complaints or per-seat economics. Do not fabricate those findings. Jobber is the researched mature reference; no implementation code was copied, so third-party source licenses are not introduced.

## Runtime mapping and gaps

Map the terminology above to terminology; property inputs to locationFields; rooms to assets; two services to services; three recurrence presets; five formSteps; checklist and skip reasons; existing job workflow; room-count pricing template; customer/schedule/billing recommendations; neutral website hero. defaultAutomations, reports, inventoryDefaults and recommendationQuestions are empty for this minimal proof. The demonstrated core gap is that existing pack fields were bypassed by industry-specific consumers; slice 14 is authorized to wire those consumers generically. No new cleaning-only core feature is proposed.

## Validation

Ready for the authorized minimal second-pack implementation. Tenant-configured pricing and editable room metadata fit the shared model; more complex commercial contracts and operator-specific scopes require later research. Verify both industries end to end, legacy rows unchanged, unknown-field rejection and encrypted sensitive values. All sources accessed 2026-10-06; vendor evidence is product-specific, not an industry-wide consensus.
