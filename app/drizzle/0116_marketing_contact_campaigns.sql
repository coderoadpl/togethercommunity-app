CREATE UNIQUE INDEX "consent_definitions_tenant_id_uidx" ON "consent_definitions" ("tenant_id", "id");
--> statement-breakpoint
CREATE TABLE "marketing_campaign_audience_contacts" (
	"tenant_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"email" text NOT NULL,
	"email_hmac" text NOT NULL,
	"member_id_snapshot" text,
	"display_name_snapshot" text,
	"first_name_snapshot" text,
	"consent_row_id" text,
	"eligibility_at_snapshot" boolean NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "marketing_campaign_audience_contacts_tenant_id_snapshot_id_contact_id_pk" PRIMARY KEY("tenant_id","snapshot_id","contact_id")
);--> statement-breakpoint
CREATE TABLE "marketing_campaign_audience_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"revision" integer NOT NULL,
	"audience_json" jsonb NOT NULL,
	"list_revision_snapshots" jsonb NOT NULL,
	"consent_definition_id" text NOT NULL,
	"definition_version" integer NOT NULL,
	"candidate_count" integer NOT NULL,
	"eligible_count" integer NOT NULL,
	"skipped_counts" jsonb NOT NULL,
	"max_contact_id" text,
	"created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD COLUMN "contact_id" text;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD COLUMN "audience_snapshot_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "audience_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "audience" jsonb;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "audience_snapshot_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "snapshot_max_contact_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cursor_contact_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "candidate_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "skipped" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_audience_contacts_email_uidx" ON "marketing_campaign_audience_contacts" USING btree ("tenant_id","snapshot_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_audience_snapshots_tenant_id_uidx" ON "marketing_campaign_audience_snapshots" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_audience_snapshots_revision_uidx" ON "marketing_campaign_audience_snapshots" USING btree ("tenant_id","campaign_id","revision");--> statement-breakpoint
CREATE INDEX "campaign_sends_contact_journal_idx" ON "campaign_sends" USING btree ("tenant_id","contact_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sends_contact_uidx" ON "campaign_sends" USING btree ("tenant_id","campaign_id","contact_id") WHERE "campaign_sends"."contact_id" is not null and "campaign_sends"."source" = 'broadcast';--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_tenant_id_uidx" ON "campaigns" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "marketing_campaign_audience_contacts" ADD CONSTRAINT "marketing_campaign_audience_contacts_tenant_id_snapshot_id_marketing_campaign_audience_snapshots_tenant_id_id_fk" FOREIGN KEY ("tenant_id","snapshot_id") REFERENCES "public"."marketing_campaign_audience_snapshots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_audience_contacts" ADD CONSTRAINT "marketing_campaign_audience_contacts_tenant_id_contact_id_marketing_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."marketing_contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_audience_snapshots" ADD CONSTRAINT "marketing_campaign_audience_snapshots_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_audience_snapshots" ADD CONSTRAINT "marketing_campaign_audience_snapshots_tenant_id_consent_definition_id_consent_definitions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","consent_definition_id") REFERENCES "public"."consent_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."marketing_contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_tenant_snapshot_fk" FOREIGN KEY ("tenant_id","audience_snapshot_id") REFERENCES "public"."marketing_campaign_audience_snapshots"("tenant_id","id") ON DELETE no action ON UPDATE no action;
