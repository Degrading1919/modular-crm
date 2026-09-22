# V1 Reporting Specification

## Goal

Give owners operational visibility without requiring a separate BI tool while keeping reporting generic enough for Industry Packs.

## Report layers

### Operational lists

Fast filtered tables:

- customers
- leads
- jobs
- routes
- invoices
- payments
- staff/time
- inventory
- tickets

### KPI dashboards

Aggregated metrics for current period and comparison period.

### Deep reports

Grouped/filtered operational and financial reports.

### Exports

CSV background export for large result sets.

## Core report catalog

### Customer

- active/paused/inactive customers
- new customers
- lost customers
- net growth
- average customer value
- customer retention/churn inputs
- customer type
- service-plan mix
- referral source

### Sales

- leads by source/status
- lead conversion
- estimates sent/approved/declined
- estimate conversion rate
- average estimate
- add-on/cross-sell performance

### Service operations

- jobs scheduled/completed/skipped/missed/canceled/reclean
- completion rate
- average service duration
- on-time/window adherence where applicable
- service mix
- zone/work-area metrics

### Routes

- route distance
- drive time
- service time
- stops
- jobs/hour
- miles/job
- route utilization
- estimated vs actual

### Financial

- invoiced
- collected
- outstanding
- aging buckets
- failed payments
- refunds
- recurring revenue inputs
- revenue by service/location/customer type

Do not label accounting figures as GAAP financial statements.

### Staff

- shift hours
- job time
- route/service productivity
- jobs/hour
- revenue/hour
- mileage
- tips
- reclean/complaint metrics where configured

### Payroll

- approved hours
- gross-pay components
- gross calculated pay
- bonus/commission/tip/mileage components

### Inventory

- stock on hand
- usage
- transfers
- adjustments
- low stock
- usage by service/job/staff

### Multi-location/franchise

- location revenue/operations
- location customer growth
- route/staff metrics
- rolled-up parent totals
- royalty basis/statements when configured

## Filters/dimensions

All relevant reports support:

- date range
- organization/location
- service
- customer type
- service zone
- technician/team
- lead source
- status
- Industry Pack reportable fields

## Comparison

Dashboard metrics may show:

- previous equivalent period
- previous month
- previous year when sufficient data exists

Do not manufacture percentage comparisons when prior denominator is zero; display appropriate no-baseline state.

## Metric definitions

Every KPI has a stable definition in code/config.

Examples:

`jobs_per_service_hour = completed jobs / actual service hours`

`reclean_rate = reclean-linked jobs / completed jobs eligible for reclean tracking`

`estimate_conversion = approved estimates / estimates with terminal customer decision in selected cohort`

Definitions should be discoverable via UI help.

## Industry Pack reports

Packs may register:

- report presets
- extra dimensions
- derived metrics based on pack fields

Pet Waste Removal examples:

- service duration by dog count
- route density
- reclean rate
- active clients by frequency
- tips by technician
- commercial vs residential

## Performance

- simple reports query indexed transactional data
- common dashboard metrics may use snapshots/materialized aggregates
- large exports run in background
- report queries enforce tenant/location permissions before aggregation
