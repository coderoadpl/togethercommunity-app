CREATE TABLE "campaign_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text,
	"source" text NOT NULL,
	"member_id" text,
	"email" text NOT NULL,
	"consent_row_id" text NOT NULL,
	"unsubscribe_token_id" text,
	"status" text NOT NULL,
	"skip_reason" text,
	"ses_message_id" text,
	"delivery_status" text,
	"delivery_occurred_at" timestamp with time zone,
	"idempotency_source" text,
	"rendered_body_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"body_source" text NOT NULL,
	"layout_id" text,
	"consent_definition_id" text NOT NULL,
	"audience_filter" jsonb,
	"status" text NOT NULL,
	"send_at" timestamp with time zone,
	"snapshot_max_member_id" text,
	"cursor_member_id" text,
	"to_send" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"error_count" integer DEFAULT 0 NOT NULL,
	"paused_reason" text,
	"audience_name_snapshot" text,
	"consent_label_snapshot" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_confirmation_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"token" text NOT NULL,
	"marketing_consent_row_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "consent_definition_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"definition_id" text NOT NULL,
	"version" integer NOT NULL,
	"label" text NOT NULL,
	"document_version_ref" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "consent_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"double_opt_in" boolean DEFAULT true NOT NULL,
	"document_ref" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"member_id" text,
	"email" text NOT NULL,
	"definition_id" text NOT NULL,
	"definition_version" integer NOT NULL,
	"wording_snapshot" text NOT NULL,
	"document_ref_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"previous_id" text,
	"source" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"request_method" text NOT NULL,
	"request_path" text NOT NULL,
	"request_hash" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text,
	"email_hmac" text NOT NULL,
	"reason" text NOT NULL,
	"source_ref" text,
	"meta" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" text
);
--> statement-breakpoint
CREATE TABLE "tenant_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "tenant_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_ses_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text NOT NULL,
	"identity" text NOT NULL,
	"identity_verified_at" timestamp with time zone,
	"configuration_set" text,
	"sns_topic_arn" text,
	"webhook_token" text NOT NULL,
	"quota_rate_per_sec" double precision DEFAULT 0 NOT NULL,
	"quota_daily" integer DEFAULT 0 NOT NULL,
	"quota_refreshed_at" timestamp with time zone,
	"in_sandbox" boolean DEFAULT true NOT NULL,
	"webhook_verified_at" timestamp with time zone,
	"footer_legal_name" text DEFAULT '' NOT NULL,
	"footer_address" text DEFAULT '' NOT NULL,
	"broadcasts_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unsubscribe_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"token" text NOT NULL,
	"email" text NOT NULL,
	"member_id" text,
	"campaign_send_id" text,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_consent_row_id_marketing_consents_id_fk" FOREIGN KEY ("consent_row_id") REFERENCES "public"."marketing_consents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_consent_definition_id_consent_definitions_id_fk" FOREIGN KEY ("consent_definition_id") REFERENCES "public"."consent_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_confirmation_tokens" ADD CONSTRAINT "consent_confirmation_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_confirmation_tokens" ADD CONSTRAINT "consent_confirmation_tokens_marketing_consent_row_id_marketing_consents_id_fk" FOREIGN KEY ("marketing_consent_row_id") REFERENCES "public"."marketing_consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_definition_versions" ADD CONSTRAINT "consent_definition_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_definition_versions" ADD CONSTRAINT "consent_definition_versions_definition_id_consent_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."consent_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_definitions" ADD CONSTRAINT "consent_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_consents" ADD CONSTRAINT "marketing_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_consents" ADD CONSTRAINT "marketing_consents_definition_id_consent_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."consent_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_idempotency_keys" ADD CONSTRAINT "marketing_idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_document_versions" ADD CONSTRAINT "tenant_document_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_document_versions" ADD CONSTRAINT "tenant_document_versions_document_id_tenant_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."tenant_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_documents" ADD CONSTRAINT "tenant_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_ses_settings" ADD CONSTRAINT "tenant_ses_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_campaign_send_id_campaign_sends_id_fk" FOREIGN KEY ("campaign_send_id") REFERENCES "public"."campaign_sends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_sends_tenant_campaign_status_idx" ON "campaign_sends" USING btree ("tenant_id","campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sends_ses_message_id_uidx" ON "campaign_sends" USING btree ("ses_message_id") WHERE "campaign_sends"."ses_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sends_tenant_campaign_email_uidx" ON "campaign_sends" USING btree ("tenant_id","campaign_id","email") WHERE "campaign_sends"."campaign_id" is not null;--> statement-breakpoint
CREATE INDEX "campaigns_tenant_status_send_at_idx" ON "campaigns" USING btree ("tenant_id","status","send_at");--> statement-breakpoint
CREATE INDEX "campaigns_lease_idx" ON "campaigns" USING btree ("status","locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_confirmation_tokens_token_uidx" ON "consent_confirmation_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "consent_confirmation_tokens_expiry_idx" ON "consent_confirmation_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_definition_versions_tenant_definition_version_uidx" ON "consent_definition_versions" USING btree ("tenant_id","definition_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_definitions_tenant_key_uidx" ON "consent_definitions" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "marketing_consents_tenant_email_definition_occurred_idx" ON "marketing_consents" USING btree ("tenant_id","email","definition_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_idempotency_keys_tenant_key_uidx" ON "marketing_idempotency_keys" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "marketing_idempotency_keys_expiry_idx" ON "marketing_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_tenant_email_hmac_active_uidx" ON "suppressions" USING btree ("tenant_id","email_hmac") WHERE "suppressions"."lifted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_document_versions_tenant_document_version_uidx" ON "tenant_document_versions" USING btree ("tenant_id","document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_documents_tenant_slug_uidx" ON "tenant_documents" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_ses_settings_webhook_token_uidx" ON "tenant_ses_settings" USING btree ("webhook_token");--> statement-breakpoint
CREATE UNIQUE INDEX "unsubscribe_tokens_token_uidx" ON "unsubscribe_tokens" USING btree ("token");
