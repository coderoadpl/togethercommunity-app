ALTER TABLE "shop_management_keys" ADD COLUMN "mode" text DEFAULT 'direct' NOT NULL;
--> statement-breakpoint
ALTER TABLE "shop_management_keys" ADD CONSTRAINT "shop_management_keys_mode_check" CHECK ("mode" IN ('direct', 'propose'));
--> statement-breakpoint
ALTER TABLE "shop_management_keys" ADD CONSTRAINT "shop_management_keys_propose_scopes_check" CHECK (
  "mode" <> 'propose'
  OR NOT ("scopes" ?| ARRAY['shop:fulfilment:write', 'shop:integrations:write'])
);
--> statement-breakpoint
ALTER TABLE "shop_management_keys" ADD CONSTRAINT "shop_management_keys_propose_read_scopes_check" CHECK (
  "mode" <> 'propose'
  OR (
    (NOT "scopes" ? 'shop:catalog:write' OR "scopes" ? 'shop:catalog:read')
    AND (NOT "scopes" ? 'shop:settings:write' OR "scopes" ? 'shop:settings:read')
  )
);
--> statement-breakpoint
CREATE TABLE "change_proposal_groups" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" text NOT NULL CONSTRAINT "change_proposal_groups_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 500),
  "proposed_by_key_id" text NOT NULL,
  "created_at" text NOT NULL CONSTRAINT "change_proposal_groups_created_at_check" CHECK ("created_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "change_proposal_groups_tenant_id_uidx" ON "change_proposal_groups" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX "change_proposal_groups_tenant_key_idx" ON "change_proposal_groups" ("tenant_id", "proposed_by_key_id", "created_at");
--> statement-breakpoint
CREATE TABLE "change_proposals" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "group_id" text,
  "group_position" integer CONSTRAINT "change_proposals_group_position_check" CHECK ("group_position" >= 1),
  "operation" text NOT NULL CONSTRAINT "change_proposals_operation_check" CHECK ("operation" IN (
    'product.create', 'product.update', 'product.publish', 'product.unpublish', 'product.delete-draft',
    'price.create', 'price.deactivate', 'stock.enable', 'stock.adjust', 'stock.set-threshold'
  )),
  "input" jsonb NOT NULL CONSTRAINT "change_proposals_input_check" CHECK (jsonb_typeof("input") = 'object'),
  "effect" jsonb NOT NULL CONSTRAINT "change_proposals_effect_check" CHECK (jsonb_typeof("effect") = 'object'),
  "target_kind" text NOT NULL CONSTRAINT "change_proposals_target_kind_check" CHECK ("target_kind" IN ('product', 'price', 'sales-link', 'settings')),
  "target_id" text CONSTRAINT "change_proposals_target_id_length_check" CHECK (char_length("target_id") BETWEEN 1 AND 200),
  "status" text NOT NULL CONSTRAINT "change_proposals_status_check" CHECK ("status" IN ('pending', 'applied', 'rejected', 'stale', 'withdrawn', 'failed')),
  "proposed_by_key_id" text NOT NULL,
  "proposed_by_key_name" text NOT NULL CONSTRAINT "change_proposals_key_name_length_check" CHECK (char_length("proposed_by_key_name") BETWEEN 1 AND 120),
  "proposed_by_issuer_user_id" text NOT NULL,
  "created_at" text NOT NULL CONSTRAINT "change_proposals_created_at_check" CHECK ("created_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  "expires_at" text NOT NULL CONSTRAINT "change_proposals_expires_at_check" CHECK ("expires_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  "decided_by_user_id" text,
  "decided_at" text CONSTRAINT "change_proposals_decided_at_check" CHECK ("decided_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  "decision_note" text CONSTRAINT "change_proposals_decision_note_length_check" CHECK (char_length("decision_note") <= 500),
  "applied_resource_id" text CONSTRAINT "change_proposals_applied_resource_id_length_check" CHECK (char_length("applied_resource_id") BETWEEN 1 AND 200),
  "failure_code" text CONSTRAINT "change_proposals_failure_code_length_check" CHECK (char_length("failure_code") BETWEEN 1 AND 64),
  "failure_message" text CONSTRAINT "change_proposals_failure_message_length_check" CHECK (char_length("failure_message") <= 2000),
  CONSTRAINT "change_proposals_group_shape_check" CHECK (("group_id" IS NULL) = ("group_position" IS NULL)),
  CONSTRAINT "change_proposals_decision_shape_check" CHECK (
    ("status" = 'pending' AND "decided_at" IS NULL AND "decided_by_user_id" IS NULL AND "decision_note" IS NULL)
    OR ("status" <> 'pending' AND "decided_at" IS NOT NULL)
  ),
  CONSTRAINT "change_proposals_failure_shape_check" CHECK (
    ("status" = 'failed' AND "failure_code" IS NOT NULL)
    OR ("status" <> 'failed' AND "failure_code" IS NULL AND "failure_message" IS NULL)
  ),
  CONSTRAINT "change_proposals_applied_shape_check" CHECK ("status" = 'applied' OR "applied_resource_id" IS NULL),
  CONSTRAINT "change_proposals_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "change_proposals_tenant_id_uidx" ON "change_proposals" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX "change_proposals_tenant_status_created_idx" ON "change_proposals" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "change_proposals_tenant_key_created_idx" ON "change_proposals" ("tenant_id", "proposed_by_key_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "change_proposals_tenant_group_position_uidx" ON "change_proposals" ("tenant_id", "group_id", "group_position") WHERE "group_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_tenant_group_fk" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "change_proposal_groups" ("tenant_id", "id");
--> statement-breakpoint
CREATE TABLE "change_proposal_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "proposal_id" text NOT NULL,
  "sequence" integer NOT NULL CONSTRAINT "change_proposal_events_sequence_check" CHECK ("sequence" >= 1),
  "kind" text NOT NULL CONSTRAINT "change_proposal_events_kind_check" CHECK ("kind" IN ('proposed', 'applied', 'rejected', 'stale', 'withdrawn', 'expired', 'apply_failed')),
  "actor_user_id" text,
  "api_key_id" text,
  "note" text CONSTRAINT "change_proposal_events_note_length_check" CHECK (char_length("note") <= 500),
  "at" text NOT NULL CONSTRAINT "change_proposal_events_at_check" CHECK ("at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  CONSTRAINT "change_proposal_events_actor_check" CHECK ("actor_user_id" IS NOT NULL OR "api_key_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "change_proposal_events_tenant_proposal_sequence_uidx" ON "change_proposal_events" ("tenant_id", "proposal_id", "sequence");
--> statement-breakpoint
ALTER TABLE "change_proposal_events" ADD CONSTRAINT "change_proposal_events_tenant_proposal_fk" FOREIGN KEY ("tenant_id", "proposal_id") REFERENCES "change_proposals" ("tenant_id", "id");
