import { sql, type SQL } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, text, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';

import type {
  ChangeProposalEffect,
  ChangeProposalEventKind,
  ChangeProposalInput,
  ChangeProposalOperation,
  ChangeProposalStatus,
  ChangeProposalTargetKind,
} from '#core/domain/index.js';

import { tenants } from './app-schema.js';

const isoMillisecondTimestamp = (column: AnyPgColumn): SQL =>
  sql`${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'`;

export const changeProposalGroups = pgTable('change_proposal_groups', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  proposedByKeyId: text('proposed_by_key_id').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('change_proposal_groups_tenant_id_uidx').on(table.tenantId, table.id),
  index('change_proposal_groups_tenant_key_idx').on(table.tenantId, table.proposedByKeyId, table.createdAt),
  check('change_proposal_groups_title_length_check', sql`char_length(${table.title}) BETWEEN 1 AND 500`),
  check('change_proposal_groups_created_at_check', isoMillisecondTimestamp(table.createdAt)),
]);

export const changeProposals = pgTable('change_proposals', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: text('group_id'),
  groupPosition: integer('group_position'),
  operation: text('operation').$type<ChangeProposalOperation>().notNull(),
  input: jsonb('input').$type<ChangeProposalInput>().notNull(),
  effect: jsonb('effect').$type<ChangeProposalEffect>().notNull(),
  targetKind: text('target_kind').$type<ChangeProposalTargetKind>().notNull(),
  targetId: text('target_id'),
  status: text('status').$type<ChangeProposalStatus>().notNull(),
  proposedByKeyId: text('proposed_by_key_id').notNull(),
  proposedByKeyName: text('proposed_by_key_name').notNull(),
  proposedByIssuerUserId: text('proposed_by_issuer_user_id').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  decidedByUserId: text('decided_by_user_id'),
  decidedAt: text('decided_at'),
  decisionNote: text('decision_note'),
  appliedResourceId: text('applied_resource_id'),
  failureCode: text('failure_code'),
  failureMessage: text('failure_message'),
}, (table) => [
  uniqueIndex('change_proposals_tenant_id_uidx').on(table.tenantId, table.id),
  index('change_proposals_tenant_status_created_idx').on(table.tenantId, table.status, table.createdAt),
  index('change_proposals_tenant_key_created_idx').on(table.tenantId, table.proposedByKeyId, table.createdAt),
  uniqueIndex('change_proposals_tenant_group_position_uidx')
    .on(table.tenantId, table.groupId, table.groupPosition)
    .where(sql`${table.groupId} IS NOT NULL`),
  foreignKey({
    name: 'change_proposals_tenant_group_fk',
    columns: [table.tenantId, table.groupId],
    foreignColumns: [changeProposalGroups.tenantId, changeProposalGroups.id],
  }),
  check('change_proposals_group_position_check', sql`${table.groupPosition} >= 1`),
  check('change_proposals_operation_check', sql`${table.operation} IN (
    'product.create', 'product.update', 'product.publish', 'product.unpublish', 'product.delete-draft',
    'price.create', 'price.deactivate', 'stock.enable', 'stock.adjust', 'stock.set-threshold'
  )`),
  check('change_proposals_input_check', sql`jsonb_typeof(${table.input}) = 'object'`),
  check('change_proposals_effect_check', sql`jsonb_typeof(${table.effect}) = 'object'`),
  check('change_proposals_target_kind_check', sql`${table.targetKind} IN ('product', 'price', 'sales-link', 'settings')`),
  check('change_proposals_target_id_length_check', sql`char_length(${table.targetId}) BETWEEN 1 AND 200`),
  check('change_proposals_status_check', sql`${table.status} IN ('pending', 'applied', 'rejected', 'stale', 'withdrawn', 'failed')`),
  check('change_proposals_key_name_length_check', sql`char_length(${table.proposedByKeyName}) BETWEEN 1 AND 120`),
  check('change_proposals_created_at_check', isoMillisecondTimestamp(table.createdAt)),
  check('change_proposals_expires_at_check', isoMillisecondTimestamp(table.expiresAt)),
  check('change_proposals_decided_at_check', isoMillisecondTimestamp(table.decidedAt)),
  check('change_proposals_decision_note_length_check', sql`char_length(${table.decisionNote}) <= 500`),
  check('change_proposals_applied_resource_id_length_check', sql`char_length(${table.appliedResourceId}) BETWEEN 1 AND 200`),
  check('change_proposals_failure_code_length_check', sql`char_length(${table.failureCode}) BETWEEN 1 AND 64`),
  check('change_proposals_failure_message_length_check', sql`char_length(${table.failureMessage}) <= 2000`),
  check('change_proposals_group_shape_check', sql`(${table.groupId} IS NULL) = (${table.groupPosition} IS NULL)`),
  check('change_proposals_decision_shape_check', sql`(${table.status} = 'pending' AND ${table.decidedAt} IS NULL AND ${table.decidedByUserId} IS NULL AND ${table.decisionNote} IS NULL)
    OR (${table.status} <> 'pending' AND ${table.decidedAt} IS NOT NULL)`),
  check('change_proposals_failure_shape_check', sql`(${table.status} = 'failed' AND ${table.failureCode} IS NOT NULL)
    OR (${table.status} <> 'failed' AND ${table.failureCode} IS NULL AND ${table.failureMessage} IS NULL)`),
  check('change_proposals_applied_shape_check', sql`${table.status} = 'applied' OR ${table.appliedResourceId} IS NULL`),
  check('change_proposals_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
]);

export const changeProposalEvents = pgTable('change_proposal_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  proposalId: text('proposal_id').notNull(),
  sequence: integer('sequence').notNull(),
  kind: text('kind').$type<ChangeProposalEventKind>().notNull(),
  actorUserId: text('actor_user_id'),
  apiKeyId: text('api_key_id'),
  note: text('note'),
  at: text('at').notNull(),
}, (table) => [
  uniqueIndex('change_proposal_events_tenant_proposal_sequence_uidx').on(table.tenantId, table.proposalId, table.sequence),
  foreignKey({
    name: 'change_proposal_events_tenant_proposal_fk',
    columns: [table.tenantId, table.proposalId],
    foreignColumns: [changeProposals.tenantId, changeProposals.id],
  }),
  check('change_proposal_events_sequence_check', sql`${table.sequence} >= 1`),
  check('change_proposal_events_kind_check', sql`${table.kind} IN ('proposed', 'applied', 'rejected', 'stale', 'withdrawn', 'expired', 'apply_failed')`),
  check('change_proposal_events_note_length_check', sql`char_length(${table.note}) <= 500`),
  check('change_proposal_events_at_check', isoMillisecondTimestamp(table.at)),
  check('change_proposal_events_actor_check', sql`${table.actorUserId} IS NOT NULL OR ${table.apiKeyId} IS NOT NULL`),
]);
