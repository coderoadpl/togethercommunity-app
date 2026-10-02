ALTER TABLE "tenant_redirects" ADD COLUMN "target_anchor" text;
--> statement-breakpoint
ALTER TABLE "tenant_redirects" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_redirects" ADD COLUMN "hit_count" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_redirects" ADD COLUMN "last_hit_at" timestamp with time zone;
