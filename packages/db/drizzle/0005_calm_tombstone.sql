CREATE TABLE "field_operation_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"client_operation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"request_hash" text NOT NULL,
	"result_kind" text,
	"result_entity_id" uuid,
	"result_state" text,
	"response_status" integer DEFAULT 200 NOT NULL,
	"device_timestamp" timestamp with time zone,
	"server_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"anomaly_class" text
);
--> statement-breakpoint
ALTER TABLE "field_operation_receipts" ADD CONSTRAINT "field_operation_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_operation_receipts_actor_operation_ux" ON "field_operation_receipts" USING btree ("tenant_id","actor_id","client_operation_id");--> statement-breakpoint
CREATE INDEX "field_operation_receipts_received_idx" ON "field_operation_receipts" USING btree ("tenant_id","server_received_at");