-- Internal DNS/HTTPS projection is intentionally exempt from the billing business
-- guard; owner mutations of domains remain guarded. Periodic safety checks must
-- revoke serving even when the workspace is read-only.
CREATE UNIQUE INDEX "domains_tenant_id_id_ux" ON "domains" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE TABLE "website_domain_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"state" text DEFAULT 'waiting_dns' NOT NULL,
	"problem" text,
	"ownership_verified" boolean DEFAULT false NOT NULL,
	"routing_verified" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edge_reference" text,
	"mock_records" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "website_domain_checks" ADD CONSTRAINT "website_domain_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_domain_checks" ADD CONSTRAINT "website_domain_checks_domain_tenant_fk" FOREIGN KEY ("tenant_id","domain_id") REFERENCES "public"."domains"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "website_domain_checks_domain_ux" ON "website_domain_checks" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "website_domain_checks_due_idx" ON "website_domain_checks" USING btree ("next_check_at");--> statement-breakpoint
INSERT INTO "website_domain_checks" ("tenant_id", "domain_id")
SELECT "tenant_id", "id" FROM "domains" WHERE "domain_type"='custom';
