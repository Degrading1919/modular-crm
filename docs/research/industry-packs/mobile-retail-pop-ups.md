# Mobile retail pop ups

## Profile metadata

- **Industry key:** `mobile-retail-pop-ups`
- **Source name:** Mobile retail pop ups
- **Source category:** Retail / Hospitality
- **Candidate source:** [Sweaty Startup candidate list](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Retail / Hospitality, position 2 of 6.
- **Other exact/near duplicate labels:** None established; the adjacent broad brick-and-mortar label is not an alias.
- **Research date:** 2026-09-24
- **Geographic scope:** US examples; temporary sales permits and taxes vary by state/locality.
- **Research status:** complete

## Executive summary

**Observed evidence:** A pop-up is a temporary retail activation, from a single-day market to a short-term leased space. A brand may operate across events and online channels; stock, POS sales, location, and sales tax/temporary licensing must stay coordinated. Shopify documents its POS use at pop-ups and shared inventory/order administration; Ohio provides a state example of a transient vendor license for temporary sales.

**Inference:** The distinctive workflow is product assortment and stock allocation → event/vendor/venue booking and permissions → temporary setup and payment acceptance → sales/returns and count reconciliation → restock, event profitability, and next activation. This is retail selling with mobile venue/event logistics, not a rental or field-service job. Permit and tax needs must be set per jurisdiction.

## Business model and customer segments

- Brands, makers, boutiques, and online-first retailers sell goods at markets, festivals, fairs, temporary leases, or private activations. Retail sales may coexist with e-commerce and a permanent store.
- Demand is event/season/location driven. Organizer/vendor applications, pop-up leases and collaborations produce distinct contract/lead records. A retailer may own product or sell consigned goods; inventory ownership must be explicit.
- Solo sellers and staffed multi-event brands need different checkout, staffing, and stock reconciliation. Mobile retail can mean a tent/table, market stall, trailer, or temporary indoor unit; sources do not establish one standard setup.

## Terminology and durable records

- Records: event/activation, venue, vendor application, selling dates/hours, SKU/variant assortment, allocated/loaded/sold/returned quantities, staff shift, POS sales, returns, tax, and event settlement.
- Location fields include venue, booth/space, load-in access, power/connectivity, event organizer, sales area, permit/tax jurisdiction, and event hours. Persistent assets can include trailer, canopy, fixtures, POS hardware, displays, and card reader.
- SKU, variant, cost, price, tax category, ownership/consignment and stock-on-hand are commerce records; sensitive payment data belongs in a compliant payment provider, not the pack.

## Services, intake, quoting, and booking

- Lead intake: event or venue, dates/hours, audience, booth/space fee, load-in/strike rules, product fit, insurance/permit evidence, expected sales terms, internet/power, and cancellation/refund terms.
- Retail price is product-specific rather than labor estimate. Plan assortment and quantity by event; track vendor booth fee, travel, labor, and event costs separately for profitability.
- Online self-service can support event interest and product discovery, but venue participation may require application/approval. A website should show upcoming locations, dates, stock availability if reliable, and online channel.

## Pricing and commercial model

- **Observed:** No representative consumer product/service price can be generalized from the candidate label. Product pricing is tenant/catalog specific. Shopify's POS documentation describes software/product capability but current plan cost is not assessed here.
- Costs include event/booth fee, lodging/travel, staff, fixtures, payment processing, shipping/restock, and unsold stock. Sales tax registrations/collection vary by sales location and nexus; Ohio's transient-vendor material is a jurisdiction-specific example, not universal guidance.
- No direct owner software WTP evidence established. Do not infer SaaS budget from merchandise revenue.

## Recurrence, scheduling, dispatch, and routing

- Schedule events, setup/load-in, open selling hours, teardown, travel, and restock. Staff shift and transport capacity should align to events; multiple concurrent pop-ups require separated stock and checkout reports.
- Weather, event cancellation, organizer acceptance, permit delays, and low sales can lead to cancellation or inventory return. An event date does not imply an approved stall.
- Routing is conditional for multi-location/event runs; product distribution/transfer between locations matters more than technician routing.

## Field workflow, safety, completion, and rework

- Confirm acceptance, event terms, location and local permits/tax setup → allocate/pack SKUs and display/POS assets → load in/set up → open checkout and record sales/discounts/returns → reconcile cash/card and remaining stock → teardown/return/transfer → record event costs and outcome.
- Organizer/site rules for power, fire lanes, tents, accessibility, insurance and food/regulated goods are venue/jurisdiction-specific. Candidate covers general retail products; regulated merchandise may need distinct controls.
- Do not equate POS settlement with inventory count. Record discrepancies, damage, theft, failed checkout/connectivity, weather closure, and customer returns.

## Customer communication and self-service

- Customers need event dates/location, product availability, payment options, return policy, and post-purchase receipt. Sellers need event confirmations, load-in instructions, organizer changes, and payout/settlement records.
- Shared e-commerce and in-person stock should update together where the POS/platform supports it; Shopify states inventory sync across POS, online store and other channels. Connectivity loss and oversell handling remain tenant-specific.

## Equipment, inventory, suppliers, and workforce

- Merchandise is core stock; manage SKU/variant/size/color, quantity, cost, retail price, allocation by location, replenishment, and returns. Track consignment/owned stock separately if applicable.
- Physical kit can include display fixtures, signage, tent/trailer, power, lighting, packing, POS device, cash drawer, scanner and card reader. Assign staff/shift and payment permissions. No universal purchasing or staffing pattern found.

## Reporting and operating measures

- **Observed incumbent capability:** Shopify POS connects in-person sales to shared order/inventory administration and multiple locations/channels.
- Useful KPIs: event gross/net sales, sell-through by SKU, opening/closing stock variance, average basket, conversion where measured, event costs/margin, payment mix, returns, and repeat customer capture. These measures are recommendations, not all documented operator behavior.

## Existing software and operator evidence

- Shopify POS supports selling at markets/pop-ups and syncs orders/inventory with other channels. Square offers retail POS and inventory features; the exact plan gates and prices should be checked for tenant's current product/date.
- No repeated operator complaint corpus or reliable public pop-up retailer CRM WTP evidence found. The requirement to avoid double-entry between POS, online stock, event roster, and finance is an inference from multichannel workflow, not a measured complaint.
- Do not confuse software plan or card processing fees with the retailer's customer product prices.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Retailer, activation/pop-up, venue, organizer, SKU/variant, customer; online-first brand, maker, boutique | Shopify pop-up and POS model | High |
| `locationFields`, `assets` | Event address/booth/load-in/power; display kit/trailer/POS hardware | Temporary sales logistics | Medium |
| `services`, `recurrencePresets` | Pop-up event, market stall, short-term retail activation | Candidate label and seller guide | Medium |
| `formSteps`, `website` | Upcoming events, location, assortment, tax/permit and venue approval questions | Temporary sales requirements | Medium |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Event approval, stock allocation, pack/load/setup, checkout, reconciliation/returns | Retail event lifecycle | Medium |
| `pricingTemplates` | Not service quote; product catalog prices and event cost/margin inputs | Retail selling model | High; product catalog/POS boundary matters |
| `defaultAutomations` | Event reminder, pack list, stock/settlement closeout | Workflow inference | Low |
| `reports` | SKU/event sell-through, variance, sales and event margin | POS/inventory model | Medium |
| `inventoryDefaults` | Tenant product catalog and display/POS kit | Stock is central | High |
| `recommendationQuestions` | Online channel? multiple event locations? consignment? regulated goods? seller permit/market approval? | Changes inventory/tax needs | High |
| `productCapabilityRecommendations` | `inventory_management`, `payment_collection`, `invoicing`, `customer_portal`; candidate `point_of_sale` key unconfirmed | POS and omnichannel workflow | Medium |
| `recommendedConnectorCapabilities` | `payments`, `accounting`, `email`, `sms`, `calendar`, `storage`; `geocoding` optional | Checkout, settlements, event comms | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `inventory_management` | normally_recommended | Event stock allocation and sales | High |
| `payment_collection` | normally_recommended | Customer in-person checkout | High |
| `invoicing` | conditional | Wholesale/B2B or event organizer settlement, not every retail checkout | Medium |
| `customer_portal` | usually_unnecessary | Consumer checkout is normally POS/web storefront; use only for wholesale or event account | Low |
| `service_scheduling` | optional | Event/date calendar and staff shifts | Medium |
| `field_job_tracking` | usually_unnecessary | Selling at a booth is not a service job | Medium |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Event setup, temporary locations, sales reminders | Pack configuration | Pop-up selling guide and POS docs | Medium |
| Customer, tasks, schedule, connectors, inventory defaults | Existing shared capability | Current contract can represent operational shell | Medium |
| Catalog variants, real-time multi-channel stock, tax calculation/filing | Business-specific customization or connector/POS responsibility | Depends on retail vertical and commerce stack | High |
| Native retail POS core gap | No gap established | Evidence identifies mature POS solutions; user request is research, not gap proof | High |

## Evidence, disagreements, and uncertainty

Evidence is high that temporary location sales and cross-channel stock matter, medium for permit specifics and low for operator software complaints/WTP. The pop-up format spans artisan fairs, festivals, temporary stores, and mobile trailer retail; venue and product type change the checklist.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [Shopify POS in-person selling](https://help.shopify.com/en/manual/sell-in-person/shopify-pos) | POS incumbent primary | Accessed 2026-09-24 | Product documentation | Pop-up selling, shared orders/inventory across channels/locations | Vendor claims; plan/fees vary |
| [Shopify pop-up shop guide](https://www.shopify.com/blog/pop-up-shop) | Commerce platform guide | Accessed 2026-09-24 | General, US-oriented | Temporary retail spaces, permits/lease and POS inventory workflow | Vendor guidance, not legal source |
| [Ohio transient vendor licenses](https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/sales_and_use/vendors_sales_tax_laws.pdf) | Ohio Department of Taxation primary | Accessed 2026-09-24 | Ohio | Temporary sales license example at fairs/trade shows | Ohio only; rules can change |
| [Square inventory tracking](https://api.squareup.com/help/us/en/article/7746-tracking-your-inventory-with-square-for-retail) | POS incumbent primary | Accessed 2026-09-24 | US product docs | POS adjustment and inventory connection; plan gating | Vendor documentation, subscription varies |
| [Small retailer inventory/POS question](https://www.reddit.com/r/smallbusiness/comments/1gbrerx) | Retail owner/community | Accessed 2026-09-24 | US anecdotal | Variant stock lookup and product cost concerns | Individual retailer, not pop-up-specific |

## Handoff to a future pack implementer

Ask what products are sold, who owns them, which event formats/venues are used, online/store channels, tax locations, approval/permit responsibility, payment hardware and stock transfer practices. Use this pack for event/location/staff/stock planning; rely on connected retail POS/catalog and jurisdictional tax tools for transactions and tax logic. Do not merge with permanent-store defaults or assume one pop-up permit regime.
