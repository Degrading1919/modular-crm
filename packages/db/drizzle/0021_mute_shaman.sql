ALTER TABLE "automation_runs" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "send_guard" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "request_id" uuid;--> statement-breakpoint
-- Offer the new recipes as drafts to existing pack tenants; preserve all overrides,
-- archived choices and activation cutoffs. No historical event is replayed.
INSERT INTO automation_rules (tenant_id, name, description, source, source_key, status, trigger_config, actions)
SELECT tenant.id, recipe.name, recipe.description, 'industry_pack', recipe.source_key, 'draft', recipe.trigger_config::jsonb, recipe.actions::jsonb
FROM tenants AS tenant
CROSS JOIN (VALUES
  ('quote-follow-up', 'Follow up on unanswered quotes', 'After 7 days, remind customers whose quote is still unanswered. Change the waiting period before turning this on.',
   '{"event":"estimate.sent"}',
   '[{"actionType":"send_email","purpose":"marketing","delay":{"afterEventMinutes":10080},"configuration":{"templateKey":"quote-follow-up","subject":"Would you like to go ahead with your quote?","body":"Your quote is ready to review. Open the quote link we sent you to accept it or ask us a question."}}]'),
  ('visit-review-request', 'Ask for a review after a completed visit', 'The day after a visit, invite customers to share feedback in their customer portal.',
   '{"event":"job.completed","filters":{"field":"job.status","operator":"equals","value":"completed"}}',
   '[{"actionType":"send_email","purpose":"marketing","delay":{"afterEventMinutes":1440},"configuration":{"templateKey":"visit-review-request","subject":"How was your visit?","body":"We would love to hear how your visit went. Please open your customer portal and leave a review on the completed visit."}}]')
) AS recipe(source_key, name, description, trigger_config, actions)
WHERE tenant.industry_pack_key = 'pet-waste-removal'
AND NOT EXISTS (SELECT 1 FROM automation_rules existing WHERE existing.tenant_id = tenant.id AND existing.source_key = recipe.source_key);
