ALTER TABLE "customer_change_requests" DROP CONSTRAINT "customer_change_requests_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_change_requests" DROP CONSTRAINT "customer_change_requests_service_location_id_service_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "completion_proofs" DROP CONSTRAINT "completion_proofs_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "completion_proofs" DROP CONSTRAINT "completion_proofs_completed_by_membership_id_memberships_id_fk";
--> statement-breakpoint
ALTER TABLE "completion_proofs" DROP CONSTRAINT "completion_proofs_signature_file_id_files_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_generation_ledger" DROP CONSTRAINT "recurring_generation_ledger_service_plan_id_service_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_generation_ledger" DROP CONSTRAINT "recurring_generation_ledger_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_membership_id_memberships_id_fk";
--> statement-breakpoint
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_shift_id_shifts_id_fk";
--> statement-breakpoint
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_allocations" DROP CONSTRAINT "credit_allocations_customer_credit_id_customer_credits_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_allocations" DROP CONSTRAINT "credit_allocations_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_memos" DROP CONSTRAINT "credit_memos_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_memos" DROP CONSTRAINT "credit_memos_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_payment_id_payments_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_tenant_customer_id_ux" ON "jobs" USING btree ("tenant_id","customer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_tenant_id_id_ux" ON "shifts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_tenant_id_id_ux" ON "time_entries" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_credits_tenant_id_id_ux" ON "customer_credits" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_credits_tenant_customer_id_ux" ON "customer_credits" USING btree ("tenant_id","customer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_customer_id_ux" ON "invoices" USING btree ("tenant_id","customer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rules_tenant_id_id_ux" ON "automation_rules" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_installations_tenant_id_id_ux" ON "connector_installations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_tenant_id_id_ux" ON "import_batches" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_tenant_id_id_ux" ON "outbound_messages" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_statuses_tenant_id_id_ux" ON "ticket_status_definitions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_types_tenant_id_id_ux" ON "ticket_type_definitions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_tenant_id_id_ux" ON "tickets" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_tenant_id_id_ux" ON "webhook_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_tenant_id_id_ux" ON "domain_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_agreements_tenant_id_id_ux" ON "franchise_agreements" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_forms_tenant_site_id_ux" ON "site_forms" USING btree ("tenant_id","site_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_tenant_id_id_ux" ON "sites" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_versions_tenant_id_id_ux" ON "terms_versions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_subscriptions_tenant_id_id_ux" ON "webhook_subscriptions" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "customer_assets" ADD CONSTRAINT "customer_assets_customer_location_fk" FOREIGN KEY ("tenant_id","customer_id","service_location_id") REFERENCES "public"."service_locations"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD CONSTRAINT "customer_change_requests_customer_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_change_requests" ADD CONSTRAINT "customer_change_requests_location_customer_fk" FOREIGN KEY ("tenant_id","customer_id","service_location_id") REFERENCES "public"."service_locations"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_job_tenant_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breaks" ADD CONSTRAINT "breaks_shift_tenant_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_proofs" ADD CONSTRAINT "completion_proofs_job_tenant_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_proofs" ADD CONSTRAINT "completion_proofs_member_tenant_fk" FOREIGN KEY ("tenant_id","completed_by_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_proofs" ADD CONSTRAINT "completion_proofs_file_tenant_fk" FOREIGN KEY ("tenant_id","signature_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_generation_ledger" ADD CONSTRAINT "recurring_ledger_plan_tenant_fk" FOREIGN KEY ("tenant_id","service_plan_id") REFERENCES "public"."service_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_generation_ledger" ADD CONSTRAINT "recurring_ledger_job_tenant_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_member_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_location_tenant_fk" FOREIGN KEY ("tenant_id","organization_location_id") REFERENCES "public"."organization_locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_approver_tenant_fk" FOREIGN KEY ("tenant_id","approved_by_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_member_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_shift_tenant_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_job_tenant_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_correction_tenant_fk" FOREIGN KEY ("tenant_id","correction_of_id") REFERENCES "public"."time_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_schedules" ADD CONSTRAINT "billing_schedules_plan_tenant_fk" FOREIGN KEY ("tenant_id","service_plan_id") REFERENCES "public"."service_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_credit_tenant_fk" FOREIGN KEY ("tenant_id","customer_credit_id") REFERENCES "public"."customer_credits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_invoice_tenant_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_customer_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_invoice_tenant_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_invoice_customer_fk" FOREIGN KEY ("tenant_id","customer_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_customer_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_tenant_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_customer_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_job_tenant_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_membership_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_payment_tenant_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_job_customer_fk" FOREIGN KEY ("tenant_id","customer_id","job_id") REFERENCES "public"."jobs"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_creator_tenant_fk" FOREIGN KEY ("tenant_id","created_by_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_tenant_fk" FOREIGN KEY ("tenant_id","automation_rule_id") REFERENCES "public"."automation_rules"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_event_tenant_fk" FOREIGN KEY ("tenant_id","triggering_event_id") REFERENCES "public"."domain_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_message_tenant_fk" FOREIGN KEY ("tenant_id","outbound_message_id") REFERENCES "public"."outbound_messages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_installations" ADD CONSTRAINT "connector_installations_organization_tenant_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_oauth_transactions" ADD CONSTRAINT "connector_oauth_transactions_installation_tenant_fk" FOREIGN KEY ("tenant_id","connector_installation_id") REFERENCES "public"."connector_installations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_resource_mappings" ADD CONSTRAINT "connector_mappings_installation_tenant_fk" FOREIGN KEY ("tenant_id","connector_installation_id") REFERENCES "public"."connector_installations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_customer_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_installation_tenant_fk" FOREIGN KEY ("tenant_id","connector_installation_id") REFERENCES "public"."connector_installations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_file_tenant_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_creator_tenant_fk" FOREIGN KEY ("tenant_id","created_by_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_tenant_fk" FOREIGN KEY ("tenant_id","import_batch_id") REFERENCES "public"."import_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_customer_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_customer_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_job_tenant_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_job_customer_fk" FOREIGN KEY ("tenant_id","customer_id","job_id") REFERENCES "public"."jobs"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_invoice_tenant_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_invoice_customer_fk" FOREIGN KEY ("tenant_id","customer_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_feedback" ADD CONSTRAINT "service_feedback_customer_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_feedback" ADD CONSTRAINT "service_feedback_job_tenant_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_feedback" ADD CONSTRAINT "service_feedback_job_customer_fk" FOREIGN KEY ("tenant_id","customer_id","job_id") REFERENCES "public"."jobs"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_feedback" ADD CONSTRAINT "service_feedback_member_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_feedback" ADD CONSTRAINT "service_feedback_ticket_tenant_fk" FOREIGN KEY ("tenant_id","resolved_ticket_id") REFERENCES "public"."tickets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_states" ADD CONSTRAINT "sync_states_installation_tenant_fk" FOREIGN KEY ("tenant_id","connector_installation_id") REFERENCES "public"."connector_installations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_tenant_fk" FOREIGN KEY ("tenant_id","ticket_id") REFERENCES "public"."tickets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_location_tenant_fk" FOREIGN KEY ("tenant_id","service_location_id") REFERENCES "public"."service_locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_location_customer_fk" FOREIGN KEY ("tenant_id","customer_id","service_location_id") REFERENCES "public"."service_locations"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_job_tenant_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_job_customer_fk" FOREIGN KEY ("tenant_id","customer_id","job_id") REFERENCES "public"."jobs"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_type_tenant_fk" FOREIGN KEY ("tenant_id","ticket_type_id") REFERENCES "public"."ticket_type_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_tenant_fk" FOREIGN KEY ("tenant_id","status_definition_id") REFERENCES "public"."ticket_status_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_tenant_fk" FOREIGN KEY ("tenant_id","assigned_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_installation_tenant_fk" FOREIGN KEY ("tenant_id","connector_installation_id") REFERENCES "public"."connector_installations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_credentials" ADD CONSTRAINT "api_credentials_creator_tenant_fk" FOREIGN KEY ("tenant_id","created_by_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_organization_tenant_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_location_tenant_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."organization_locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_location_organization_fk" FOREIGN KEY ("tenant_id","organization_id","location_id") REFERENCES "public"."organization_locations"("tenant_id","organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_site_tenant_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_agreements" ADD CONSTRAINT "franchise_agreements_parent_tenant_fk" FOREIGN KEY ("tenant_id","parent_organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_agreements" ADD CONSTRAINT "franchise_agreements_child_tenant_fk" FOREIGN KEY ("tenant_id","child_organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_notifications" ADD CONSTRAINT "internal_notifications_member_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_organization_tenant_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_location_tenant_fk" FOREIGN KEY ("tenant_id","organization_location_id") REFERENCES "public"."organization_locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_location_organization_fk" FOREIGN KEY ("tenant_id","organization_id","organization_location_id") REFERENCES "public"."organization_locations"("tenant_id","organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_rules" ADD CONSTRAINT "royalty_rules_agreement_tenant_fk" FOREIGN KEY ("tenant_id","franchise_agreement_id") REFERENCES "public"."franchise_agreements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_statements" ADD CONSTRAINT "royalty_statements_agreement_tenant_fk" FOREIGN KEY ("tenant_id","franchise_agreement_id") REFERENCES "public"."franchise_agreements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_contents" ADD CONSTRAINT "site_contents_site_tenant_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_forms" ADD CONSTRAINT "site_forms_site_tenant_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_submissions" ADD CONSTRAINT "site_submissions_site_tenant_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_submissions" ADD CONSTRAINT "site_submissions_form_tenant_fk" FOREIGN KEY ("tenant_id","site_id","site_form_id") REFERENCES "public"."site_forms"("tenant_id","site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_submissions" ADD CONSTRAINT "site_submissions_lead_tenant_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_submissions" ADD CONSTRAINT "site_submissions_customer_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_tenant_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_location_tenant_fk" FOREIGN KEY ("tenant_id","organization_location_id") REFERENCES "public"."organization_locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_location_organization_fk" FOREIGN KEY ("tenant_id","organization_id","organization_location_id") REFERENCES "public"."organization_locations"("tenant_id","organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_version_tenant_fk" FOREIGN KEY ("tenant_id","terms_version_id") REFERENCES "public"."terms_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_tenant_fk" FOREIGN KEY ("tenant_id","webhook_subscription_id") REFERENCES "public"."webhook_subscriptions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_tenant_fk" FOREIGN KEY ("tenant_id","domain_event_id") REFERENCES "public"."domain_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_creator_tenant_fk" FOREIGN KEY ("tenant_id","created_by_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
