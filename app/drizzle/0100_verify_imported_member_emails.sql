UPDATE "user" SET "email_verified" = true
WHERE "email_verified" = false
  AND "id" IN (
    SELECT "members"."user_id"
    FROM "members"
    JOIN "import_audit_events"
      ON "import_audit_events"."tenant_id" = "members"."tenant_id"
     AND "import_audit_events"."kind" = 'member'
     AND "import_audit_events"."resource_id" = "members"."id"
  );
