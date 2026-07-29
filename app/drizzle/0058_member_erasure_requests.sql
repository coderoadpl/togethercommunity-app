CREATE TABLE "member_erasure_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"member_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"requested_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"resolution_note" text,
	CONSTRAINT "member_erasure_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "member_erasure_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE "member_erasure_request_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" text,
	"meta" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_erasure_request_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "member_erasure_request_events_request_id_member_erasure_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."member_erasure_requests"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX "member_erasure_requests_open_uidx" ON "member_erasure_requests" USING btree ("tenant_id","member_id") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "member_erasure_requests_tenant_status_idx" ON "member_erasure_requests" USING btree ("tenant_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "member_erasure_request_events_request_idx" ON "member_erasure_request_events" USING btree ("tenant_id","request_id","occurred_at");
