CREATE TABLE "platform_email_usage" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"hour_start" timestamp with time zone NOT NULL,
	"day_start" timestamp with time zone NOT NULL,
	"hourly_count" integer DEFAULT 0 NOT NULL,
	"daily_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ALTER COLUMN "category" SET DEFAULT 'service';--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "purpose" text DEFAULT 'marketing' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "next_send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_email_usage" ADD CONSTRAINT "platform_email_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Conservative upgrade: classify recognized built-ins, never infer from an arbitrary trigger.
CREATE FUNCTION pg_temp.crm_email_purpose(key text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN key IN ('signup-confirmation','cleanup-completed','completion','completion-thank-you','job-completed',
    'service-day-reminder','route-published','appointment-reminder','visit-reminder','on-my-way',
    'estimate-sent','invoice-sent','invoice-due','payment-receipt','payment-failed') THEN 'service'
    WHEN key IN ('portal-invitation','password-setup','email-verification') THEN 'account'
    ELSE 'marketing' END
$$;
--> statement-breakpoint
UPDATE message_templates SET purpose = pg_temp.crm_email_purpose(key);
--> statement-breakpoint
CREATE FUNCTION pg_temp.crm_classify_action(action jsonb, source text, source_key text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(action->>'actionType',action->>'type') IN ('send_email','send_sms','message.send')
    THEN action || jsonb_build_object('purpose', CASE
      WHEN action->>'purpose' IN ('service','marketing','account') THEN action->>'purpose'
      WHEN source IN ('core_recipe','industry_pack') THEN
        CASE WHEN pg_temp.crm_email_purpose(coalesce(action->'configuration'->>'templateKey',action->>'templateKey',action->>'template')) = 'service'
          OR pg_temp.crm_email_purpose(source_key) = 'service' THEN 'service' ELSE 'marketing' END
      ELSE 'marketing' END)
    ELSE action END
$$;
--> statement-breakpoint
UPDATE automation_rules r SET actions = (
  SELECT coalesce(jsonb_agg(pg_temp.crm_classify_action(a.value,r.source,r.source_key) ORDER BY a.ordinality),'[]'::jsonb)
  FROM jsonb_array_elements(r.actions) WITH ORDINALITY a
) WHERE jsonb_typeof(r.actions) = 'array';
--> statement-breakpoint
-- Queued runs execute their saved plan, not the current rule. Upgrade that plan without changing execution keys.
UPDATE automation_runs run SET context_snapshot = jsonb_set(run.context_snapshot,'{plan,actions}', (
  SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(a.value->'action') = 'object'
    THEN jsonb_set(a.value,'{action}',pg_temp.crm_classify_action(a.value->'action',coalesce(run.context_snapshot->'rule'->>'source',r.source),r.source_key))
    ELSE a.value END ORDER BY a.ordinality),'[]'::jsonb)
  FROM jsonb_array_elements(run.context_snapshot->'plan'->'actions') WITH ORDINALITY a
)) FROM automation_rules r WHERE r.id=run.automation_rule_id AND r.tenant_id=run.tenant_id
  AND jsonb_typeof(run.context_snapshot->'plan'->'actions')='array';
--> statement-breakpoint
UPDATE automation_runs run SET context_snapshot=jsonb_set(run.context_snapshot,'{rule,actions}',(
  SELECT coalesce(jsonb_agg(pg_temp.crm_classify_action(a.value,coalesce(run.context_snapshot->'rule'->>'source',r.source),r.source_key) ORDER BY a.ordinality),'[]'::jsonb)
  FROM jsonb_array_elements(run.context_snapshot->'rule'->'actions') WITH ORDINALITY a
)) FROM automation_rules r WHERE r.id=run.automation_rule_id AND r.tenant_id=run.tenant_id
  AND jsonb_typeof(run.context_snapshot->'rule'->'actions')='array';
--> statement-breakpoint
WITH ledger AS MATERIALIZED (
  SELECT run.tenant_id, a.value->>'executionKey' AS execution_key, a.value->'action'->>'purpose' AS purpose
  FROM automation_runs run CROSS JOIN LATERAL jsonb_array_elements(CASE
    WHEN jsonb_typeof(run.context_snapshot->'plan'->'actions')='array' THEN run.context_snapshot->'plan'->'actions'
    ELSE '[]'::jsonb END) a
)
UPDATE outbound_messages m SET category = coalesce(ledger.purpose,CASE WHEN pg_temp.crm_email_purpose(m.template_key)='service' THEN 'service' ELSE 'marketing' END)
FROM ledger WHERE m.category='automation' AND ledger.tenant_id=m.tenant_id AND ledger.execution_key=m.idempotency_key;
--> statement-breakpoint
UPDATE outbound_messages SET category=CASE WHEN pg_temp.crm_email_purpose(template_key)='service' THEN 'service' ELSE 'marketing' END WHERE category='automation';
--> statement-breakpoint
UPDATE outbound_messages SET category='service' WHERE category='transactional';
--> statement-breakpoint
DROP FUNCTION pg_temp.crm_classify_action(jsonb,text,text);
--> statement-breakpoint
DROP FUNCTION pg_temp.crm_email_purpose(text);
