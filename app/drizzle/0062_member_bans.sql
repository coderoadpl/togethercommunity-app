CREATE TABLE "member_events" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"tenant_id" text NOT NULL,
	"member_id" text NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"actor_user_id" text NOT NULL,
	"occurred_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "banned_at" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "banned_reason" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "banned_by_user_id" text;--> statement-breakpoint
ALTER TABLE "member_events" ADD CONSTRAINT "member_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_events" ADD CONSTRAINT "member_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_events_tenant_member_occurred_idx" ON "member_events" USING btree ("tenant_id","member_id","occurred_at","sequence");--> statement-breakpoint
CREATE INDEX "members_tenant_banned_idx" ON "members" USING btree ("tenant_id","banned_at") WHERE "members"."banned_at" is not null;