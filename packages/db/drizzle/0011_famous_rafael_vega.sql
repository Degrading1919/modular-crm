ALTER TABLE "outbound_messages" ADD COLUMN "category" text DEFAULT 'transactional' NOT NULL;
--> statement-breakpoint
-- Classify existing work only from its actual tenant-bound automation execution ledger.
WITH ledger AS MATERIALIZED (
  SELECT run.tenant_id, action->>'executionKey' AS execution_key,
    run.context_snapshot->'event'->>'eventType' AS event_type
  FROM automation_runs AS run
  CROSS JOIN LATERAL jsonb_array_elements(CASE
    WHEN jsonb_typeof(run.context_snapshot->'plan'->'actions') = 'array' THEN run.context_snapshot->'plan'->'actions'
    ELSE '[]'::jsonb END) AS action
)
UPDATE outbound_messages AS message SET category = 'automation' FROM ledger
WHERE message.category = 'transactional' AND ledger.tenant_id = message.tenant_id
  AND ledger.execution_key = message.idempotency_key
  AND NOT (
    (coalesce(message.template_key, '') = 'payment-receipt' AND coalesce(ledger.event_type, '') = 'payment.succeeded')
    OR (coalesce(message.template_key, '') = 'payment-failed' AND coalesce(ledger.event_type, '') = 'payment.failed')
  );
