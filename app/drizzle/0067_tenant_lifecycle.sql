ALTER TABLE "tenants" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan" text DEFAULT 'self_hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_status_check" CHECK ("tenants"."status" IN ('active', 'suspended'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_check" CHECK ("tenants"."plan" IN ('self_hosted', 'hosted', 'hosted_pro'));