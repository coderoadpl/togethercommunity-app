CREATE TABLE "course_lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"contents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"legacy_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_modules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"course_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text NOT NULL,
	"prefix" text,
	"chapters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"legacy_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"image_url" text,
	"legacy_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_course_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"member_id" text NOT NULL,
	"course_id" text NOT NULL,
	"last_viewed_lesson_id" text,
	"last_viewed_module_id" text,
	"last_viewed_chapter_id" text,
	"completed_lesson_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "legacy_id" text;--> statement-breakpoint
ALTER TABLE "product_grants" ADD COLUMN "starts_at" text DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL;--> statement-breakpoint
ALTER TABLE "product_grants" ADD COLUMN "expires_at" text;--> statement-breakpoint
ALTER TABLE "product_grants" ADD COLUMN "legacy_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "access_items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "legacy_id" text;--> statement-breakpoint
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_course_progress" ADD CONSTRAINT "member_course_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_course_progress" ADD CONSTRAINT "member_course_progress_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_course_progress" ADD CONSTRAINT "member_course_progress_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_lessons_tenantId_idx" ON "course_lessons" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_lessons_tenant_legacy_uidx" ON "course_lessons" USING btree ("tenant_id","legacy_id") WHERE "course_lessons"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "course_modules_tenantId_idx" ON "course_modules" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_modules_tenant_legacy_uidx" ON "course_modules" USING btree ("tenant_id","legacy_id") WHERE "course_modules"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "courses_tenantId_idx" ON "courses" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_tenant_legacy_uidx" ON "courses" USING btree ("tenant_id","legacy_id") WHERE "courses"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "member_course_progress_tenantId_idx" ON "member_course_progress" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "member_course_progress_memberId_idx" ON "member_course_progress" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_course_progress_tenant_member_course_uidx" ON "member_course_progress" USING btree ("tenant_id","member_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_tenant_legacy_uidx" ON "members" USING btree ("tenant_id","legacy_id") WHERE "members"."legacy_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_grants_tenant_legacy_uidx" ON "product_grants" USING btree ("tenant_id","legacy_id") WHERE "product_grants"."legacy_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_legacy_uidx" ON "products" USING btree ("tenant_id","legacy_id") WHERE "products"."legacy_id" is not null;
