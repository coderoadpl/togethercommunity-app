CREATE TABLE "impersonation_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"subject_member_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"reason" text,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"ended_at" text
);
--> statement-breakpoint
CREATE TABLE "tenant_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"subject_member_id" text,
	"reason" text,
	"at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_audit_events" ADD CONSTRAINT "tenant_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "impersonation_sessions_open_actor_session_idx" ON "impersonation_sessions" USING btree ("tenant_id","actor_session_id") WHERE "impersonation_sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "impersonation_sessions_open_expiry_idx" ON "impersonation_sessions" USING btree ("expires_at") WHERE "impersonation_sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "tenant_audit_events_tenant_at_idx" ON "tenant_audit_events" USING btree ("tenant_id","at");