CREATE TABLE "tenant_redirects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"from_path" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text,
	"target_path" text NOT NULL,
	"permanent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_redirects" ADD CONSTRAINT "tenant_redirects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_redirects_tenant_from_path_uidx" ON "tenant_redirects" USING btree ("tenant_id","from_path");
