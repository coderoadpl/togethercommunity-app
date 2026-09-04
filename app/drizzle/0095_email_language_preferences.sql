ALTER TABLE "tenants" ADD COLUMN "default_language" text DEFAULT 'pl' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_default_language_check" CHECK ("tenants"."default_language" IN ('pl', 'en')) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenants" VALIDATE CONSTRAINT "tenants_default_language_check";--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_language_check" CHECK ("members"."language" IS NULL OR "members"."language" IN ('pl', 'en')) NOT VALID;--> statement-breakpoint
ALTER TABLE "members" VALIDATE CONSTRAINT "members_language_check";
