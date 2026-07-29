CREATE TABLE "dev_emails" (
	"to" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"created_at" text NOT NULL
);
