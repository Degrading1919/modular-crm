CREATE TABLE "job_invoice_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_invoice_links" ADD CONSTRAINT "job_invoice_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_invoice_links" ADD CONSTRAINT "job_invoice_links_job_customer_fk" FOREIGN KEY ("tenant_id","customer_id","job_id") REFERENCES "public"."jobs"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_invoice_links" ADD CONSTRAINT "job_invoice_links_invoice_customer_fk" FOREIGN KEY ("tenant_id","customer_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_invoice_links_job_ux" ON "job_invoice_links" USING btree ("tenant_id","job_id");
--> statement-breakpoint
-- Existing visit invoices keep permanent billing ownership, even if their lines change.
INSERT INTO job_invoice_links (tenant_id, customer_id, job_id, invoice_id)
SELECT DISTINCT ON (ii.tenant_id, ii.job_id) ii.tenant_id, j.customer_id, ii.job_id, ii.invoice_id
FROM invoice_items ii JOIN jobs j ON j.tenant_id = ii.tenant_id AND j.id = ii.job_id
JOIN invoices i ON i.tenant_id = ii.tenant_id AND i.id = ii.invoice_id AND i.customer_id = j.customer_id
WHERE ii.job_id IS NOT NULL ORDER BY ii.tenant_id, ii.job_id, i.created_at, i.id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Earlier estimate conversions did not attach their downstream one-time job.
INSERT INTO job_invoice_links (tenant_id, customer_id, job_id, invoice_id)
SELECT DISTINCT ON (j.tenant_id, j.id) j.tenant_id, j.customer_id, j.id, i.id
FROM jobs j JOIN estimate_revisions r ON r.tenant_id = j.tenant_id AND r.id::text = j.price_snapshot->>'estimateRevisionId'
JOIN invoices i ON i.tenant_id = j.tenant_id AND i.customer_id = j.customer_id AND i.billing_snapshot->>'estimateId' = r.estimate_id::text
WHERE j.service_plan_id IS NULL ORDER BY j.tenant_id, j.id, i.created_at, i.id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE invoice_items ii SET job_id = l.job_id FROM job_invoice_links l
WHERE ii.tenant_id = l.tenant_id AND ii.invoice_id = l.invoice_id AND ii.job_id IS NULL
AND NOT EXISTS (SELECT 1 FROM job_invoice_links other WHERE other.tenant_id = l.tenant_id AND other.invoice_id = l.invoice_id AND other.job_id <> l.job_id);
--> statement-breakpoint
-- Historical recurring prices mean every visit. Add semantics, never reprice them.
UPDATE service_plans p SET pricing_snapshot = jsonb_set(p.pricing_snapshot, '{items}',
  (SELECT jsonb_agg(item || jsonb_build_object('charge', COALESCE(item->>'charge', 'every_visit')) ORDER BY ordinal)
   FROM jsonb_array_elements(p.pricing_snapshot->'items') WITH ORDINALITY AS lines(item, ordinal)))
WHERE jsonb_typeof(p.pricing_snapshot->'items') = 'array' AND jsonb_array_length(p.pricing_snapshot->'items') > 0;
--> statement-breakpoint
UPDATE service_plans p SET pricing_snapshot = jsonb_set(p.pricing_snapshot, '{priceVersions}',
  (SELECT jsonb_agg(version || jsonb_build_object('snapshot',
    CASE WHEN jsonb_typeof(version->'snapshot'->'items') = 'array' AND jsonb_array_length(version->'snapshot'->'items') > 0
    THEN jsonb_set(version->'snapshot', '{items}', (SELECT jsonb_agg(item || jsonb_build_object('charge', COALESCE(item->>'charge', 'every_visit')) ORDER BY item_order)
      FROM jsonb_array_elements(version->'snapshot'->'items') WITH ORDINALITY AS lines(item, item_order)))
    ELSE version->'snapshot' END) ORDER BY ordinal)
   FROM jsonb_array_elements(p.pricing_snapshot->'priceVersions') WITH ORDINALITY AS versions(version, ordinal)))
WHERE jsonb_typeof(p.pricing_snapshot->'priceVersions') = 'array' AND jsonb_array_length(p.pricing_snapshot->'priceVersions') > 0;
