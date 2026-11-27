CREATE TABLE "sign_in_client_host_reservations" (
  "hostname" text PRIMARY KEY,
  "client_id" text NOT NULL CONSTRAINT "sign_in_client_reservations_client_id_key" UNIQUE,
  "reserved_at" timestamp with time zone NOT NULL,
  CONSTRAINT "sign_in_client_reservations_binding_key" UNIQUE ("hostname", "client_id")
);
--> statement-breakpoint
CREATE TABLE "sign_in_clients" (
  "client_id" text PRIMARY KEY,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "redirect_host" text NOT NULL,
  "name" text,
  "redirect_uris" text[] NOT NULL,
  "state" text NOT NULL,
  "secret_hash" text,
  "credential_version" integer NOT NULL CONSTRAINT "sign_in_clients_version_check" CHECK ("credential_version" > 0),
  "secret_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "secret_rotated_at" timestamp with time zone,
  "host_verified_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  "retired_at" timestamp with time zone,
  CONSTRAINT "sign_in_clients_reservation_fk" FOREIGN KEY ("redirect_host", "client_id") REFERENCES "sign_in_client_host_reservations"("hostname", "client_id"),
  CONSTRAINT "sign_in_clients_tenant_client_key" UNIQUE ("tenant_id", "client_id"),
  CONSTRAINT "sign_in_clients_activation_check" CHECK ("host_verified_at" IS NULL AND "activated_at" IS NULL),
  CONSTRAINT "sign_in_clients_lifecycle_check" CHECK ((
    "state" = 'pending_activation' AND "retired_at" IS NULL
    AND "name" IS NOT NULL AND char_length("name") BETWEEN 1 AND 120
    AND cardinality("redirect_uris") BETWEEN 1 AND 5 AND array_position("redirect_uris", NULL) IS NULL
    AND "secret_hash" IS NOT NULL AND "secret_hash" ~ '^v1:[A-Za-z0-9_-]{43}$'
    AND "secret_expires_at" IS NOT NULL
  ) OR (
    "state" = 'retired' AND "retired_at" IS NOT NULL
    AND "name" IS NULL AND cardinality("redirect_uris") = 0
    AND "secret_hash" IS NULL AND "secret_expires_at" IS NULL
  ))
);
--> statement-breakpoint
CREATE INDEX "sign_in_clients_tenant_created_idx" ON "sign_in_clients" ("tenant_id", "created_at", "client_id");
--> statement-breakpoint
CREATE INDEX "sign_in_clients_retired_idx" ON "sign_in_clients" ("tenant_id", "retired_at", "client_id") WHERE "state" = 'retired';
--> statement-breakpoint
CREATE TABLE "sign_in_client_events" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "client_id" text NOT NULL,
  "kind" text NOT NULL CONSTRAINT "sign_in_client_events_kind_check" CHECK ("kind" IN ('created', 'secret_rotated', 'retired')),
  "actor_kind" text NOT NULL CONSTRAINT "sign_in_client_events_actor_check" CHECK ("actor_kind" = 'direct_owner'),
  "credential_version" integer NOT NULL CONSTRAINT "sign_in_client_events_version_check" CHECK ("credential_version" > 0),
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "sign_in_client_events_client_fk" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "sign_in_clients"("tenant_id", "client_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "sign_in_client_events_client_time_idx" ON "sign_in_client_events" ("tenant_id", "client_id", "occurred_at", "id");
