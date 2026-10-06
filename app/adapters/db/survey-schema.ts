import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { Survey } from '#core/domain/index.js';
import { members, tenants } from './app-schema.js';

export const surveys = pgTable('surveys', {
  id: text('id').primaryKey(), tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), question: text('question').notNull(), type: text('type', { enum: ['nps', 'stars'] }).notNull(), slug: text('slug').notNull(),
  commentEnabled: boolean('comment_enabled').notNull(), commentPrompt: text('comment_prompt').notNull(), active: boolean('active').notNull(),
  endings: jsonb('endings').$type<Survey['endings']>().notNull(), token: text('token').notNull(), revision: integer('revision').notNull(), createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [uniqueIndex('surveys_tenant_slug_uidx').on(table.tenantId, table.slug), uniqueIndex('surveys_tenant_id_uidx').on(table.tenantId, table.id), check('surveys_type_check', sql`${table.type} IN ('nps', 'stars')`), check('surveys_revision_check', sql`${table.revision} > 0`)]);
export const surveyEvents = pgTable('survey_events', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }), surveyId: text('survey_id').notNull(), revision: integer('revision').notNull(), type: text('type', { enum: ['created', 'updated'] }).notNull(), snapshot: jsonb('snapshot').$type<Survey>().notNull(), occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.surveyId, table.revision] }), foreignKey({ columns: [table.tenantId, table.surveyId], foreignColumns: [surveys.tenantId, surveys.id], name: 'survey_events_survey_fk' }).onDelete('cascade'), check('survey_events_type_check', sql`${table.type} IN ('created', 'updated')`), check('survey_events_revision_check', sql`${table.revision} > 0`)]);
export const surveyResponses = pgTable('survey_responses', {
  id: text('id').primaryKey(), tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }), surveyId: text('survey_id').notNull(), memberId: text('member_id'), score: integer('score').notNull(), comment: text('comment').notNull(), createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.tenantId, table.surveyId], foreignColumns: [surveys.tenantId, surveys.id], name: 'survey_responses_survey_fk' }).onDelete('cascade'),
  foreignKey({ columns: [table.tenantId, table.memberId], foreignColumns: [members.tenantId, members.id], name: 'survey_responses_member_fk' }).onDelete('cascade'),
  uniqueIndex('survey_responses_member_uidx').on(table.tenantId, table.surveyId, table.memberId),
  index('survey_responses_page_idx').on(table.tenantId, table.surveyId, table.updatedAt, table.id),
  check('survey_responses_score_check', sql`${table.score} BETWEEN 0 AND 10`), check('survey_responses_comment_check', sql`length(${table.comment}) <= 2000`),
]);
