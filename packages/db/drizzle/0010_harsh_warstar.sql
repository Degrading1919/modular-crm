ALTER TABLE "payments" ADD COLUMN "recorded_method" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_method_valid" CHECK ("payments"."recorded_method" is null or "payments"."recorded_method" in ('cash', 'check', 'card_external', 'other', 'test'));