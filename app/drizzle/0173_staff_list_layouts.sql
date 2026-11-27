CREATE TABLE "staff_list_layouts" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "list_id" text NOT NULL,
  "layout" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_list_layouts_tenant_id_user_id_list_id_pk" PRIMARY KEY ("tenant_id", "user_id", "list_id")
);
