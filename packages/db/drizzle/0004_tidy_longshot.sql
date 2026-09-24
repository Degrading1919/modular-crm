CREATE UNIQUE INDEX "estimate_revisions_tenant_estimate_id_ux" ON "estimate_revisions" USING btree ("tenant_id","estimate_id","id");--> statement-breakpoint
CREATE TABLE "secure_estimate_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"estimate_revision_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"allowed_actions" text[] DEFAULT ARRAY['approve', 'decline']::text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_action" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "secure_estimate_tokens_actions_ck" CHECK ("secure_estimate_tokens"."allowed_actions" <@ ARRAY['approve', 'decline']::text[] AND cardinality("secure_estimate_tokens"."allowed_actions") > 0),
	CONSTRAINT "secure_estimate_tokens_consumed_ck" CHECK (("secure_estimate_tokens"."consumed_at" IS NULL AND "secure_estimate_tokens"."consumed_action" IS NULL) OR ("secure_estimate_tokens"."consumed_at" IS NOT NULL AND "secure_estimate_tokens"."consumed_action" = ANY("secure_estimate_tokens"."allowed_actions")))
);
--> statement-breakpoint
ALTER TABLE "secure_estimate_tokens" ADD CONSTRAINT "secure_estimate_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secure_estimate_tokens" ADD CONSTRAINT "secure_estimate_tokens_estimate_tenant_fk" FOREIGN KEY ("tenant_id","estimate_id") REFERENCES "public"."estimates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secure_estimate_tokens" ADD CONSTRAINT "secure_estimate_tokens_revision_tenant_fk" FOREIGN KEY ("tenant_id","estimate_id","estimate_revision_id") REFERENCES "public"."estimate_revisions"("tenant_id","estimate_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secure_estimate_tokens_hash_ux" ON "secure_estimate_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "secure_estimate_tokens_tenant_estimate_id_ux" ON "secure_estimate_tokens" USING btree ("tenant_id","estimate_id","id");--> statement-breakpoint
CREATE INDEX "secure_estimate_tokens_estimate_idx" ON "secure_estimate_tokens" USING btree ("tenant_id","estimate_id","expires_at");--> statement-breakpoint
ALTER TABLE "estimate_approvals" ADD CONSTRAINT "estimate_approvals_secure_token_fk" FOREIGN KEY ("tenant_id","estimate_id","secure_token_id") REFERENCES "public"."secure_estimate_tokens"("tenant_id","estimate_id","id") ON DELETE no action ON UPDATE no action;
