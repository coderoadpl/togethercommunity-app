import { and, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';

import { emailEventSchema, emailOutboxPayloadSchema, internal, ok, type AppError, type Result } from '#core/domain/index.js';
import type { EmailOutboxItem, EmailOutboxRepository, EnrollmentTransactionPort, PlatformTransactionalPool } from '#core/server/index.js';

import type { Db } from './client.js';
import { createMemberRepository, createProductGrantRepository } from './repositories.js';
import { emailEvents, emailOutbox, tenantTransactionalEmailPools } from './schema.js';

const reservationAbandoned = sql`${tenantTransactionalEmailPools.reservedAt} < now() - interval '15 minutes'`;

export const createPlatformTransactionalPool = (db: Db): PlatformTransactionalPool => ({
  usage: async (tenantId) => {
    await db.update(tenantTransactionalEmailPools)
      .set({ reserved: 0, reservedAt: null })
      .where(and(eq(tenantTransactionalEmailPools.tenantId, tenantId), reservationAbandoned));
    const [row] = await db.select({
      sent: tenantTransactionalEmailPools.sent,
      reserved: tenantTransactionalEmailPools.reserved,
    }).from(tenantTransactionalEmailPools)
      .where(eq(tenantTransactionalEmailPools.tenantId, tenantId))
      .limit(1);
    return row ?? { sent: 0, reserved: 0 };
  },
  reserve: async (tenantId, limit) => {
    const [row] = await db.insert(tenantTransactionalEmailPools)
      .values({ tenantId, sent: 0, reserved: 1, reservedAt: sql`now()` })
      .onConflictDoUpdate({
        target: tenantTransactionalEmailPools.tenantId,
        set: {
          reserved: sql`case when ${reservationAbandoned} then 1 else ${tenantTransactionalEmailPools.reserved} + 1 end`,
          reservedAt: sql`case when ${reservationAbandoned} or ${tenantTransactionalEmailPools.reserved} = 0 then now() else ${tenantTransactionalEmailPools.reservedAt} end`,
        },
        setWhere: sql`${tenantTransactionalEmailPools.sent} + case when ${reservationAbandoned} then 0 else ${tenantTransactionalEmailPools.reserved} end < ${limit}`,
      })
      .returning({ tenantId: tenantTransactionalEmailPools.tenantId });
    return row !== undefined;
  },
  settle: async (tenantId, successful) => {
    await db.update(tenantTransactionalEmailPools).set({
      reserved: sql`greatest(0, ${tenantTransactionalEmailPools.reserved} - 1)`,
      reservedAt: sql`case when ${tenantTransactionalEmailPools.reserved} <= 1 then null else ${tenantTransactionalEmailPools.reservedAt} end`,
      ...(successful ? { sent: sql`${tenantTransactionalEmailPools.sent} + 1` } : {}),
    }).where(eq(tenantTransactionalEmailPools.tenantId, tenantId));
  },
});

export const createEmailOutboxRepository = (
  db: Db,
  attemptsCap = 5,
): EmailOutboxRepository => ({
  enqueue: async (input) => {
    try {
      const payload = emailOutboxPayloadSchema.parse(input.payload);
      await db.transaction(async (tx) => {
        await tx.insert(emailOutbox).values({
          id: input.id,
          tenantId: input.tenantId,
          kind: payload.kind,
          to: input.to,
          payload,
          nextAttemptAt: input.now,
          createdAt: input.now,
        });
        if (input.tenantId !== null) {
          await tx.insert(emailEvents).values(emailEventSchema.parse({
            id: `${input.id}:queued`,
            tenantId: input.tenantId,
            mailKind: 'transactional',
            refId: input.id,
            type: 'queued',
            occurredAt: input.now,
            meta: null,
            createdAt: input.now,
          }));
        }
      });
      return ok({ id: input.id });
    } catch (cause) {
      return { ok: false, error: internal(`Could not enqueue email: ${String(cause)}`) };
    }
  },
  claimBatch: async (input) => {
    try {
      const rows = await db.transaction(async (tx) => {
        const staleBefore = new Date(Date.parse(input.now) - 15 * 60 * 1000).toISOString();
        await tx
          .update(emailOutbox)
          .set({
            status: sql`case when ${emailOutbox.attempts} + 1 >= ${input.attemptsCap} then 'failed' else 'queued' end`,
            attempts: sql`least(${emailOutbox.attempts} + 1, ${input.attemptsCap})`,
            nextAttemptAt: input.now,
          })
          .where(and(
            eq(emailOutbox.status, 'sending'),
            lt(emailOutbox.nextAttemptAt, staleBefore),
          ));
        const claimed = await tx
          .select({
            id: emailOutbox.id,
            tenantId: emailOutbox.tenantId,
            to: emailOutbox.to,
            payload: emailOutbox.payload,
            attempts: emailOutbox.attempts,
            status: emailOutbox.status,
            sesMessageId: emailOutbox.sesMessageId,
            transport: emailOutbox.transport,
            deliveryStatus: emailOutbox.deliveryStatus,
            deliveryOccurredAt: emailOutbox.deliveryOccurredAt,
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
          await tx
            .update(emailOutbox)
            .set({ status: 'sending', nextAttemptAt: input.now })
            .where(inArray(emailOutbox.id, ids));
          const lifecycle = claimed.flatMap((row) => row.tenantId === null
            ? []
            : [
                ...(row.status === 'failed' ? [emailEventSchema.parse({
                  id: `${row.id}:retried:${String(row.attempts)}`,
                  tenantId: row.tenantId,
                  mailKind: 'transactional',
                  refId: row.id,
                  type: 'retried',
                  occurredAt: input.now,
                  meta: { attempt: row.attempts + 1, runId: input.runId },
                  createdAt: input.now,
                })] : []),
                emailEventSchema.parse({
                  id: `${row.id}:claimed:${String(row.attempts)}`,
                  tenantId: row.tenantId,
                  mailKind: 'transactional',
                  refId: row.id,
                  type: 'claimed',
                  occurredAt: input.now,
                  meta: { attempt: row.attempts + 1, runId: input.runId },
                  createdAt: input.now,
                }),
              ]);
          if (lifecycle.length > 0) await tx.insert(emailEvents).values(lifecycle);
        }
        return claimed;
      });
      const items: EmailOutboxItem[] = rows.map((row) => ({
        ...row,
        deliveryOccurredAt: row.deliveryOccurredAt === null
          ? null
          : new Date(row.deliveryOccurredAt).toISOString(),
      }));
      return ok(items);
    } catch (cause) {
      return { ok: false, error: internal(`Could not claim email outbox batch: ${String(cause)}`) };
    }
  },
  markSent: async (input) => {
    try {
      await db.transaction(async (tx) => {
        const [row] = await tx.update(emailOutbox).set({
          status: 'sent',
          sentAt: input.sentAt,
          sesMessageId: input.sesMessageId,
          transport: input.transport,
          lastError: null,
        }).where(eq(emailOutbox.id, input.id)).returning({ tenantId: emailOutbox.tenantId });
        if (row?.tenantId !== null && row?.tenantId !== undefined) {
          await tx.insert(emailEvents).values(emailEventSchema.parse({
            id: `${input.id}:accepted`,
            tenantId: row.tenantId,
            mailKind: 'transactional',
            refId: input.id,
            type: 'accepted',
            occurredAt: input.sentAt,
            meta: { sesMessageId: input.sesMessageId, transport: input.transport, runId: input.runId },
            createdAt: input.sentAt,
          }));
        }
      });
      return ok(undefined);
    } catch (cause) {
      return { ok: false, error: internal(`Could not mark email sent: ${String(cause)}`) };
    }
  },
  markFailed: async (input) => {
    try {
      await db.transaction(async (tx) => {
        const [row] = await tx.update(emailOutbox).set({
          status: 'failed',
          attempts: input.attempts,
          nextAttemptAt: input.nextAttemptAt,
          lastError: input.error,
          lastErrorCode: input.errorCode,
          ...(input.transport === null ? {} : { transport: input.transport }),
        }).where(eq(emailOutbox.id, input.id)).returning({ tenantId: emailOutbox.tenantId });
        if (row?.tenantId !== null && row?.tenantId !== undefined) {
          await tx.insert(emailEvents).values(emailEventSchema.parse({
            id: `${input.id}:failed:${String(input.attempts)}`,
            tenantId: row.tenantId,
            mailKind: 'transactional',
            refId: input.id,
            type: 'failed',
            occurredAt: input.failedAt,
            meta: {
              error: input.error,
              errorCode: input.errorCode,
              attempt: input.attempts,
              ...(input.transport === null ? {} : { transport: input.transport }),
              runId: input.runId,
            },
            createdAt: input.failedAt,
          }));
        }
      });
      return ok(undefined);
    } catch (cause) {
      return { ok: false, error: internal(`Could not mark email failed: ${String(cause)}`) };
    }
  },
  correlateBySesMessageId: async (tenantId, sesMessageId) => {
    const [row] = await db.select({
      id: emailOutbox.id,
      tenantId: emailOutbox.tenantId,
      to: emailOutbox.to,
      payload: emailOutbox.payload,
      attempts: emailOutbox.attempts,
      sesMessageId: emailOutbox.sesMessageId,
      transport: emailOutbox.transport,
      deliveryStatus: emailOutbox.deliveryStatus,
      deliveryOccurredAt: emailOutbox.deliveryOccurredAt,
    }).from(emailOutbox).where(and(
      eq(emailOutbox.tenantId, tenantId),
      eq(emailOutbox.sesMessageId, sesMessageId),
    )).limit(1);
    return row === undefined ? null : {
      ...row,
      deliveryOccurredAt: row.deliveryOccurredAt === null
        ? null
        : new Date(row.deliveryOccurredAt).toISOString(),
    };
  },
  markDelivery: async (input) => {
    try {
      await db.transaction(async (tx) => {
        await tx.update(emailOutbox).set({
          deliveryStatus: input.status,
          deliveryOccurredAt: input.occurredAt,
        }).where(and(eq(emailOutbox.tenantId, input.tenantId), eq(emailOutbox.id, input.id)));
        await tx.insert(emailEvents).values(emailEventSchema.parse(input.event));
      });
      return ok(undefined);
    } catch (cause) {
      return { ok: false, error: internal(`Could not record email delivery: ${String(cause)}`) };
    }
  },
  hasPendingForTenant: async (tenantId) => {
    const rows = await db
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(and(
        eq(emailOutbox.tenantId, tenantId),
        or(
          eq(emailOutbox.status, 'queued'),
          eq(emailOutbox.status, 'sending'),
          and(eq(emailOutbox.status, 'failed'), lt(emailOutbox.attempts, attemptsCap)),
        ),
      ))
      .limit(1);
    return rows.length > 0;
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
