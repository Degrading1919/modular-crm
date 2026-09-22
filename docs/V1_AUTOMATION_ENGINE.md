# V1 Automation Engine Specification

## Goal

Provide useful zero-configuration automations from Industry Packs and allow nontechnical owners to build custom rules without code.

## Rule model

Each rule contains:

- name
- description
- source: core_recipe | industry_pack | tenant
- trigger
- conditions
- actions
- status
- configuration version
- owner/creator
- audit metadata

## Trigger schema

A trigger references a normalized domain event and optional trigger-level filters.

Example:

```json
{
  "event": "job.completed",
  "filters": [
    {"field": "job.service_id", "operator": "equals", "value": "..."}
  ]
}
```

## Condition model

Conditions use declarative groups.

Supported operators:

- equals / not_equals
- in / not_in
- exists / not_exists
- greater_than / greater_or_equal
- less_than / less_or_equal
- contains / not_contains
- starts_with / ends_with
- before / after
- within_days
- changed
- changed_from / changed_to

Logical composition:

- all
- any
- not

Values may reference safe event/context paths.

No arbitrary code/eval.

## Action model

An action has:

- action_type
- configuration
- optional delay
- optional continue_on_error
- optional dedupe key template

V1 actions:

- send_email
- send_sms
- create_ticket
- update_ticket
- create_job
- reschedule_job
- create_invoice
- issue_invoice
- attempt_payment
- add_customer_tag
- remove_customer_tag
- update_customer_status
- update_custom_field
- add_note
- notify_staff
- pause_service_plan
- resume_service_plan
- invoke_connector_action
- enqueue_followup_automation

## Delayed actions

Support relative delays such as:

- immediately
- N minutes/hours/days after event
- N days before/after due date or scheduled date where source field exists

Delayed actions create durable scheduled jobs.

If the originating record changes before execution, the action re-evaluates configured conditions unless the recipe explicitly snapshots behavior.

## Recursion protection

Track:

- correlation_id
- causation_id
- automation rule ID/version
- event chain depth

Prevent or warn when:

- a rule's action deterministically emits its own trigger with no narrowing condition
- two rules create an obvious infinite loop
- event chain depth exceeds safe threshold

## Idempotency

Automation run key:

`tenant + rule_id + rule_version + triggering_event_id`

Each action also receives a deterministic action execution key.

Retries cannot duplicate invoices, payments, messages, jobs, or connector mutations.

## Failure behavior

Action failures are categorized:

- retryable external/transient
- validation/permanent
- authorization/configuration
- connector unavailable

Rules support bounded retries with exponential backoff for retryable failures.

UI shows:

- rule
- triggering event
- current action
- attempts
- failure reason
- retry button when safe

## Recipe installation

Industry Packs may install recipes by stable source key.

Tenant changes create an override/copy while retaining source lineage.

Pack upgrades:

- may add new inactive/recommended recipes
- may update untouched default recipes
- must not silently overwrite tenant-modified recipes

## Rule builder UX

Wizard-style:

1. When this happens...
2. Only if...
3. Do this...
4. Then optionally...
5. Review example
6. Turn on

Show business labels, not domain-event implementation names.

Example:

`When a cleanup is completed -> send the customer the "Cleanup complete" text message.`

Advanced JSON is not exposed to ordinary users.

## Simulation

Before activation, allow "Test this rule" against a selected historical/sample entity.

Simulation:

- evaluates conditions
- renders actions/templates
- does not perform destructive/external actions
- clearly shows what would happen

## Audit

Record:

- rule creation/change/activation
- configuration versions
- automated actions
- actor as automation/system
- linked triggering event
