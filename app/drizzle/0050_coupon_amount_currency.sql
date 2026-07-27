ALTER TABLE "coupons" ADD COLUMN "currency" text;--> statement-breakpoint
UPDATE "coupons" SET "currency" = 'PLN' WHERE "kind" = 'amount';--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_amount_currency_check"
CHECK (
  ("kind" = 'amount' AND "currency" ~ '^[A-Z]{3}$')
  OR ("kind" = 'percent' AND "currency" IS NULL)
);
