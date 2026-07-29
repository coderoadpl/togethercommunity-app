ALTER TABLE "processed_events" ADD COLUMN "status" text DEFAULT 'processed' NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_events" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "processed_events" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "processed_events" ADD COLUMN "worker_id" text;--> statement-breakpoint
CREATE INDEX "processed_events_lease_idx" ON "processed_events" USING btree ("status","lease_expires_at");
