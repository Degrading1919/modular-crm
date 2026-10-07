CREATE TABLE "online_payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_hash" text,
	"allow_partial" boolean DEFAULT false NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"details_needed" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_payment_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"client_key" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"provider_reference" text,
	"payment_reference" text,
	"url" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"failure_message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_sessions_positive_amount" CHECK ("online_payment_sessions"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_recorded_method_valid";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "fee_minor" bigint;--> statement-breakpoint
ALTER TABLE "online_payment_accounts" ADD CONSTRAINT "online_payment_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_accounts" ADD CONSTRAINT "online_payment_accounts_installation_id_connector_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."connector_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_accounts" ADD CONSTRAINT "online_accounts_organization_tenant_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "online_accounts_tenant_id_id_ux" ON "online_payment_accounts" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "online_payment_events" ADD CONSTRAINT "online_payment_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_events" ADD CONSTRAINT "online_events_account_tenant_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."online_payment_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_sessions" ADD CONSTRAINT "online_payment_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_sessions" ADD CONSTRAINT "online_sessions_invoice_tenant_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_sessions" ADD CONSTRAINT "online_sessions_account_tenant_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."online_payment_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "online_accounts_branch_ux" ON "online_payment_accounts" USING btree ("tenant_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "online_accounts_provider_hash_ux" ON "online_payment_accounts" USING btree ("provider","account_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "online_events_provider_id_ux" ON "online_payment_events" USING btree ("account_id","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "online_sessions_client_key_ux" ON "online_payment_sessions" USING btree ("tenant_id","invoice_id","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "online_sessions_provider_ux" ON "online_payment_sessions" USING btree ("account_id","provider_reference");--> statement-breakpoint
CREATE INDEX "online_sessions_invoice_idx" ON "online_payment_sessions" USING btree ("tenant_id","invoice_id","status");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_method_valid" CHECK ("payments"."recorded_method" is null or "payments"."recorded_method" in ('cash', 'check', 'card_external', 'card', 'other', 'test'));
