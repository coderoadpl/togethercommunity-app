DROP INDEX "email_events_tenant_ref_occurred_idx";--> statement-breakpoint
DROP INDEX "email_events_tenant_occurred_idx";--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "campaign_sends_tenant_email_created_id_idx" ON "campaign_sends" USING btree ("tenant_id","email","created_at","id");--> statement-breakpoint
CREATE INDEX "email_outbox_tenant_normalized_to_created_id_idx" ON "email_outbox" USING btree ("tenant_id",lower(btrim("to")),"created_at","id");--> statement-breakpoint
CREATE INDEX "email_events_tenant_ref_occurred_idx" ON "email_events" USING btree ("tenant_id","ref_id","occurred_at","sequence");--> statement-breakpoint
CREATE INDEX "email_events_tenant_occurred_idx" ON "email_events" USING btree ("tenant_id","occurred_at","sequence");