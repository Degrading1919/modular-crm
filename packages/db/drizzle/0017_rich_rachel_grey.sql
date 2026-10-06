ALTER TABLE "estimate_approvals" ADD COLUMN "pricing_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
-- Preserve existing monetary columns, including any historical tax. Missing
-- single-total documents get one recorded line, never a newly calculated tax.
INSERT INTO invoice_items (tenant_id,invoice_id,description,quantity,unit_amount_minor,discount_minor,tax_minor,total_minor,metadata)
SELECT i.tenant_id,i.id,coalesce(i.billing_snapshot->>'description',i.invoice_number),1,i.subtotal_minor,i.discount_minor,i.tax_minor,i.total_minor,
  jsonb_build_object('taxable',false,'optional',false,'lineDiscountMinor',i.discount_minor)
FROM invoices i WHERE NOT EXISTS (SELECT 1 FROM invoice_items l WHERE l.tenant_id=i.tenant_id AND l.invoice_id=i.id);
--> statement-breakpoint
INSERT INTO estimate_items (tenant_id,estimate_revision_id,description,quantity,unit_amount_minor,discount_minor,tax_minor,total_minor,metadata)
SELECT r.tenant_id,r.id,coalesce(r.snapshot->>'title',r.estimate_id::text),1,r.subtotal_minor,r.discount_minor,r.tax_minor,r.total_minor,
  jsonb_build_object('taxable',false,'optional',false,'lineDiscountMinor',r.discount_minor)
FROM estimate_revisions r WHERE NOT EXISTS (SELECT 1 FROM estimate_items l WHERE l.tenant_id=r.tenant_id AND l.estimate_revision_id=r.id);
--> statement-breakpoint
UPDATE estimate_approvals a SET pricing_snapshot=jsonb_build_object(
  'version',1,'taxRateBasisPoints',0,'discount',jsonb_build_object('type','amount','value',0),
  'subtotalMinor',r.subtotal_minor,'discountMinor',r.discount_minor,'taxMinor',r.tax_minor,'totalMinor',r.total_minor,
  'items',(SELECT jsonb_agg(jsonb_build_object('description',l.description,'quantity',l.quantity::text,'unitAmountMinor',l.unit_amount_minor,
    'discountMinor',l.discount_minor,'documentDiscountMinor',0,'taxMinor',l.tax_minor,'totalMinor',l.total_minor,
    'subtotalMinor',l.total_minor+l.discount_minor-l.tax_minor,'sortOrder',l.sort_order,'serviceId',l.service_id,'taxable',false,'optional',false) ORDER BY l.sort_order,l.id)
    FROM estimate_items l WHERE l.tenant_id=r.tenant_id AND l.estimate_revision_id=r.id))
FROM estimate_revisions r WHERE a.tenant_id=r.tenant_id AND a.estimate_revision_id=r.id AND a.decision='approved';
