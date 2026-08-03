ALTER TABLE "member_events" ADD COLUMN "payload" jsonb;--> statement-breakpoint
UPDATE "member_events"
SET "payload" = CASE
  WHEN "type" = 'banned' THEN jsonb_build_object(
    'reason', "reason",
    'actorUserId', "actor_user_id"
  )
  ELSE jsonb_build_object('actorUserId', "actor_user_id")
END;--> statement-breakpoint
ALTER TABLE "member_events" ALTER COLUMN "payload" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member_events" DROP COLUMN "reason";--> statement-breakpoint
ALTER TABLE "member_events" DROP COLUMN "actor_user_id";--> statement-breakpoint

INSERT INTO "member_events" ("id", "tenant_id", "member_id", "type", "payload", "occurred_at")
SELECT
  'purchase:' || "id",
  "tenant_id",
  "member_id",
  'purchase',
  jsonb_build_object(
    'orderId', "id",
    'productId', "product_id",
    'kind', "kind",
    'status', "status",
    'amountCents', "amount_cents",
    'currency', "currency",
    'provider', "provider"
  ),
  "created_at"
FROM "orders"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "member_events" ("id", "tenant_id", "member_id", "type", "payload", "occurred_at")
SELECT
  'grant:' || "id" || ':' || "starts_at" || ':' || coalesce("expires_at", 'perpetual'),
  "tenant_id",
  "member_id",
  'grant',
  jsonb_build_object(
    'grantId', "id",
    'productId', "product_id",
    'source', "source",
    'startsAt', "starts_at",
    'expiresAt', "expires_at"
  ),
  "created_at"
FROM "product_grants"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "member_events" ("id", "tenant_id", "member_id", "type", "payload", "occurred_at")
SELECT
  'subscription-change:' || "id" || ':' || "updated_at" || ':' || "status" || ':' || "current_period_end",
  "tenant_id",
  "member_id",
  'subscription-change',
  jsonb_build_object(
    'subscriptionId', "id",
    'productId', "product_id",
    'status', "status",
    'currentPeriodEnd', "current_period_end",
    'cancelAtPeriodEnd', "cancel_at_period_end",
    'provider', "provider"
  ),
  "updated_at"
FROM "member_subscriptions"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "member_events" ("id", "tenant_id", "member_id", "type", "payload", "occurred_at")
SELECT
  'lesson-completion:' || progress."id" || ':' || completed."lesson_id" || ':' || progress."updated_at",
  progress."tenant_id",
  progress."member_id",
  'lesson-completion',
  jsonb_build_object(
    'courseId', progress."course_id",
    'lessonId', completed."lesson_id"
  ),
  progress."updated_at"
FROM "member_course_progress" progress
CROSS JOIN LATERAL jsonb_array_elements_text(progress."completed_lesson_ids") completed("lesson_id")
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "member_events" ("id", "tenant_id", "member_id", "type", "payload", "occurred_at")
SELECT
  'email-sent:transactional:' || outbox."id" || ':' || member."id",
  outbox."tenant_id",
  member."id",
  'email-sent',
  jsonb_build_object(
    'sendId', outbox."id",
    'mailKind', 'transactional',
    'subject', CASE outbox."kind"
      WHEN 'welcome-set-password' THEN CASE
        WHEN outbox."payload" ->> 'language' = 'en'
          THEN concat('Hello, your ', outbox."payload" ->> 'tenantName', ' account is ready')
        ELSE concat('Cześć, Twoje konto ', outbox."payload" ->> 'tenantName', ' jest gotowe')
      END
      WHEN 'reset-password' THEN CASE
        WHEN outbox."payload" ->> 'language' = 'en' THEN 'Reset your password'
        ELSE 'Zresetuj hasło'
      END
      WHEN 'magic-link' THEN CASE
        WHEN outbox."payload" ->> 'language' = 'en'
          THEN concat('Sign in to ', outbox."payload" ->> 'tenantName')
        ELSE concat('Zaloguj się do ', outbox."payload" ->> 'tenantName')
      END
      WHEN 'thread-reply' THEN CASE
        WHEN outbox."payload" ->> 'language' = 'en'
          THEN concat('New reply in the "', outbox."payload" ->> 'lessonName', '" discussion')
        ELSE concat('Nowa odpowiedź w dyskusji „', outbox."payload" ->> 'lessonName', '”')
      END
      WHEN 'lesson-question' THEN CASE
        WHEN outbox."payload" ->> 'language' = 'en'
          THEN concat('New question under “', outbox."payload" ->> 'lessonName', '”')
        ELSE concat('Nowe pytanie pod lekcją „', outbox."payload" ->> 'lessonName', '”')
      END
      WHEN 'space-post' THEN CASE
        WHEN outbox."payload" ->> 'language' = 'en'
          THEN concat('New post in “', outbox."payload" ->> 'spaceName', '”')
        ELSE concat('Nowy wpis w strefie „', outbox."payload" ->> 'spaceName', '”')
      END
      WHEN 'subscription-payment-failed' THEN CASE
        WHEN outbox."payload" ->> 'language' = 'en'
          THEN concat('Payment failed for ', outbox."payload" ->> 'productTitle')
        ELSE concat('Nie udało się pobrać płatności za ', outbox."payload" ->> 'productTitle')
      END
      WHEN 'subscription-ended' THEN CASE
        WHEN outbox."payload" ->> 'language' = 'en'
          THEN concat('Your ', outbox."payload" ->> 'productTitle', ' subscription has ended')
        ELSE concat('Twoja subskrypcja ', outbox."payload" ->> 'productTitle', ' zakończyła się')
      END
      WHEN 'support-message'
        THEN concat('[', outbox."payload" ->> 'tenantName', '] ', outbox."payload" ->> 'subject')
      WHEN 'member-erasure-request' THEN CASE
        WHEN outbox."payload" ->> 'language' = 'en'
          THEN concat('[', outbox."payload" ->> 'tenantName', '] Member erasure request')
        ELSE concat('[', outbox."payload" ->> 'tenantName', '] Wniosek o usunięcie danych')
      END
      WHEN 'reputation-alert' THEN CASE
        WHEN outbox."payload" ->> 'language' = 'en'
          THEN concat('[', outbox."payload" ->> 'tenantName', '] E-mail reputation ', outbox."payload" ->> 'status')
        ELSE concat('[', outbox."payload" ->> 'tenantName', '] Reputacja e-mail: ', outbox."payload" ->> 'status')
      END
      WHEN 'marketing-consent-confirmation' THEN 'Confirm your e-mail consent'
      ELSE outbox."kind"
    END,
    'source', outbox."kind",
    'transport', coalesce(outbox."transport", 'platform')
  ),
  to_char(outbox."sent_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM "email_outbox" outbox
JOIN "members" member
  ON member."tenant_id" = outbox."tenant_id"
  AND lower(btrim(member."email")) = lower(btrim(outbox."to"))
WHERE outbox."tenant_id" IS NOT NULL
  AND outbox."status" = 'sent'
  AND outbox."sent_at" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "member_events" ("id", "tenant_id", "member_id", "type", "payload", "occurred_at")
SELECT
  'email-sent:marketing:' || send."id" || ':' || member."id",
  send."tenant_id",
  member."id",
  'email-sent',
  jsonb_build_object(
    'sendId', send."id",
    'mailKind', 'marketing',
    'subject', send."subject",
    'source', send."source",
    'transport', 'tenant-ses'
  ),
  to_char(send."sent_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM "campaign_sends" send
JOIN "members" member
  ON member."tenant_id" = send."tenant_id"
  AND (
    member."id" = send."member_id"
    OR (send."member_id" IS NULL AND lower(btrim(member."email")) = lower(btrim(send."email")))
  )
WHERE send."status" = 'sent'
  AND send."sent_at" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
