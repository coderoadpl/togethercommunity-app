ALTER TABLE "members" ADD COLUMN "avatar_url" text;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar_cleared" boolean DEFAULT false NOT NULL;
