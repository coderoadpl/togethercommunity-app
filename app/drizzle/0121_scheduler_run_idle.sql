ALTER TABLE "scheduler_runs" ADD COLUMN "idle" boolean DEFAULT false NOT NULL;
CREATE INDEX "scheduler_runs_kind_started_id_idx" ON "scheduler_runs" USING btree ("kind","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);
CREATE INDEX "campaign_sends_run_id_idx" ON "campaign_sends" USING btree ("run_id");
ALTER TABLE "campaign_sends" DROP CONSTRAINT "campaign_sends_run_id_scheduler_runs_id_fk";
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_run_id_scheduler_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scheduler_runs"("id") ON DELETE restrict ON UPDATE no action;
