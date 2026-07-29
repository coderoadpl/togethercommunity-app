ALTER TABLE "tenants" ADD COLUMN "invoice_vat_mode" text DEFAULT 'rate' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_invoice_vat_mode_check" CHECK ("invoice_vat_mode" IN ('rate', 'exempt'));--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "invoice_exemption_basis_kind" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "invoice_exemption_basis" text;
