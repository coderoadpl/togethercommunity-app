CREATE TABLE "change_proposal_images" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "api_key_id" text NOT NULL,
  "kind" text NOT NULL CONSTRAINT "change_proposal_images_kind_check" CHECK ("kind" IN ('product-cover', 'logo', 'logo-dark', 'favicon', 'share-image')),
  "digest" text NOT NULL CONSTRAINT "change_proposal_images_digest_check" CHECK ("digest" ~ '^[0-9a-f]{64}$'),
  "extension" text NOT NULL CONSTRAINT "change_proposal_images_extension_check" CHECK ("extension" IN ('png', 'jpg', 'webp', 'svg', 'ico')),
  "size_bytes" integer NOT NULL CONSTRAINT "change_proposal_images_size_check" CHECK ("size_bytes" BETWEEN 1 AND 5242880),
  "created_at" text NOT NULL CONSTRAINT "change_proposal_images_created_at_check" CHECK ("created_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  "released_at" text CONSTRAINT "change_proposal_images_released_at_check" CHECK ("released_at" IS NULL OR "released_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  CONSTRAINT "change_proposal_images_pkey" PRIMARY KEY ("tenant_id", "api_key_id", "kind", "digest", "extension")
);
--> statement-breakpoint
CREATE INDEX "change_proposal_images_created_idx" ON "change_proposal_images" ("created_at");
--> statement-breakpoint
CREATE TABLE "change_proposal_image_uploads" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "api_key_id" text NOT NULL,
  "object_key" text NOT NULL CONSTRAINT "change_proposal_image_uploads_object_key_check" CHECK ("object_key" LIKE 'image-asset-candidates/%'),
  "created_at" text NOT NULL CONSTRAINT "change_proposal_image_uploads_created_at_check" CHECK ("created_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  CONSTRAINT "change_proposal_image_uploads_pkey" PRIMARY KEY ("tenant_id", "object_key")
);
--> statement-breakpoint
CREATE INDEX "change_proposal_image_uploads_key_idx" ON "change_proposal_image_uploads" ("tenant_id", "api_key_id", "created_at");
--> statement-breakpoint
CREATE INDEX "change_proposal_image_uploads_created_idx" ON "change_proposal_image_uploads" ("created_at");
--> statement-breakpoint
CREATE TABLE "change_proposal_image_publications" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "attempt_id" text NOT NULL,
  "kind" text NOT NULL CONSTRAINT "change_proposal_image_publications_kind_check" CHECK ("kind" IN ('product-cover', 'logo', 'logo-dark', 'favicon', 'share-image')),
  "digest" text NOT NULL CONSTRAINT "change_proposal_image_publications_digest_check" CHECK ("digest" ~ '^[0-9a-f]{64}$'),
  "extension" text NOT NULL CONSTRAINT "change_proposal_image_publications_extension_check" CHECK ("extension" IN ('png', 'jpg', 'webp', 'svg', 'ico')),
  "started_at" text NOT NULL CONSTRAINT "change_proposal_image_publications_started_at_check" CHECK ("started_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  CONSTRAINT "change_proposal_image_publications_pkey" PRIMARY KEY ("tenant_id", "attempt_id", "kind", "digest", "extension")
);
--> statement-breakpoint
CREATE INDEX "change_proposal_image_publications_started_idx" ON "change_proposal_image_publications" ("started_at");
