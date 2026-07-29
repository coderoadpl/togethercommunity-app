CREATE INDEX "campaign_sends_tenant_sent_at_idx" ON "campaign_sends" USING btree ("tenant_id","sent_at");
