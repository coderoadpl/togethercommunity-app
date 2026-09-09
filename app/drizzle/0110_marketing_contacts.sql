CREATE TABLE "marketing_contact_import_rows" (
	"tenant_id" text NOT NULL,
	"import_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"row_hash" text NOT NULL,
	"normalized_email_hmac" text,
	"staged_payload" jsonb,
	"normalized_payload" jsonb,
	"status" text NOT NULL,
	"duplicate_of" integer,
	"contact_id" text,
	"consent_row_id" text,
	"suppression_id" text,
	"outcome" text,
	"errors" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"processed_at" text,
	CONSTRAINT "marketing_contact_import_rows_tenant_id_import_id_row_number_pk" PRIMARY KEY("tenant_id","import_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "marketing_contact_imports" (
	"raw_csv" text,
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text,
	"dataset_version" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"delimiter" text,
	"defaults" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"row_count" integer NOT NULL,
	"consent_definition_id" text,
	"definition_version" integer,
	"definition_hash" text,
	"validation_hash" text,
	"attestation_version" text,
	"attestation_text" text,
	"attestation_locale" text,
	"attestation_note" text,
	"attested_by" jsonb,
	"attested_at" text,
	"invalid_rows" text NOT NULL,
	"status" text NOT NULL,
	"result_counts" jsonb NOT NULL,
	"locked_by" text,
	"locked_until" text,
	"attempts" integer NOT NULL,
	"next_attempt_at" text NOT NULL,
	"last_error" text,
	"created_at" text NOT NULL,
	"started_at" text,
	"finished_at" text,
	"staged_data_purged_at" text,
	CONSTRAINT "marketing_contact_imports_row_count_check" CHECK ("marketing_contact_imports"."row_count" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "marketing_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"email_hmac" text NOT NULL,
	"display_name" text,
	"first_name" text,
	"last_name" text,
	"source" text DEFAULT 'import' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"member_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived_at" text,
	CONSTRAINT "marketing_contacts_normalized_email_check" CHECK ("marketing_contacts"."email" = lower(btrim("marketing_contacts"."email"))),
	CONSTRAINT "marketing_contacts_names_check" CHECK (length("marketing_contacts"."display_name") <= 200 AND length("marketing_contacts"."first_name") <= 200 AND length("marketing_contacts"."last_name") <= 200 AND length("marketing_contacts"."source") BETWEEN 1 AND 120),
	CONSTRAINT "marketing_contacts_tags_check" CHECK (jsonb_typeof("marketing_contacts"."tags") = 'array' AND jsonb_array_length("marketing_contacts"."tags") <= 50)
);
--> statement-breakpoint
CREATE TABLE "marketing_directory_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"import_id" text,
	"payload" jsonb NOT NULL,
	"occurred_at" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_list_memberships" (
	"tenant_id" text NOT NULL,
	"list_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" text NOT NULL,
	"removed_at" text,
	"import_id" text,
	CONSTRAINT "marketing_list_memberships_tenant_id_list_id_contact_id_pk" PRIMARY KEY("tenant_id","list_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"rule" jsonb,
	"revision" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived_at" text,
	CONSTRAINT "marketing_lists_rule_check" CHECK (("marketing_lists"."kind" = 'static' AND "marketing_lists"."rule" IS NULL) OR ("marketing_lists"."kind" = 'dynamic' AND "marketing_lists"."rule" IS NOT NULL AND "marketing_lists"."rule"->>'kind' IN ('tag', 'product_grant', 'consent_definition')))
);
--> statement-breakpoint
CREATE TABLE "marketing_member_sync_jobs" (
	"tenant_id" text NOT NULL,
	"member_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"next_attempt_at" text NOT NULL,
	"locked_by" text,
	"locked_until" text,
	"last_error" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "marketing_member_sync_jobs_tenant_id_member_id_pk" PRIMARY KEY("tenant_id","member_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contact_imports_tenant_id_uidx" ON "marketing_contact_imports" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contact_imports_idempotency_uidx" ON "marketing_contact_imports" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contacts_tenant_id_uidx" ON "marketing_contacts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contacts_tenant_email_uidx" ON "marketing_contacts" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contacts_tenant_hmac_uidx" ON "marketing_contacts" USING btree ("tenant_id","email_hmac");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contacts_tenant_member_uidx" ON "marketing_contacts" USING btree ("tenant_id","member_id") WHERE "marketing_contacts"."member_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_directory_events_sequence_uidx" ON "marketing_directory_events" USING btree ("tenant_id","subject_kind","subject_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_lists_tenant_id_uidx" ON "marketing_lists" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_lists_tenant_key_uidx" ON "marketing_lists" USING btree ("tenant_id","key");--> statement-breakpoint
ALTER TABLE "marketing_contact_import_rows" ADD CONSTRAINT "marketing_contact_import_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_contact_import_rows" ADD CONSTRAINT "marketing_import_row_batch_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."marketing_contact_imports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_contact_import_rows" ADD CONSTRAINT "marketing_import_row_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."marketing_contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_contact_imports" ADD CONSTRAINT "marketing_contact_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_tenant_id_member_id_members_tenant_id_id_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_directory_events" ADD CONSTRAINT "marketing_directory_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_list_memberships" ADD CONSTRAINT "marketing_list_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_list_memberships" ADD CONSTRAINT "marketing_membership_list_fk" FOREIGN KEY ("tenant_id","list_id") REFERENCES "public"."marketing_lists"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_list_memberships" ADD CONSTRAINT "marketing_membership_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."marketing_contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_list_memberships" ADD CONSTRAINT "marketing_membership_import_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."marketing_contact_imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_lists" ADD CONSTRAINT "marketing_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_member_sync_jobs" ADD CONSTRAINT "marketing_member_sync_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_member_sync_jobs" ADD CONSTRAINT "marketing_member_sync_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_contact_imports_work_idx" ON "marketing_contact_imports" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "marketing_contacts_page_idx" ON "marketing_contacts" USING btree ("tenant_id","archived_at","id");--> statement-breakpoint
CREATE INDEX "marketing_contacts_tags_idx" ON "marketing_contacts" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "marketing_memberships_list_idx" ON "marketing_list_memberships" USING btree ("tenant_id","list_id","removed_at","contact_id");--> statement-breakpoint
CREATE INDEX "marketing_memberships_contact_idx" ON "marketing_list_memberships" USING btree ("tenant_id","contact_id","removed_at","list_id");--> statement-breakpoint
CREATE INDEX "marketing_member_sync_work_idx" ON "marketing_member_sync_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE FUNCTION marketing_member_directory_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  address text;
  contact record;
  now_iso text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  FOR address IN SELECT DISTINCT value COLLATE "C" AS value FROM unnest(ARRAY[lower(btrim(NEW.email)), CASE WHEN TG_OP = 'UPDATE' THEN lower(btrim(OLD.email)) ELSE NULL END]) value WHERE value IS NOT NULL ORDER BY value COLLATE "C"
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id || ':' || address, 0));
  END LOOP;
  FOR contact IN SELECT * FROM marketing_contacts WHERE tenant_id = NEW.tenant_id AND member_id = NEW.id AND (NEW.deleted_at IS NOT NULL OR email <> lower(btrim(NEW.email))) FOR UPDATE
  LOOP
    UPDATE marketing_contacts SET member_id = NULL, updated_at = now_iso WHERE tenant_id = NEW.tenant_id AND id = contact.id;
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id || ':contact:' || contact.id, 1));
    INSERT INTO marketing_directory_events (id, tenant_id, subject_kind, subject_id, sequence, type, actor, import_id, payload, occurred_at, created_at)
    SELECT gen_random_uuid()::text, NEW.tenant_id, 'contact', contact.id, coalesce(max(sequence), 0) + 1, 'member_unlinked', 'member_projection', NULL, '{}'::jsonb, now_iso, now_iso FROM marketing_directory_events WHERE tenant_id = NEW.tenant_id AND subject_kind = 'contact' AND subject_id = contact.id;
  END LOOP;
  IF NEW.deleted_at IS NULL THEN
    FOR contact IN SELECT * FROM marketing_contacts WHERE tenant_id = NEW.tenant_id AND email = lower(btrim(NEW.email)) AND member_id IS NULL FOR UPDATE
    LOOP
      UPDATE marketing_contacts SET member_id = NEW.id, updated_at = now_iso WHERE tenant_id = NEW.tenant_id AND id = contact.id;
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id || ':contact:' || contact.id, 1));
      INSERT INTO marketing_directory_events (id, tenant_id, subject_kind, subject_id, sequence, type, actor, import_id, payload, occurred_at, created_at)
      SELECT gen_random_uuid()::text, NEW.tenant_id, 'contact', contact.id, coalesce(max(sequence), 0) + 1, 'member_linked', 'member_projection', NULL, '{}'::jsonb, now_iso, now_iso FROM marketing_directory_events WHERE tenant_id = NEW.tenant_id AND subject_kind = 'contact' AND subject_id = contact.id;
    END LOOP;
  END IF;
  INSERT INTO marketing_member_sync_jobs (tenant_id, member_id, revision, status, attempts, next_attempt_at, updated_at)
  VALUES (NEW.tenant_id, NEW.id, 1, CASE WHEN NEW.deleted_at IS NULL THEN 'pending' ELSE 'completed' END, 0, now_iso, now_iso)
  ON CONFLICT (tenant_id, member_id) DO UPDATE SET revision = marketing_member_sync_jobs.revision + 1, status = EXCLUDED.status, attempts = 0, next_attempt_at = now_iso, locked_by = NULL, locked_until = NULL, last_error = NULL, updated_at = now_iso;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER marketing_member_directory_trigger AFTER INSERT OR UPDATE OF email, deleted_at ON members FOR EACH ROW EXECUTE FUNCTION marketing_member_directory_changed();
--> statement-breakpoint
INSERT INTO marketing_member_sync_jobs (tenant_id, member_id, revision, status, attempts, next_attempt_at, updated_at)
SELECT tenant_id, id, 1, 'pending', 0, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM members WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX "marketing_import_rows_pending_idx" ON "marketing_contact_import_rows" USING btree ("tenant_id","import_id","row_number") WHERE "marketing_contact_import_rows"."processed_at" IS NULL;
