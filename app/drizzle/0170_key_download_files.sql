CREATE TABLE "change_proposal_download_files" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "id" text NOT NULL,
  "api_key_id" text NOT NULL,
  "file_name" text NOT NULL CONSTRAINT "change_proposal_download_files_file_name_check" CHECK (char_length("file_name") BETWEEN 1 AND 255),
  "content_type" text NOT NULL CONSTRAINT "change_proposal_download_files_content_type_check" CHECK ("content_type" IN ('application/pdf', 'application/epub+zip', 'application/zip', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'image/png', 'image/jpeg')),
  "size_bytes" integer NOT NULL CONSTRAINT "change_proposal_download_files_size_check" CHECK ("size_bytes" BETWEEN 1 AND 268435456),
  "sha256" text NOT NULL CONSTRAINT "change_proposal_download_files_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  "object_key" text NOT NULL CONSTRAINT "change_proposal_download_files_object_key_check" CHECK ("object_key" LIKE '%/product-downloads/key-files/%'),
  "copied_from_product_id" text,
  "copied_from_asset_id" text,
  "copied_from_version" integer,
  "proposal_id" text,
  "created_at" text NOT NULL CONSTRAINT "change_proposal_download_files_created_at_check" CHECK ("created_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  "sweep_attempted_at" text CONSTRAINT "change_proposal_download_files_sweep_attempted_at_check" CHECK ("sweep_attempted_at" IS NULL OR "sweep_attempted_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  CONSTRAINT "change_proposal_download_files_copied_from_check" CHECK (("copied_from_product_id" IS NULL) = ("copied_from_asset_id" IS NULL) AND ("copied_from_asset_id" IS NULL) = ("copied_from_version" IS NULL)),
  CONSTRAINT "change_proposal_download_files_pkey" PRIMARY KEY ("tenant_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "change_proposal_download_files_object_key_uidx" ON "change_proposal_download_files" ("tenant_id", "object_key");
--> statement-breakpoint
CREATE INDEX "change_proposal_download_files_key_idx" ON "change_proposal_download_files" ("tenant_id", "api_key_id");
--> statement-breakpoint
CREATE INDEX "change_proposal_download_files_created_idx" ON "change_proposal_download_files" ("created_at");
--> statement-breakpoint
CREATE INDEX "change_proposal_download_files_proposal_idx" ON "change_proposal_download_files" ("tenant_id", "proposal_id");
--> statement-breakpoint
CREATE TABLE "change_proposal_download_uploads" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "id" text NOT NULL,
  "api_key_id" text NOT NULL,
  "kind" text NOT NULL CONSTRAINT "change_proposal_download_uploads_kind_check" CHECK ("kind" IN ('upload', 'copy')),
  "state" text NOT NULL CONSTRAINT "change_proposal_download_uploads_state_check" CHECK ("state" IN ('started', 'completing', 'interrupted', 'completed', 'failed', 'settled')),
  "file_id" text NOT NULL,
  "file_name" text NOT NULL CONSTRAINT "change_proposal_download_uploads_file_name_check" CHECK (char_length("file_name") BETWEEN 1 AND 255),
  "content_type" text NOT NULL CONSTRAINT "change_proposal_download_uploads_content_type_check" CHECK ("content_type" IN ('application/pdf', 'application/epub+zip', 'application/zip', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'image/png', 'image/jpeg')),
  "declared_bytes" integer NOT NULL CONSTRAINT "change_proposal_download_uploads_declared_bytes_check" CHECK ("declared_bytes" BETWEEN 1 AND 268435456),
  "candidate_key" text CONSTRAINT "change_proposal_download_uploads_candidate_key_check" CHECK ("candidate_key" LIKE '%/product-downloads/key-uploads/%'),
  "staged_key" text CONSTRAINT "change_proposal_download_uploads_staged_key_check" CHECK ("staged_key" LIKE '%/product-downloads/key-files/%'),
  "copied_from_product_id" text,
  "copied_from_asset_id" text,
  "copied_from_version" integer,
  "attempt_id" text,
  "attempt_at" text CONSTRAINT "change_proposal_download_uploads_attempt_at_check" CHECK ("attempt_at" IS NULL OR "attempt_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  "created_at" text NOT NULL CONSTRAINT "change_proposal_download_uploads_created_at_check" CHECK ("created_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  "completed_at" text CONSTRAINT "change_proposal_download_uploads_completed_at_check" CHECK ("completed_at" IS NULL OR "completed_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  "sweep_attempted_at" text CONSTRAINT "change_proposal_download_uploads_sweep_attempted_at_check" CHECK ("sweep_attempted_at" IS NULL OR "sweep_attempted_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  CONSTRAINT "change_proposal_download_uploads_shape_check" CHECK (("kind" = 'upload') = ("copied_from_asset_id" IS NULL) AND ("copied_from_product_id" IS NULL) = ("copied_from_asset_id" IS NULL) AND ("copied_from_asset_id" IS NULL) = ("copied_from_version" IS NULL)),
  CONSTRAINT "change_proposal_download_uploads_attempt_check" CHECK (("attempt_id" IS NULL) = ("attempt_at" IS NULL)),
  CONSTRAINT "change_proposal_download_uploads_pkey" PRIMARY KEY ("tenant_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "change_proposal_download_uploads_file_uidx" ON "change_proposal_download_uploads" ("tenant_id", "file_id");
--> statement-breakpoint
CREATE INDEX "change_proposal_download_uploads_key_idx" ON "change_proposal_download_uploads" ("tenant_id", "api_key_id", "created_at");
--> statement-breakpoint
CREATE INDEX "change_proposal_download_uploads_created_idx" ON "change_proposal_download_uploads" ("created_at");
--> statement-breakpoint
CREATE TABLE "change_proposal_download_deletions" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "object_key" text NOT NULL CONSTRAINT "change_proposal_download_deletions_object_key_check" CHECK ("object_key" LIKE '%/product-downloads/key-files/%'),
  "api_key_id" text NOT NULL,
  "size_bytes" integer NOT NULL CONSTRAINT "change_proposal_download_deletions_size_check" CHECK ("size_bytes" BETWEEN 1 AND 268435456),
  "created_at" text NOT NULL CONSTRAINT "change_proposal_download_deletions_created_at_check" CHECK ("created_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  "sweep_attempted_at" text CONSTRAINT "change_proposal_download_deletions_sweep_attempted_at_check" CHECK ("sweep_attempted_at" IS NULL OR "sweep_attempted_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  CONSTRAINT "change_proposal_download_deletions_pkey" PRIMARY KEY ("tenant_id", "object_key")
);
--> statement-breakpoint
CREATE INDEX "change_proposal_download_deletions_created_idx" ON "change_proposal_download_deletions" ("created_at");
--> statement-breakpoint
ALTER TABLE "product_download_assets" ADD COLUMN "sha256" text;
--> statement-breakpoint
CREATE TABLE "change_proposal_download_upload_events" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "sequence" bigserial NOT NULL,
  "record_id" text NOT NULL,
  "api_key_id" text NOT NULL,
  "kind" text NOT NULL CONSTRAINT "change_proposal_download_upload_events_kind_check" CHECK ("kind" IN ('started', 'claimed', 'completed', 'failed', 'interrupted', 'settled', 'purged')),
  "attempt_id" text,
  "reason" text CONSTRAINT "change_proposal_download_upload_events_reason_check" CHECK ("reason" IS NULL OR "reason" ~ '^[a-z_]{1,64}$'),
  "at" text NOT NULL CONSTRAINT "change_proposal_download_upload_events_at_check" CHECK ("at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  CONSTRAINT "change_proposal_download_upload_events_pkey" PRIMARY KEY ("tenant_id", "sequence")
);
--> statement-breakpoint
CREATE INDEX "change_proposal_download_upload_events_record_idx" ON "change_proposal_download_upload_events" ("tenant_id", "record_id", "sequence");
--> statement-breakpoint
CREATE INDEX "change_proposal_download_upload_events_at_idx" ON "change_proposal_download_upload_events" ("tenant_id", "at");
--> statement-breakpoint
ALTER TABLE "change_proposal_images" ADD COLUMN "sweep_attempted_at" text;
--> statement-breakpoint
ALTER TABLE "change_proposal_image_uploads" ADD COLUMN "sweep_attempted_at" text;
--> statement-breakpoint
ALTER TABLE "change_proposal_image_publications" ADD COLUMN "sweep_attempted_at" text;
