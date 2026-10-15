ALTER TABLE "tenant_admin_invitations"
  ADD CONSTRAINT "tenant_admin_invitations_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
