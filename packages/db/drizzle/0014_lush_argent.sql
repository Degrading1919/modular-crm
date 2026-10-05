ALTER TABLE "online_payment_accounts" DROP CONSTRAINT "online_payment_accounts_installation_id_connector_installations_id_fk";
--> statement-breakpoint
ALTER TABLE "online_payment_accounts" ADD CONSTRAINT "online_accounts_installation_tenant_fk" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."connector_installations"("tenant_id","id") ON DELETE no action ON UPDATE no action;