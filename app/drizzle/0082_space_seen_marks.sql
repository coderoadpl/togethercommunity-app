CREATE TABLE "space_seen_marks" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"space_id" text NOT NULL,
	"seen_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_seen_marks" ADD CONSTRAINT "space_seen_marks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_seen_marks" ADD CONSTRAINT "space_seen_marks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "space_seen_marks_tenant_user_space_uidx" ON "space_seen_marks" USING btree ("tenant_id","user_id","space_id");