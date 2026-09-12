ALTER TABLE "dm_messages" ADD COLUMN "body_format" text DEFAULT 'plain' NOT NULL;
--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_body_format_check" CHECK ("body_format" IN ('plain', 'markdown'));
