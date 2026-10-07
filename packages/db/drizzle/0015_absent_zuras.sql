CREATE TABLE "account_email_usage" (
	"recipient_hash" text PRIMARY KEY NOT NULL,
	"hour_start" timestamp with time zone NOT NULL,
	"hourly_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_email_policies" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"hourly" integer NOT NULL,
	"daily" integer NOT NULL,
	"first_week_hourly" integer NOT NULL,
	"first_week_daily" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_email_policies" ADD CONSTRAINT "platform_email_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;