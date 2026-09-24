CREATE TABLE "connector_oauth_transactions" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"connector_key" text NOT NULL,
	"connector_installation_id" uuid NOT NULL,
	"verifier_envelope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_oauth_transactions" ADD CONSTRAINT "connector_oauth_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_oauth_transactions" ADD CONSTRAINT "connector_oauth_transactions_connector_installation_id_connector_installations_id_fk" FOREIGN KEY ("connector_installation_id") REFERENCES "public"."connector_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_oauth_transactions_expiry_idx" ON "connector_oauth_transactions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "connector_oauth_transactions_installation_idx" ON "connector_oauth_transactions" USING btree ("tenant_id","connector_installation_id");