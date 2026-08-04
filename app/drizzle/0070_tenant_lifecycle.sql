ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_status_check";--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_plan_check";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_status_check" CHECK ("tenants"."status" IN ('active', 'suspended')) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenants" VALIDATE CONSTRAINT "tenants_status_check";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_check" CHECK ("tenants"."plan" IN ('self_hosted', 'hosted', 'hosted_pro')) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenants" VALIDATE CONSTRAINT "tenants_plan_check";
