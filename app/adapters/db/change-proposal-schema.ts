import { sql, type SQL } from 'drizzle-orm';
import { bigserial, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';

import type {
  ChangeProposalEffect,
  ChangeProposalEventKind,
  ChangeProposalInput,
  ChangeProposalStatus,
  ChangeProposalTargetKind,
  KeyDownloadContentType,
  KeyDownloadRecordEventKind,
  KeyDownloadRecordState,
  ProposalImageExtension,
  ProposalImageKind,
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
  operation: text('operation').notNull(),
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
  check('change_proposals_operation_check', sql`char_length(${table.operation}) <= 64 AND ${table.operation} ~ '^[a-z]+(-[a-z]+)*[.][a-z]+(-[a-z]+)*$'`),
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

export const changeProposalImages = pgTable('change_proposal_images', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  apiKeyId: text('api_key_id').notNull(),
  kind: text('kind').$type<ProposalImageKind>().notNull(),
  digest: text('digest').notNull(),
  extension: text('extension').$type<ProposalImageExtension>().notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: text('created_at').notNull(),
  releasedAt: text('released_at'),
  sweepAttemptedAt: text('sweep_attempted_at'),
  deleteUnresolvedAt: text('delete_unresolved_at'),
  pendingSince: text('pending_since'),
}, (table) => [
  primaryKey({ name: 'change_proposal_images_pkey', columns: [table.tenantId, table.apiKeyId, table.kind, table.digest, table.extension] }),
  index('change_proposal_images_created_idx').on(table.createdAt),
  check('change_proposal_images_kind_check', sql`${table.kind} IN ('product-cover', 'logo', 'logo-dark', 'favicon', 'share-image')`),
  check('change_proposal_images_digest_check', sql`${table.digest} ~ '^[0-9a-f]{64}$'`),
  check('change_proposal_images_extension_check', sql`${table.extension} IN ('png', 'jpg', 'webp', 'svg', 'ico')`),
  check('change_proposal_images_size_check', sql`${table.sizeBytes} BETWEEN 1 AND 5242880`),
  check('change_proposal_images_created_at_check', isoMillisecondTimestamp(table.createdAt)),
  check('change_proposal_images_released_at_check', sql`${table.releasedAt} IS NULL OR ${isoMillisecondTimestamp(table.releasedAt)}`),
  check('change_proposal_images_delete_unresolved_at_check', sql`${table.deleteUnresolvedAt} IS NULL OR ${isoMillisecondTimestamp(table.deleteUnresolvedAt)}`),
  check('change_proposal_images_pending_since_check', sql`${table.pendingSince} IS NULL OR ${isoMillisecondTimestamp(table.pendingSince)}`),
]);

export const changeProposalImageUploads = pgTable('change_proposal_image_uploads', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  apiKeyId: text('api_key_id').notNull(),
  objectKey: text('object_key').notNull(),
  createdAt: text('created_at').notNull(),
  sweepAttemptedAt: text('sweep_attempted_at'),
  firstDeletedAt: text('first_deleted_at'),
  completedDigest: text('completed_digest'),
  completedExtension: text('completed_extension').$type<ProposalImageExtension>(),
}, (table) => [
  primaryKey({ name: 'change_proposal_image_uploads_pkey', columns: [table.tenantId, table.objectKey] }),
  index('change_proposal_image_uploads_key_idx').on(table.tenantId, table.apiKeyId, table.createdAt),
  index('change_proposal_image_uploads_created_idx').on(table.createdAt),
  check('change_proposal_image_uploads_object_key_check', sql`${table.objectKey} LIKE 'image-asset-candidates/%'`),
  check('change_proposal_image_uploads_created_at_check', isoMillisecondTimestamp(table.createdAt)),
  check('change_proposal_image_uploads_first_deleted_at_check', sql`${table.firstDeletedAt} IS NULL OR ${isoMillisecondTimestamp(table.firstDeletedAt)}`),
  check('change_proposal_image_uploads_completed_digest_check', sql`${table.completedDigest} IS NULL OR ${table.completedDigest} ~ '^[0-9a-f]{64}$'`),
  check('change_proposal_image_uploads_completed_extension_check', sql`${table.completedExtension} IS NULL OR ${table.completedExtension} IN ('png', 'jpg', 'webp', 'svg', 'ico')`),
  check('change_proposal_image_uploads_completed_check', sql`(${table.completedDigest} IS NULL) = (${table.completedExtension} IS NULL)`),
]);

export const changeProposalImagePublications = pgTable('change_proposal_image_publications', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  attemptId: text('attempt_id').notNull(),
  kind: text('kind').$type<ProposalImageKind>().notNull(),
  digest: text('digest').notNull(),
  extension: text('extension').$type<ProposalImageExtension>().notNull(),
  startedAt: text('started_at').notNull(),
  sweepAttemptedAt: text('sweep_attempted_at'),
  deleteUnresolvedAt: text('delete_unresolved_at'),
}, (table) => [
  primaryKey({ name: 'change_proposal_image_publications_pkey', columns: [table.tenantId, table.attemptId, table.kind, table.digest, table.extension] }),
  index('change_proposal_image_publications_started_idx').on(table.startedAt),
  check('change_proposal_image_publications_kind_check', sql`${table.kind} IN ('product-cover', 'logo', 'logo-dark', 'favicon', 'share-image')`),
  check('change_proposal_image_publications_digest_check', sql`${table.digest} ~ '^[0-9a-f]{64}$'`),
  check('change_proposal_image_publications_extension_check', sql`${table.extension} IN ('png', 'jpg', 'webp', 'svg', 'ico')`),
  check('change_proposal_image_publications_started_at_check', isoMillisecondTimestamp(table.startedAt)),
  check('change_proposal_image_publications_delete_unresolved_at_check', sql`${table.deleteUnresolvedAt} IS NULL OR ${isoMillisecondTimestamp(table.deleteUnresolvedAt)}`),
]);

const KEY_DOWNLOAD_CONTENT_TYPE_CHECK = sql.raw(`'application/pdf', 'application/epub+zip', 'application/zip', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'image/png', 'image/jpeg'`);

export const changeProposalDownloadFiles = pgTable('change_proposal_download_files', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  apiKeyId: text('api_key_id').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').$type<KeyDownloadContentType>().notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  objectKey: text('object_key').notNull(),
  copiedFromProductId: text('copied_from_product_id'),
  copiedFromAssetId: text('copied_from_asset_id'),
  copiedFromVersion: integer('copied_from_version'),
  proposalId: text('proposal_id'),
  createdAt: text('created_at').notNull(),
  sweepAttemptedAt: text('sweep_attempted_at'),
}, (table) => [
  primaryKey({ name: 'change_proposal_download_files_pkey', columns: [table.tenantId, table.id] }),
  uniqueIndex('change_proposal_download_files_object_key_uidx').on(table.tenantId, table.objectKey),
  index('change_proposal_download_files_key_idx').on(table.tenantId, table.apiKeyId),
  index('change_proposal_download_files_created_idx').on(table.createdAt),
  index('change_proposal_download_files_proposal_idx').on(table.tenantId, table.proposalId),
  check('change_proposal_download_files_file_name_check', sql`char_length(${table.fileName}) BETWEEN 1 AND 255`),
  check('change_proposal_download_files_content_type_check', sql`${table.contentType} IN (${KEY_DOWNLOAD_CONTENT_TYPE_CHECK})`),
  check('change_proposal_download_files_size_check', sql`${table.sizeBytes} BETWEEN 1 AND 268435456`),
  check('change_proposal_download_files_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  check('change_proposal_download_files_object_key_check', sql`${table.objectKey} LIKE '%/product-downloads/key-files/%'`),
  check('change_proposal_download_files_created_at_check', isoMillisecondTimestamp(table.createdAt)),
  check('change_proposal_download_files_sweep_attempted_at_check', sql`${table.sweepAttemptedAt} IS NULL OR ${isoMillisecondTimestamp(table.sweepAttemptedAt)}`),
  check('change_proposal_download_files_copied_from_check', sql`(${table.copiedFromProductId} IS NULL) = (${table.copiedFromAssetId} IS NULL) AND (${table.copiedFromAssetId} IS NULL) = (${table.copiedFromVersion} IS NULL)`),
]);

export const changeProposalDownloadUploads = pgTable('change_proposal_download_uploads', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  apiKeyId: text('api_key_id').notNull(),
  kind: text('kind').$type<'upload' | 'copy'>().notNull(),
  state: text('state').$type<KeyDownloadRecordState>().notNull(),
  fileId: text('file_id').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').$type<KeyDownloadContentType>().notNull(),
  declaredBytes: integer('declared_bytes').notNull(),
  candidateKey: text('candidate_key'),
  stagedKey: text('staged_key'),
  copiedFromProductId: text('copied_from_product_id'),
  copiedFromAssetId: text('copied_from_asset_id'),
  copiedFromVersion: integer('copied_from_version'),
  attemptId: text('attempt_id'),
  attemptAt: text('attempt_at'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
  sweepAttemptedAt: text('sweep_attempted_at'),
}, (table) => [
  primaryKey({ name: 'change_proposal_download_uploads_pkey', columns: [table.tenantId, table.id] }),
  uniqueIndex('change_proposal_download_uploads_file_uidx').on(table.tenantId, table.fileId),
  index('change_proposal_download_uploads_key_idx').on(table.tenantId, table.apiKeyId, table.createdAt),
  index('change_proposal_download_uploads_created_idx').on(table.createdAt),
  check('change_proposal_download_uploads_kind_check', sql`${table.kind} IN ('upload', 'copy')`),
  check('change_proposal_download_uploads_state_check', sql`${table.state} IN ('started', 'completing', 'interrupted', 'completed', 'failed', 'settled')`),
  check('change_proposal_download_uploads_file_name_check', sql`char_length(${table.fileName}) BETWEEN 1 AND 255`),
  check('change_proposal_download_uploads_content_type_check', sql`${table.contentType} IN (${KEY_DOWNLOAD_CONTENT_TYPE_CHECK})`),
  check('change_proposal_download_uploads_declared_bytes_check', sql`${table.declaredBytes} BETWEEN 1 AND 268435456`),
  check('change_proposal_download_uploads_candidate_key_check', sql`${table.candidateKey} LIKE '%/product-downloads/key-uploads/%'`),
  check('change_proposal_download_uploads_staged_key_check', sql`${table.stagedKey} LIKE '%/product-downloads/key-files/%'`),
  check('change_proposal_download_uploads_attempt_at_check', sql`${table.attemptAt} IS NULL OR ${isoMillisecondTimestamp(table.attemptAt)}`),
  check('change_proposal_download_uploads_created_at_check', isoMillisecondTimestamp(table.createdAt)),
  check('change_proposal_download_uploads_completed_at_check', sql`${table.completedAt} IS NULL OR ${isoMillisecondTimestamp(table.completedAt)}`),
  check('change_proposal_download_uploads_sweep_attempted_at_check', sql`${table.sweepAttemptedAt} IS NULL OR ${isoMillisecondTimestamp(table.sweepAttemptedAt)}`),
  check('change_proposal_download_uploads_shape_check', sql`(${table.kind} = 'upload') = (${table.copiedFromAssetId} IS NULL) AND (${table.copiedFromProductId} IS NULL) = (${table.copiedFromAssetId} IS NULL) AND (${table.copiedFromAssetId} IS NULL) = (${table.copiedFromVersion} IS NULL)`),
  check('change_proposal_download_uploads_attempt_check', sql`(${table.attemptId} IS NULL) = (${table.attemptAt} IS NULL)`),
]);

export const changeProposalDownloadDeletions = pgTable('change_proposal_download_deletions', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(),
  apiKeyId: text('api_key_id').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: text('created_at').notNull(),
  sweepAttemptedAt: text('sweep_attempted_at'),
  notBefore: text('not_before'),
}, (table) => [
  primaryKey({ name: 'change_proposal_download_deletions_pkey', columns: [table.tenantId, table.objectKey] }),
  index('change_proposal_download_deletions_created_idx').on(table.createdAt),
  check('change_proposal_download_deletions_object_key_check', sql`${table.objectKey} LIKE '%/product-downloads/key-files/%' OR ${table.objectKey} LIKE '%/product-downloads/key-uploads/%'`),
  check('change_proposal_download_deletions_size_check', sql`${table.sizeBytes} BETWEEN 1 AND 268435456`),
  check('change_proposal_download_deletions_created_at_check', isoMillisecondTimestamp(table.createdAt)),
  check('change_proposal_download_deletions_sweep_attempted_at_check', sql`${table.sweepAttemptedAt} IS NULL OR ${isoMillisecondTimestamp(table.sweepAttemptedAt)}`),
  check('change_proposal_download_deletions_not_before_check', sql`${table.notBefore} IS NULL OR ${isoMillisecondTimestamp(table.notBefore)}`),
]);

export const changeProposalDownloadUploadEvents = pgTable('change_proposal_download_upload_events', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sequence: bigserial('sequence', { mode: 'number' }).notNull(),
  recordId: text('record_id').notNull(),
  apiKeyId: text('api_key_id').notNull(),
  kind: text('kind').$type<KeyDownloadRecordEventKind>().notNull(),
  attemptId: text('attempt_id'),
  reason: text('reason'),
  at: text('at').notNull(),
}, (table) => [
  primaryKey({ name: 'change_proposal_download_upload_events_pkey', columns: [table.tenantId, table.sequence] }),
  index('change_proposal_download_upload_events_record_idx').on(table.tenantId, table.recordId, table.sequence),
  index('change_proposal_download_upload_events_at_idx').on(table.tenantId, table.at),
  check('change_proposal_download_upload_events_kind_check', sql`${table.kind} IN ('started', 'claimed', 'completed', 'failed', 'interrupted', 'settled', 'purged')`),
  check('change_proposal_download_upload_events_reason_check', sql`${table.reason} IS NULL OR ${table.reason} ~ '^[a-z_]{1,64}$'`),
  check('change_proposal_download_upload_events_at_check', isoMillisecondTimestamp(table.at)),
]);
