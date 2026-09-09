ALTER TABLE "tenants" ALTER COLUMN "default_language" SET DEFAULT 'en';
--> statement-breakpoint
UPDATE "posts" SET "author_display" = '[deleted-member]' WHERE "author_display" = 'Konto usunięte';
--> statement-breakpoint
UPDATE "posts" SET "body" = '[deleted-post]' WHERE "deleted_at" IS NOT NULL AND "body" = 'Wpis usunięty';
--> statement-breakpoint
UPDATE "post_reports" SET "reporter_display" = '[deleted-member]' WHERE "reporter_display" = 'Konto usunięte';
--> statement-breakpoint
UPDATE "dm_reports" SET "reporter_display" = '[deleted-member]' WHERE "reporter_display" = 'Konto usunięte';
--> statement-breakpoint
UPDATE "dm_reports" SET "reported_display" = '[deleted-member]' WHERE "reported_display" = 'Konto usunięte';
--> statement-breakpoint
UPDATE "dm_reports" SET "snapshot" = (
  SELECT jsonb_agg(
    CASE WHEN entry->>'senderDisplay' = 'Konto usunięte'
      THEN jsonb_set(entry, '{senderDisplay}', '"[deleted-member]"'::jsonb)
      ELSE entry END ORDER BY idx
  )
  FROM jsonb_array_elements("snapshot") WITH ORDINALITY AS tail(entry, idx)
) WHERE "snapshot" @> '[{"senderDisplay":"Konto usunięte"}]'::jsonb;
