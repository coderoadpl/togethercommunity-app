ALTER TABLE "campaign_sends" DROP CONSTRAINT "campaign_sends_consent_row_id_marketing_consents_id_fk";
--> statement-breakpoint
ALTER TABLE "campaign_sends" ALTER COLUMN "consent_row_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "retention_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_consents" ADD COLUMN "retention_started_at" timestamp with time zone;--> statement-breakpoint
UPDATE "marketing_consents" AS "evidence"
SET "retention_started_at" = (
	SELECT min("withdrawal"."occurred_at")
	FROM "marketing_consents" AS "withdrawal"
	WHERE "withdrawal"."tenant_id" = "evidence"."tenant_id"
		AND "withdrawal"."email" = "evidence"."email"
		AND "withdrawal"."definition_id" = "evidence"."definition_id"
		AND "withdrawal"."status" = 'withdrawn'
		AND "withdrawal"."occurred_at" >= "evidence"."occurred_at"
)
WHERE EXISTS (
	SELECT 1
	FROM "marketing_consents" AS "withdrawal"
	WHERE "withdrawal"."tenant_id" = "evidence"."tenant_id"
		AND "withdrawal"."email" = "evidence"."email"
		AND "withdrawal"."definition_id" = "evidence"."definition_id"
		AND "withdrawal"."status" = 'withdrawn'
		AND "withdrawal"."occurred_at" >= "evidence"."occurred_at"
);--> statement-breakpoint
UPDATE "marketing_consents" AS "evidence"
SET "retention_started_at" = "members"."deleted_at"::timestamptz
FROM "members"
WHERE "members"."tenant_id" = "evidence"."tenant_id"
	AND "members"."id" = "evidence"."member_id"
	AND "members"."deleted_at" IS NOT NULL
	AND "evidence"."retention_started_at" IS NULL;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_consent_row_id_marketing_consents_id_fk" FOREIGN KEY ("consent_row_id") REFERENCES "public"."marketing_consents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_sends_consent_row_id_idx" ON "campaign_sends" USING btree ("consent_row_id");--> statement-breakpoint
CREATE INDEX "consents_retention_started_tenant_idx" ON "consents" USING btree ("retention_started_at","tenant_id");--> statement-breakpoint
CREATE INDEX "marketing_consents_retention_started_tenant_idx" ON "marketing_consents" USING btree ("retention_started_at","tenant_id");
