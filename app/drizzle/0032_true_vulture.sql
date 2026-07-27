ALTER TABLE "campaign_sends" ADD COLUMN "subject" text;--> statement-breakpoint
UPDATE "campaign_sends"
SET "subject" = COALESCE(
  (SELECT "campaigns"."subject" FROM "campaigns" WHERE "campaigns"."id" = "campaign_sends"."campaign_id"),
  'Marketing e-mail'
);--> statement-breakpoint
ALTER TABLE "campaign_sends" ALTER COLUMN "subject" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "campaign_sends_tenant_created_id_idx" ON "campaign_sends" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "email_outbox_tenant_created_id_idx" ON "email_outbox" USING btree ("tenant_id","created_at","id");
