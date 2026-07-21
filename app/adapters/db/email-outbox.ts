import { and, eq, inArray, lt, lte, or } from 'drizzle-orm';

import { emailOutboxPayloadSchema, internal, ok, type AppError, type Result } from '@core/domain/index.js';
import type { EmailOutboxItem, EmailOutboxRepository, EnrollmentTransactionPort } from '@core/server/index.js';

import type { Db } from './client.js';
import { createMemberRepository, createProductGrantRepository } from './repositories.js';
import { emailOutbox } from './schema.js';

export const createEmailOutboxRepository = (db: Db): EmailOutboxRepository => ({
  enqueue: async (input) => {
    try {
      const payload = emailOutboxPayloadSchema.parse(input.payload);
      await db.insert(emailOutbox).values({
        id: input.id,
        tenantId: input.tenantId,
        kind: payload.kind,
        to: input.to,
        payload,
        nextAttemptAt: input.now,
        createdAt: input.now,
      });
      return ok({ id: input.id });
    } catch (cause) {
      return { ok: false, error: internal(`Could not enqueue email: ${String(cause)}`) };
    }
  },
  claimBatch: async (input) => {
    try {
      const rows = await db.transaction(async (tx) => {
        const claimed = await tx
          .select({
            id: emailOutbox.id,
            tenantId: emailOutbox.tenantId,
            to: emailOutbox.to,
            payload: emailOutbox.payload,
            attempts: emailOutbox.attempts,
          })
          .from(emailOutbox)
          .where(
            and(
              or(eq(emailOutbox.status, 'queued'), eq(emailOutbox.status, 'failed')),
              lt(emailOutbox.attempts, input.attemptsCap),
              lte(emailOutbox.nextAttemptAt, input.now),
            ),
          )
          .orderBy(emailOutbox.nextAttemptAt, emailOutbox.createdAt)
          .limit(input.limit)
          .for('update', { skipLocked: true });
        const ids = claimed.map((row) => row.id);
        if (ids.length > 0) {
          await tx.update(emailOutbox).set({ status: 'sending' }).where(inArray(emailOutbox.id, ids));
        }
        return claimed;
      });
      const items: EmailOutboxItem[] = rows.map((row) => ({ ...row }));
      return ok(items);
    } catch (cause) {
      return { ok: false, error: internal(`Could not claim email outbox batch: ${String(cause)}`) };
    }
  },
  markSent: async (input) => {
    try {
      await db.update(emailOutbox).set({ status: 'sent', sentAt: input.sentAt, lastError: null }).where(eq(emailOutbox.id, input.id));
      return ok(undefined);
    } catch (cause) {
      return { ok: false, error: internal(`Could not mark email sent: ${String(cause)}`) };
    }
  },
  markFailed: async (input) => {
    try {
      await db.update(emailOutbox).set({ status: 'failed', attempts: input.attempts, nextAttemptAt: input.nextAttemptAt, lastError: input.error }).where(eq(emailOutbox.id, input.id));
      return ok(undefined);
    } catch (cause) {
      return { ok: false, error: internal(`Could not mark email failed: ${String(cause)}`) };
    }
  },
});

export const createEnrollmentTransactionPort = (db: Db): EnrollmentTransactionPort => ({
  run: async (operation) => {
    let rejected: Result<never, AppError> | null = null;
    try {
      return await db.transaction(async (tx) => {
        const result = await operation({
          members: createMemberRepository(tx),
          grants: createProductGrantRepository(tx),
          emailOutbox: createEmailOutboxRepository(tx),
        });
        if (!result.ok) {
          rejected = result;
          tx.rollback();
        }
        return result;
      });
    } catch (cause) {
      if (rejected !== null) return rejected;
      return { ok: false, error: internal(`Could not complete enrollment transaction: ${String(cause)}`) };
    }
  },
});
