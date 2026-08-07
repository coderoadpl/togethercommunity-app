UPDATE "email_outbox"
SET
	"kind" = 'welcome-sign-in',
	"payload" = jsonb_set("payload", '{kind}', '"welcome-sign-in"'::jsonb)
WHERE "kind" = 'welcome-set-password' OR "payload" ->> 'kind' = 'welcome-set-password';
