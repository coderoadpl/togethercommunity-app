import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  ImpersonationSession,
  TenantAuditEvent,
  TenantAuditEventInput,
} from '#core/domain/index.js';

import type { Db } from './client.js';
import {
  createImpersonationSessionRepository,
  createTenantAuditEventRepository,
} from './impersonation.js';
import { tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const TENANT = 'tenant-imp';
const TRAIL_TENANT = 'tenant-imp-trail';
const ACTOR = 'user-actor';
const ACTOR_EMAIL = 'operator@example.test';

const sessionAt = (
  id: string,
  createdAt: string,
  expiresAt: string,
  overrides: Partial<ImpersonationSession> = {},
): ImpersonationSession => ({
  id,
  tenantId: TENANT,
  actorUserId: ACTOR,
  actorSessionId: 'login-1',
  subjectMemberId: 'member-1',
  reason: 'support',
  createdAt,
  expiresAt,
  endedAt: null,
  ...overrides,
});

let nextEventId = 0;

const auditEvent = (
  kind: TenantAuditEvent['kind'],
  session: ImpersonationSession,
  at: string,
  id?: string,
): TenantAuditEventInput => ({
  id: id ?? `auto-event-${String((nextEventId += 1))}`,
  tenantId: session.tenantId,
  kind,
  actorUserId: session.actorUserId,
  actorEmail: ACTOR_EMAIL,
  subjectMemberId: session.subjectMemberId,
  reason: session.reason,
  at,
});

describe('impersonation repositories', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase('together_impersonation', baseDatabaseUrl));
    await db.insert(tenants).values([
      { id: TENANT, slug: 'imp', name: 'Imp', createdAt: '2026-09-01T10:00:00.000Z' },
      { id: TRAIL_TENANT, slug: 'imp-trail', name: 'Imp trail', createdAt: '2026-09-01T10:00:00.000Z' },
    ]);
    await db.insert(user).values({
      id: ACTOR,
      name: 'Operator',
      email: ACTOR_EMAIL,
    });
  });

  afterAll(async () => {
    await close();
  });

  it('keeps one live view per acting login when two starts race', async () => {
    const repository = createImpersonationSessionRepository(db);
    const first = sessionAt('race-a', '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z');
    const second = sessionAt('race-b', '2026-09-01T10:00:01.000Z', '2026-09-01T11:00:01.000Z');
    const supersededBy = new Map<string, string[]>();
    const open = (session: ImpersonationSession, tokenHash: string) =>
      repository.open(TENANT, session, tokenHash, (superseded) => {
        supersededBy.set(session.id, superseded.map((row) => row.id));
        return [
          ...superseded.map((row) => auditEvent('impersonation_ended', row, session.createdAt)),
          auditEvent('impersonation_started', session, session.createdAt),
        ];
      });

    await Promise.all([open(first, 'hash-a'), open(second, 'hash-b')]);

    expect([...supersededBy.values()].filter((ids) => ids.length === 0)).toHaveLength(1);
    const survivors = await Promise.all([
      repository.findById(TENANT, first.id),
      repository.findById(TENANT, second.id),
    ]);
    expect(survivors.filter((row) => row?.endedAt === null)).toHaveLength(1);
  });

  it('closes a lapsed view at its expiry and names the actor', async () => {
    const repository = createImpersonationSessionRepository(db);
    const lapsed = sessionAt('lapsed-1', '2026-09-01T08:00:00.000Z', '2026-09-01T09:00:00.000Z');
    await repository.open(TENANT, lapsed, 'hash-lapsed', (superseded) => [
      ...superseded.map((row) => auditEvent('impersonation_ended', row, lapsed.createdAt)),
      auditEvent('impersonation_started', lapsed, lapsed.createdAt),
    ]);
    let actorEmails: string[] = [];
    const endLapsed = () =>
      repository.endLapsed(TENANT, '2026-09-01T12:00:00.000Z', (rows) => {
        actorEmails = rows.map((row) => row.actorEmail);
        return rows.map((row) =>
          auditEvent('impersonation_ended', row.session, row.session.expiresAt));
      });

    expect(await repository.listLapsedTenantIds('2026-09-01T12:00:00.000Z')).toEqual([TENANT]);
    expect(await endLapsed()).toBe(1);
    expect(actorEmails).toEqual([ACTOR_EMAIL]);
    expect(await repository.findById(TENANT, lapsed.id)).toMatchObject({
      endedAt: '2026-09-01T09:00:00.000Z',
    });
    expect(await endLapsed()).toBe(0);
    expect(await repository.listLapsedTenantIds('2026-09-01T12:00:00.000Z')).toEqual([]);
  });

  it('walks the audit trail backwards through its cursor', async () => {
    const sessions = createImpersonationSessionRepository(db);
    const trail = createTenantAuditEventRepository(db);
    for (const index of [1, 2, 3]) {
      const at = `2026-09-0${String(index)}T10:00:00.000Z`;
      const session = sessionAt(`trail-${String(index)}`, at, `2026-09-0${String(index)}T11:00:00.000Z`, {
        tenantId: TRAIL_TENANT,
        actorSessionId: `login-trail-${String(index)}`,
      });
      await sessions.open(TRAIL_TENANT, session, `hash-trail-${String(index)}`, () => [
        auditEvent('impersonation_started', session, at, `event-${String(index)}`),
      ]);
    }

    const first = await trail.list(TRAIL_TENANT, { limit: 2 });
    expect(first.events.map((event) => event.id)).toEqual(['event-3', 'event-2']);
    expect(first.nextCursor).not.toBeNull();

    const second = await trail.list(TRAIL_TENANT, {
      limit: 2,
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
    });
    expect(second.events.map((event) => event.id)).toEqual(['event-1']);
    expect(second.nextCursor).toBeNull();
  });
});
