import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { tenants } from './app-schema.js';

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const signInClientHostReservations = pgTable('sign_in_client_host_reservations', {
  hostname: text('hostname').primaryKey(),
  clientId: text('client_id').notNull().unique('sign_in_client_reservations_client_id_key'),
  reservedAt: instant('reserved_at').notNull(),
}, (table) => [
  unique('sign_in_client_reservations_binding_key').on(table.hostname, table.clientId),
]);

export const signInClients = pgTable('sign_in_clients', {
  clientId: text('client_id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  redirectHost: text('redirect_host').notNull(),
  name: text('name'),
  redirectUris: text('redirect_uris').array().notNull(),
  state: text('state').notNull(),
  secretHash: text('secret_hash'),
  credentialVersion: integer('credential_version').notNull(),
  secretExpiresAt: instant('secret_expires_at'),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
  secretRotatedAt: instant('secret_rotated_at'),
  hostVerifiedAt: instant('host_verified_at'),
  activatedAt: instant('activated_at'),
  retiredAt: instant('retired_at'),
}, (table) => [
  foreignKey({
    name: 'sign_in_clients_reservation_fk',
    columns: [table.redirectHost, table.clientId],
    foreignColumns: [signInClientHostReservations.hostname, signInClientHostReservations.clientId],
  }),
  unique('sign_in_clients_tenant_client_key').on(table.tenantId, table.clientId),
  index('sign_in_clients_tenant_created_idx').on(table.tenantId, table.createdAt, table.clientId),
  index('sign_in_clients_retired_idx').on(table.tenantId, table.retiredAt, table.clientId).where(sql`${table.state} = 'retired'`),
  check('sign_in_clients_version_check', sql`${table.credentialVersion} > 0`),
  check('sign_in_clients_activation_check', sql`${table.hostVerifiedAt} IS NULL AND ${table.activatedAt} IS NULL`),
  check('sign_in_clients_lifecycle_check', sql`(
    ${table.state} = 'pending_activation' AND ${table.retiredAt} IS NULL
    AND ${table.name} IS NOT NULL AND char_length(${table.name}) BETWEEN 1 AND 120
    AND cardinality(${table.redirectUris}) BETWEEN 1 AND 5 AND array_position(${table.redirectUris}, NULL) IS NULL
    AND ${table.secretHash} IS NOT NULL AND ${table.secretHash} ~ '^v1:[A-Za-z0-9_-]{43}$'
    AND ${table.secretExpiresAt} IS NOT NULL
  ) OR (
    ${table.state} = 'retired' AND ${table.retiredAt} IS NOT NULL
    AND ${table.name} IS NULL AND cardinality(${table.redirectUris}) = 0
    AND ${table.secretHash} IS NULL AND ${table.secretExpiresAt} IS NULL
  )`),
]);

export const signInClientEvents = pgTable('sign_in_client_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  clientId: text('client_id').notNull(),
  kind: text('kind').notNull(),
  actorKind: text('actor_kind').notNull(),
  credentialVersion: integer('credential_version').notNull(),
  occurredAt: instant('occurred_at').notNull(),
}, (table) => [
  foreignKey({
    name: 'sign_in_client_events_client_fk',
    columns: [table.tenantId, table.clientId],
    foreignColumns: [signInClients.tenantId, signInClients.clientId],
  }).onDelete('cascade'),
  index('sign_in_client_events_client_time_idx').on(table.tenantId, table.clientId, table.occurredAt, table.id),
  check('sign_in_client_events_kind_check', sql`${table.kind} IN ('created', 'secret_rotated', 'retired')`),
  check('sign_in_client_events_actor_check', sql`${table.actorKind} = 'direct_owner'`),
  check('sign_in_client_events_version_check', sql`${table.credentialVersion} > 0`),
]);
