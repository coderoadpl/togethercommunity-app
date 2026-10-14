CREATE TABLE "tenant_admin_invitations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "email" text NOT NULL,
  "invited_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_admin_invitations_tenant_user_uidx" ON "tenant_admin_invitations" ("tenant_id", "user_id");
