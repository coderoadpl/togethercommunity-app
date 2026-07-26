import { and, desc, eq, ilike, lt, or, sql, type SQL } from 'drizzle-orm';

import {
  emailSendProjectionSchema,
  normalizeEmail,
  renderEmailOutboxPayload,
  type EmailSendListQuery,
  type EmailSendProjection,
} from '@core/domain/index.js';
import type { EmailSendRepository } from '@core/server/index.js';

import type { Db } from './client.js';
import { campaigns, campaignSends, emailOutbox } from './schema.js';

interface Cursor {
  createdAt: string;
  key: string;
}

const decodeCursor = (value: string): Cursor => {
  const parts = value.split('~');
  const createdAt = decodeURIComponent(parts[0] ?? '');
  const kind = parts[1] ?? '';
  const id = decodeURIComponent(parts[2] ?? '');
  return { createdAt, key: `${kind}:${id}` };
};

const encodeCursor = (send: EmailSendProjection): string =>
  `${encodeURIComponent(send.createdAt)}~${send.kind}~${encodeURIComponent(send.id)}`;

const beforeCursor = (
  createdAt: typeof emailOutbox.createdAt | typeof campaignSends.createdAt,
  id: typeof emailOutbox.id | typeof campaignSends.id,
  kind: EmailSendProjection['kind'],
  cursor: Cursor,
): SQL => or(
  lt(createdAt, cursor.createdAt),
  and(eq(createdAt, cursor.createdAt), sql`(${kind + ':'} || ${id}) < ${cursor.key}`),
) ?? sql`false`;

const transactionalStatus = (status: EmailSendListQuery['status']): status is 'queued' | 'sending' | 'sent' | 'failed' =>
  status === 'queued' || status === 'sending' || status === 'sent' || status === 'failed';

const marketingStatus = (status: EmailSendListQuery['status']): status is 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' =>
  status === 'pending' || status === 'sending' || status === 'sent' || status === 'failed' || status === 'skipped';

const transactionalRows = async (
  db: Db,
  tenantId: string,
  query: EmailSendListQuery,
  cursor: Cursor | undefined,
  sendId?: string,
): Promise<EmailSendProjection[]> => {
  if (query.kind === 'marketing' || (query.status !== undefined && !transactionalStatus(query.status)) || query.campaignId !== undefined) return [];
  const filters: SQL[] = [eq(emailOutbox.tenantId, tenantId)];
  if (sendId !== undefined) filters.push(eq(emailOutbox.id, sendId));
  if (query.status !== undefined) filters.push(eq(emailOutbox.status, query.status));
  if (query.deliveryStatus !== undefined) filters.push(eq(emailOutbox.deliveryStatus, query.deliveryStatus));
  if (query.search !== undefined) filters.push(ilike(emailOutbox.to, `%${query.search}%`));
  if (cursor !== undefined) filters.push(beforeCursor(emailOutbox.createdAt, emailOutbox.id, 'transactional', cursor));
  const rows = await db.select().from(emailOutbox)
    .where(and(...filters))
    .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
    .limit(query.limit + 1);
  return rows.flatMap((row) => {
    const rendered = renderEmailOutboxPayload(row.payload);
    if (!rendered.success) return [];
    return [emailSendProjectionSchema.parse({
      id: row.id,
      tenantId,
      kind: 'transactional',
      recipient: row.to,
      subject: rendered.data.subject,
      source: row.kind,
      status: row.status,
      skipReason: null,
      deliveryStatus: row.deliveryStatus,
      deliveryOccurredAt: row.deliveryOccurredAt === null ? null : new Date(row.deliveryOccurredAt).toISOString(),
      campaignId: null,
      campaignName: null,
      sesMessageId: row.sesMessageId,
      createdAt: new Date(row.createdAt).toISOString(),
      sentAt: row.sentAt === null ? null : new Date(row.sentAt).toISOString(),
    })];
  });
};

const marketingRows = async (
  db: Db,
  tenantId: string,
  query: EmailSendListQuery,
  cursor: Cursor | undefined,
  sendId?: string,
): Promise<EmailSendProjection[]> => {
  if (query.kind === 'transactional' || (query.status !== undefined && !marketingStatus(query.status))) return [];
  const filters: SQL[] = [eq(campaignSends.tenantId, tenantId)];
  if (sendId !== undefined) filters.push(eq(campaignSends.id, sendId));
  if (query.status !== undefined) filters.push(eq(campaignSends.status, query.status));
  if (query.deliveryStatus !== undefined) filters.push(eq(campaignSends.deliveryStatus, query.deliveryStatus));
  if (query.campaignId !== undefined) filters.push(eq(campaignSends.campaignId, query.campaignId));
  if (query.search !== undefined) filters.push(ilike(campaignSends.email, `%${normalizeEmail(query.search)}%`));
  if (cursor !== undefined) filters.push(beforeCursor(campaignSends.createdAt, campaignSends.id, 'marketing', cursor));
  const rows = await db.select({ send: campaignSends, campaignName: campaigns.name })
    .from(campaignSends)
    .leftJoin(campaigns, and(
      eq(campaigns.tenantId, tenantId),
      eq(campaigns.id, campaignSends.campaignId),
    ))
    .where(and(...filters))
    .orderBy(desc(campaignSends.createdAt), desc(campaignSends.id))
    .limit(query.limit + 1);
  return rows.map(({ send, campaignName }) => emailSendProjectionSchema.parse({
    id: send.id,
    tenantId,
    kind: 'marketing',
    recipient: send.email,
    subject: send.subject,
    source: send.source,
    status: send.status,
    skipReason: send.skipReason,
    deliveryStatus: send.deliveryStatus,
    deliveryOccurredAt: send.deliveryOccurredAt === null ? null : new Date(send.deliveryOccurredAt).toISOString(),
    campaignId: send.campaignId,
    campaignName,
    sesMessageId: send.sesMessageId,
    createdAt: new Date(send.createdAt).toISOString(),
    sentAt: send.sentAt === null ? null : new Date(send.sentAt).toISOString(),
  }));
};

const newestFirst = (left: EmailSendProjection, right: EmailSendProjection): number =>
  right.createdAt.localeCompare(left.createdAt)
  || `${right.kind}:${right.id}`.localeCompare(`${left.kind}:${left.id}`);

export const createEmailSendRepository = (db: Db): EmailSendRepository => {
  const listPage: EmailSendRepository['listPage'] = async (tenantId, query) => {
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = (await Promise.all([
      transactionalRows(db, tenantId, query, cursor),
      marketingRows(db, tenantId, query, cursor),
    ])).flat().sort(newestFirst);
    const sends = rows.slice(0, query.limit);
    const lastSend = sends.at(-1);
    return {
      sends,
      nextCursor: rows.length > query.limit && lastSend !== undefined
        ? encodeCursor(lastSend)
        : null,
    };
  };
  return {
    listPage,
    findById: async (tenantId, kind, id) => {
      const rows = kind === 'transactional'
        ? await transactionalRows(db, tenantId, { kind, limit: 1 }, undefined, id)
        : await marketingRows(db, tenantId, { kind, limit: 1 }, undefined, id);
      return rows[0] ?? null;
    },
    listByEmailAcrossKinds: async (tenantId, email) => {
      const output: EmailSendProjection[] = [];
      let cursor: string | undefined;
      do {
        const page = await listPage(tenantId, {
          search: normalizeEmail(email),
          ...(cursor === undefined ? {} : { cursor }),
          limit: 100,
        });
        output.push(...page.sends.filter((send) => send.recipient === normalizeEmail(email)));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return output;
    },
  };
};
