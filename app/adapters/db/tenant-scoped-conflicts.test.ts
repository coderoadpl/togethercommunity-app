import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DELETED_MEMBER_DISPLAY, memberTombstone, type MemberEvent } from '#core/domain/index.js';

import type { Db } from './client.js';
import { createMemberEventRepository } from './member-events.js';
import { createMemberErasureRepository, createProcessedPaymentEventRepository } from './repositories.js';
import { erasedMemberImports, members, processedPaymentEvents, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const NOW = '1998-07-14T10:00:00.000Z';
const LATER = '1998-07-14T10:06:00.000Z';
const ACME = 'tenant-acme';
const STUDIO = 'tenant-studio';
const lease = { workerId: 'worker-shared', now: NOW, leaseExpiresAt: '1998-07-14T10:05:00.000Z' };
const nextLease = { ...lease, now: LATER, leaseExpiresAt: '1998-07-14T10:11:00.000Z' };
const paymentEvent = (id: string, tenantId: string) => ({
  id, tenantId, type: 'invoice.paid', objectId: `object-${id}`, processedAt: NOW,
});
const tenantRows = [ACME, STUDIO].map((id) => ({ id, slug: id, name: id, createdAt: NOW }));
const memberRow = (tenantId: string, id: string) => ({
  id, tenantId, userId: `${tenantId}-${id}`, email: `${tenantId}-${id}@example.test`,
  legacyId: id, createdAt: NOW,
});

let db: Db;
let close: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const testDatabase = await createTestDatabase('together_tenant_conflicts_test', databaseUrl);
  db = testDatabase.db;
  close = testDatabase.close;
  await db.insert(tenants).values(tenantRows);
});

afterAll(async () => { await close?.(); });

const paymentRow = async (tenantId: string, id: string) => db.select().from(processedPaymentEvents).where(and(
  eq(processedPaymentEvents.tenantId, tenantId), eq(processedPaymentEvents.id, id),
));

describe('tenant-scoped conflicts', () => {
  it('records both erasure tombstones for the same member and legacy ids without overwriting either', async () => {
    const id = 'member-erasure-shared';
    const original = memberRow(STUDIO, id);
    await db.insert(members).values([memberRow(ACME, id), original]);
    const emailHmac = { compute: (tenantId: string, email: string) => `${tenantId}:${email}` };
    const repo = createMemberErasureRepository(db, emailHmac);
    const tombstone = memberTombstone(id);
    const input = {
      memberId: id, deletedAt: NOW, tombstoneEmail: tombstone.email,
      severedUserId: tombstone.userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY,
    };

    expect(await repo.pseudonymize(ACME, input)).toMatchObject({ alreadyDeleted: false });
    expect(await db.select().from(members).where(and(eq(members.tenantId, STUDIO), eq(members.id, id))))
      .toEqual([expect.objectContaining({ ...original, deletedAt: null })]);
    expect(await repo.pseudonymize(STUDIO, { ...input, deletedAt: LATER }))
      .toMatchObject({ alreadyDeleted: false });
    expect(await repo.pseudonymize(ACME, { ...input, deletedAt: LATER }))
      .toMatchObject({ alreadyDeleted: true });

    for (const tenantId of [ACME, STUDIO]) {
      expect(await db.select().from(erasedMemberImports).where(and(
        eq(erasedMemberImports.tenantId, tenantId), eq(erasedMemberImports.memberId, id),
      ))).toEqual([{
        tenantId, memberId: id, legacyId: id,
        emailHmac: emailHmac.compute(tenantId, memberRow(tenantId, id).email),
        erasedAt: tenantId === ACME ? NOW : LATER,
      }]);
    }
  });

  it('claims the same event and fulfillment object independently while both leases are active', async () => {
    const repo = createProcessedPaymentEventRepository(db);
    const id = 'event-active-shared';
    expect(await repo.claim(ACME, paymentEvent(id, ACME), lease)).toBe('claimed');
    expect(await repo.claim(STUDIO, paymentEvent(id, STUDIO), lease)).toBe('claimed');
    for (const tenantId of [ACME, STUDIO]) {
      expect(await repo.claim(tenantId, paymentEvent(id, tenantId), lease)).toBe('in_progress');
      expect(await repo.claim(tenantId, { ...paymentEvent(id, tenantId), id: `${id}-duplicate` }, lease))
        .toBe('in_progress');
    }
  });

  it('does not take over another tenant expired lease and reclaims only its own row', async () => {
    const repo = createProcessedPaymentEventRepository(db);
    const id = 'event-expired-shared';
    expect(await repo.claim(ACME, paymentEvent(id, ACME), lease)).toBe('claimed');
    const original = await paymentRow(ACME, id);
    const otherLease = { ...nextLease, workerId: 'worker-studio' };
    expect(await repo.claim(STUDIO, paymentEvent(id, STUDIO), otherLease)).toBe('claimed');
    expect(await paymentRow(ACME, id)).toEqual(original);
    const other = await paymentRow(STUDIO, id);
    expect(await repo.claim(ACME, paymentEvent(id, ACME), { ...nextLease, workerId: 'worker-acme' }))
      .toBe('claimed');
    expect(await paymentRow(STUDIO, id)).toEqual(other);
    await repo.finalize(ACME, id, lease.workerId, LATER);
    await repo.release(ACME, id, lease.workerId);
    expect(await paymentRow(ACME, id)).toEqual([expect.objectContaining({
      status: 'processing', workerId: 'worker-acme',
    })]);
  });

  it('scopes finalize and release even when tenants share both event and worker ids', async () => {
    const repo = createProcessedPaymentEventRepository(db);
    const id = 'event-mutations-shared';
    for (const tenantId of [ACME, STUDIO]) {
      expect(await repo.claim(tenantId, paymentEvent(id, tenantId), lease)).toBe('claimed');
    }
    const active = await paymentRow(ACME, id);
    await repo.release(STUDIO, id, lease.workerId);
    expect(await paymentRow(STUDIO, id)).toEqual([]);
    expect(await paymentRow(ACME, id)).toEqual(active);
    expect(await repo.claim(STUDIO, paymentEvent(id, STUDIO), lease)).toBe('claimed');
    const other = await paymentRow(STUDIO, id);
    await repo.finalize(ACME, id, lease.workerId, LATER);
    expect(await paymentRow(STUDIO, id)).toEqual(other);
    const finalized = await paymentRow(ACME, id);
    expect(finalized).toEqual([expect.objectContaining({ status: 'processed', processedAt: LATER })]);
    expect(await repo.claim(ACME, paymentEvent(id, ACME), nextLease)).toBe('processed');
    expect(await repo.claim(ACME, { ...paymentEvent(id, ACME), id: `${id}-duplicate` }, nextLease))
      .toBe('processed');
    await repo.release(STUDIO, id, lease.workerId);
    expect(await paymentRow(STUDIO, id)).toEqual([]);
    expect(await paymentRow(ACME, id)).toEqual(finalized);
    expect(await repo.claim(STUDIO, paymentEvent(id, STUDIO), nextLease)).toBe('claimed');
  });

  it('appends the same member event id in both tenants while preserving per-tenant idempotency', async () => {
    const memberId = 'member-history-shared';
    await db.insert(members).values([memberRow(ACME, memberId), memberRow(STUDIO, memberId)]);
    const repo = createMemberEventRepository(db);
    for (const tenantId of [ACME, STUDIO]) {
      const event: MemberEvent = {
        id: 'member-event-shared', tenantId, memberId, type: 'banned',
        payload: { actorUserId: `${tenantId}-owner`, reason: tenantId }, occurredAt: NOW,
      };
      await repo.append(tenantId, event);
      await repo.append(tenantId, { ...event, payload: { ...event.payload, reason: 'retry' } });
      expect(await repo.listForMember(tenantId, memberId)).toEqual([event]);
    }
    expect(await repo.listForMember(ACME, memberId)).toEqual([expect.objectContaining({
      payload: { actorUserId: `${ACME}-owner`, reason: ACME },
    })]);
  });
});
