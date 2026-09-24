CREATE TABLE "capability_feature_dependencies" (
	"feature_id" uuid NOT NULL,
	"depends_on_feature_id" uuid NOT NULL,
	"dependency_type" text DEFAULT 'requires' NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "capability_feature_dependencies_feature_id_depends_on_feature_id_dependency_type_pk" PRIMARY KEY("feature_id","depends_on_feature_id","dependency_type"),
	CONSTRAINT "capability_feature_dependencies_distinct_ck" CHECK ("capability_feature_dependencies"."feature_id" <> "capability_feature_dependencies"."depends_on_feature_id"),
	CONSTRAINT "capability_feature_dependencies_type_nonempty_ck" CHECK (length(btrim("capability_feature_dependencies"."dependency_type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "capability_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"availability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "capability_features_key_nonempty_ck" CHECK (length(btrim("capability_features"."key")) > 0),
	CONSTRAINT "capability_features_name_nonempty_ck" CHECK (length(btrim("capability_features"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "capability_module_dependencies" (
	"module_id" uuid NOT NULL,
	"depends_on_module_id" uuid NOT NULL,
	"dependency_type" text DEFAULT 'requires' NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "capability_module_dependencies_module_id_depends_on_module_id_dependency_type_pk" PRIMARY KEY("module_id","depends_on_module_id","dependency_type"),
	CONSTRAINT "capability_module_dependencies_distinct_ck" CHECK ("capability_module_dependencies"."module_id" <> "capability_module_dependencies"."depends_on_module_id"),
	CONSTRAINT "capability_module_dependencies_type_nonempty_ck" CHECK (length(btrim("capability_module_dependencies"."dependency_type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "capability_module_features" (
	"module_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	CONSTRAINT "capability_module_features_module_id_feature_id_pk" PRIMARY KEY("module_id","feature_id")
);
--> statement-breakpoint
CREATE TABLE "capability_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"availability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compatibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "capability_modules_key_nonempty_ck" CHECK (length(btrim("capability_modules"."key")) > 0),
	CONSTRAINT "capability_modules_name_nonempty_ck" CHECK (length(btrim("capability_modules"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "commercial_account_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commercial_account_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"source" text NOT NULL,
	"source_reference" text,
	"quantity" numeric(20, 6),
	"unit_key" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "commercial_account_entries_type_nonempty_ck" CHECK (length(btrim("commercial_account_entries"."entry_type")) > 0),
	CONSTRAINT "commercial_account_entries_source_nonempty_ck" CHECK (length(btrim("commercial_account_entries"."source")) > 0),
	CONSTRAINT "commercial_account_entries_interval_ck" CHECK ("commercial_account_entries"."effective_until" is null or "commercial_account_entries"."effective_until" > "commercial_account_entries"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "commercial_account_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commercial_account_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_reference" text,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "commercial_account_promotions_source_nonempty_ck" CHECK (length(btrim("commercial_account_promotions"."source")) > 0),
	CONSTRAINT "commercial_account_promotions_status_nonempty_ck" CHECK (length(btrim("commercial_account_promotions"."status")) > 0),
	CONSTRAINT "commercial_account_promotions_interval_ck" CHECK ("commercial_account_promotions"."effective_until" is null or "commercial_account_promotions"."effective_until" > "commercial_account_promotions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "commercial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"account_reference" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "commercial_accounts_status_nonempty_ck" CHECK (length(btrim("commercial_accounts"."status")) > 0)
);
--> statement-breakpoint
CREATE TABLE "commercial_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"availability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eligibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"benefit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "commercial_promotions_key_nonempty_ck" CHECK (length(btrim("commercial_promotions"."key")) > 0),
	CONSTRAINT "commercial_promotions_name_nonempty_ck" CHECK (length(btrim("commercial_promotions"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "commercial_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commercial_account_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"source" text NOT NULL,
	"source_reference" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "commercial_usage_events_idempotency_nonempty_ck" CHECK (length(btrim("commercial_usage_events"."idempotency_key")) > 0),
	CONSTRAINT "commercial_usage_events_source_nonempty_ck" CHECK (length(btrim("commercial_usage_events"."source")) > 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_capability_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_reference" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"grant_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "tenant_capability_grants_source_nonempty_ck" CHECK (length(btrim("tenant_capability_grants"."source")) > 0),
	CONSTRAINT "tenant_capability_grants_interval_ck" CHECK ("tenant_capability_grants"."effective_until" is null or "tenant_capability_grants"."effective_until" > "tenant_capability_grants"."effective_from"),
	CONSTRAINT "tenant_capability_grants_revocation_ck" CHECK ("tenant_capability_grants"."revoked_at" is null or "tenant_capability_grants"."revoked_at" >= "tenant_capability_grants"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "tenant_capability_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ui_prominence" text DEFAULT 'standard' NOT NULL,
	CONSTRAINT "tenant_capability_settings_prominence_nonempty_ck" CHECK (length(btrim("tenant_capability_settings"."ui_prominence")) > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commercial_account_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"period_definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"source_reference" text,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "usage_allowances_quantity_nonnegative_ck" CHECK ("usage_allowances"."quantity" >= 0),
	CONSTRAINT "usage_allowances_source_nonempty_ck" CHECK (length(btrim("usage_allowances"."source")) > 0),
	CONSTRAINT "usage_allowances_interval_ck" CHECK ("usage_allowances"."effective_until" is null or "usage_allowances"."effective_until" > "usage_allowances"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "usage_meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit_key" text NOT NULL,
	"aggregation" text NOT NULL,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"availability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "usage_meters_key_nonempty_ck" CHECK (length(btrim("usage_meters"."key")) > 0),
	CONSTRAINT "usage_meters_name_nonempty_ck" CHECK (length(btrim("usage_meters"."name")) > 0),
	CONSTRAINT "usage_meters_unit_nonempty_ck" CHECK (length(btrim("usage_meters"."unit_key")) > 0),
	CONSTRAINT "usage_meters_aggregation_nonempty_ck" CHECK (length(btrim("usage_meters"."aggregation")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_accounts_tenant_id_id_ux" ON "commercial_accounts" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "capability_feature_dependencies" ADD CONSTRAINT "capability_feature_dependencies_feature_id_capability_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."capability_features"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_feature_dependencies" ADD CONSTRAINT "capability_feature_dependencies_depends_on_feature_id_capability_features_id_fk" FOREIGN KEY ("depends_on_feature_id") REFERENCES "public"."capability_features"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_module_dependencies" ADD CONSTRAINT "capability_module_dependencies_module_id_capability_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."capability_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_module_dependencies" ADD CONSTRAINT "capability_module_dependencies_depends_on_module_id_capability_modules_id_fk" FOREIGN KEY ("depends_on_module_id") REFERENCES "public"."capability_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_module_features" ADD CONSTRAINT "capability_module_features_module_id_capability_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."capability_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_module_features" ADD CONSTRAINT "capability_module_features_feature_id_capability_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."capability_features"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_account_entries" ADD CONSTRAINT "commercial_account_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_account_entries" ADD CONSTRAINT "commercial_account_entries_account_tenant_fk" FOREIGN KEY ("tenant_id","commercial_account_id") REFERENCES "public"."commercial_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_account_promotions" ADD CONSTRAINT "commercial_account_promotions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_account_promotions" ADD CONSTRAINT "commercial_account_promotions_promotion_id_commercial_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."commercial_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_account_promotions" ADD CONSTRAINT "commercial_account_promotions_account_tenant_fk" FOREIGN KEY ("tenant_id","commercial_account_id") REFERENCES "public"."commercial_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_accounts" ADD CONSTRAINT "commercial_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_usage_events" ADD CONSTRAINT "commercial_usage_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_usage_events" ADD CONSTRAINT "commercial_usage_events_meter_id_usage_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."usage_meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_usage_events" ADD CONSTRAINT "commercial_usage_events_account_tenant_fk" FOREIGN KEY ("tenant_id","commercial_account_id") REFERENCES "public"."commercial_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_capability_grants" ADD CONSTRAINT "tenant_capability_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_capability_grants" ADD CONSTRAINT "tenant_capability_grants_module_id_capability_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."capability_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_capability_settings" ADD CONSTRAINT "tenant_capability_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_capability_settings" ADD CONSTRAINT "tenant_capability_settings_module_id_capability_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."capability_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_allowances" ADD CONSTRAINT "usage_allowances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_allowances" ADD CONSTRAINT "usage_allowances_meter_id_usage_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."usage_meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_allowances" ADD CONSTRAINT "usage_allowances_account_tenant_fk" FOREIGN KEY ("tenant_id","commercial_account_id") REFERENCES "public"."commercial_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capability_feature_dependencies_target_idx" ON "capability_feature_dependencies" USING btree ("depends_on_feature_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_features_key_ux" ON "capability_features" USING btree ("key");--> statement-breakpoint
CREATE INDEX "capability_features_state_idx" ON "capability_features" USING btree ("lifecycle_state");--> statement-breakpoint
CREATE INDEX "capability_module_dependencies_target_idx" ON "capability_module_dependencies" USING btree ("depends_on_module_id");--> statement-breakpoint
CREATE INDEX "capability_module_features_feature_idx" ON "capability_module_features" USING btree ("feature_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_modules_key_ux" ON "capability_modules" USING btree ("key");--> statement-breakpoint
CREATE INDEX "capability_modules_state_idx" ON "capability_modules" USING btree ("lifecycle_state");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_account_entries_tenant_id_id_ux" ON "commercial_account_entries" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "commercial_account_entries_account_time_idx" ON "commercial_account_entries" USING btree ("tenant_id","commercial_account_id","effective_from");--> statement-breakpoint
CREATE INDEX "commercial_account_entries_type_idx" ON "commercial_account_entries" USING btree ("tenant_id","entry_type","effective_from");--> statement-breakpoint
CREATE INDEX "commercial_account_promotions_effective_idx" ON "commercial_account_promotions" USING btree ("tenant_id","commercial_account_id","effective_from","effective_until");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_accounts_tenant_ux" ON "commercial_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_promotions_key_ux" ON "commercial_promotions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "commercial_promotions_state_idx" ON "commercial_promotions" USING btree ("lifecycle_state");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_usage_events_idempotency_ux" ON "commercial_usage_events" USING btree ("tenant_id","commercial_account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "commercial_usage_events_meter_time_idx" ON "commercial_usage_events" USING btree ("tenant_id","meter_id","occurred_at");--> statement-breakpoint
CREATE INDEX "tenant_capability_grants_effective_idx" ON "tenant_capability_grants" USING btree ("tenant_id","module_id","effective_from","effective_until");--> statement-breakpoint
CREATE INDEX "tenant_capability_grants_source_idx" ON "tenant_capability_grants" USING btree ("tenant_id","source","source_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_capability_settings_module_ux" ON "tenant_capability_settings" USING btree ("tenant_id","module_id");--> statement-breakpoint
CREATE INDEX "tenant_capability_settings_enabled_idx" ON "tenant_capability_settings" USING btree ("tenant_id","enabled");--> statement-breakpoint
CREATE INDEX "usage_allowances_effective_idx" ON "usage_allowances" USING btree ("tenant_id","meter_id","effective_from","effective_until");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_meters_key_ux" ON "usage_meters" USING btree ("key");--> statement-breakpoint
CREATE INDEX "usage_meters_state_idx" ON "usage_meters" USING btree ("lifecycle_state");
