ALTER TABLE "erased_member_imports" DROP CONSTRAINT "erased_member_imports_pkey";--> statement-breakpoint
ALTER TABLE "erased_member_imports" ADD CONSTRAINT "erased_member_imports_tenant_id_member_id_pk" PRIMARY KEY ("tenant_id", "member_id");--> statement-breakpoint
ALTER TABLE "processed_events" DROP CONSTRAINT "processed_events_pkey";--> statement-breakpoint
ALTER TABLE "processed_events" ADD CONSTRAINT "processed_events_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "member_events" DROP CONSTRAINT "member_events_pkey";--> statement-breakpoint
ALTER TABLE "member_events" ADD CONSTRAINT "member_events_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");
