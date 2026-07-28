ALTER TABLE "tenants" ADD COLUMN "invoice_vat_mode" text DEFAULT 'rate' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "invoice_exemption_basis_kind" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "invoice_exemption_basis" text;