CREATE TABLE "invoice_events" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" text NOT NULL,
	CONSTRAINT "invoice_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"provider_invoice_id" text,
	"invoice_number" text,
	"pdf_url" text,
	"error" text,
	"issued_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "billing" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "auto_issue_invoices" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "auto_issue_invoice_scope" text DEFAULT 'b2b_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_events_tenant_order_occurred_idx" ON "invoice_events" USING btree ("tenant_id","order_id","occurred_at","sequence");--> statement-breakpoint
CREATE INDEX "invoices_tenant_order_idx" ON "invoices" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_order_current_uidx" ON "invoices" USING btree ("tenant_id","order_id") WHERE "invoices"."status" <> 'failed';--> statement-breakpoint
CREATE FUNCTION prevent_paid_order_billing_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'paid' AND NEW.billing IS DISTINCT FROM OLD.billing THEN
    RAISE EXCEPTION 'paid order billing snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER orders_paid_billing_immutable
BEFORE UPDATE OF billing ON orders
FOR EACH ROW EXECUTE FUNCTION prevent_paid_order_billing_change();
