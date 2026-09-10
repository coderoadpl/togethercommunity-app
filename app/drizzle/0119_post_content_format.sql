ALTER TABLE "posts" ADD COLUMN "body_format" text DEFAULT 'plain' NOT NULL;
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_body_format_check" CHECK ("body_format" IN ('plain', 'markdown'));
