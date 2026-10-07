CREATE TABLE "platform_billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload_hash" text NOT NULL,
	"outcome" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_billing_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"plan_key" text NOT NULL,
	"currency" text NOT NULL,
	"interval" text NOT NULL,
	"request_key" text NOT NULL,
	"url" text,
	"provider_reference" text,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_subscriptions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"plan_key" text NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"included_seats" integer NOT NULL,
	"capabilities" text[] NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"trial_end" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone,
	"past_due_at" timestamp with time zone,
	"grace_end" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_billing_events" ADD CONSTRAINT "platform_billing_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_billing_sessions" ADD CONSTRAINT "platform_billing_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_billing_events_event_ux" ON "platform_billing_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_billing_sessions_request_ux" ON "platform_billing_sessions" USING btree ("tenant_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_subscriptions_customer_ux" ON "platform_subscriptions" USING btree ("provider","provider_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_subscriptions_subscription_ux" ON "platform_subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "platform_subscriptions_status_idx" ON "platform_subscriptions" USING btree ("status");
--> statement-breakpoint
ALTER TABLE platform_subscriptions ADD CONSTRAINT platform_subscription_status_check CHECK (status IN ('trialing','active','past_due','read_only','canceled'));
--> statement-breakpoint
CREATE FUNCTION platform_billing_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Platform billing history is append-only'; END $$;
--> statement-breakpoint
CREATE TRIGGER platform_billing_history_immutable BEFORE UPDATE OR DELETE ON platform_billing_events FOR EACH ROW EXECUTE FUNCTION platform_billing_history_immutable();
--> statement-breakpoint
-- All domain writes (including worker and bearer API access) share this database guard.
-- Payment settlement exemptions are transaction-local AND restricted to ledger tables.
CREATE FUNCTION platform_business_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE business uuid; subscription record; purpose text; seats integer; subscribed boolean;
BEGIN
  business := (CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END ->> CASE WHEN TG_TABLE_NAME='tenants' THEN 'id' ELSE 'tenant_id' END)::uuid;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME<>'tenants' AND to_jsonb(OLD)->>'tenant_id' IS DISTINCT FROM to_jsonb(NEW)->>'tenant_id' THEN
    RAISE EXCEPTION 'Business ownership cannot be changed';
  END IF;
  SELECT * INTO subscription FROM platform_subscriptions WHERE tenant_id=business FOR SHARE;
  subscribed := FOUND;
  purpose := current_setting('crm.billing_payment_tenant',true);
  IF subscribed AND subscription.status IN ('read_only','canceled') THEN
    IF NOT (coalesce(purpose=business::text,false) AND TG_TABLE_NAME IN ('invoices','payments','payment_allocations','refunds','connector_installations','online_payment_accounts')) THEN
      RAISE EXCEPTION USING ERRCODE='P0402', MESSAGE='Workspace is read-only. Update Plan and billing. Viewing and export remain available.';
    END IF;
  END IF;
  IF TG_TABLE_NAME='memberships' AND TG_OP<>'DELETE' AND subscribed AND to_jsonb(NEW)->>'status' IN ('active','invited') THEN
    IF TG_OP='INSERT' OR to_jsonb(OLD)->>'status' NOT IN ('active','invited') THEN
      -- Lock the business rather than the membership rows so concurrent invites cannot overbook.
      PERFORM id FROM tenants WHERE id=business FOR UPDATE;
      SELECT count(*) INTO seats FROM memberships WHERE tenant_id=business AND status IN ('active','invited');
      IF seats >= subscription.included_seats THEN RAISE EXCEPTION USING ERRCODE='P0403', MESSAGE='Staff seat limit reached. Choose a larger plan or remove an unused seat.'; END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER platform_business_write_guard BEFORE UPDATE OR DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION platform_business_write_guard();
--> statement-breakpoint
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'
    AND table_name NOT IN ('platform_subscriptions','platform_billing_events','platform_billing_sessions',
      'online_payment_events','online_payment_sessions','domain_events','audit_events','activity_events','internal_notifications',
      'outbound_messages','communication_events','automation_runs','webhook_deliveries','webhook_events','platform_email_usage','platform_email_policies',
      'api_credentials','connector_oauth_transactions','sync_states','metric_snapshots','commercial_account_entries','commercial_usage_events',
      'usage_allowances','tenant_capability_grants','tenant_capability_settings')
  LOOP EXECUTE format('CREATE TRIGGER platform_business_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION platform_business_write_guard()', item.table_name); END LOOP;
END $$;
