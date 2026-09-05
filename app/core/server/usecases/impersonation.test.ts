import { describe, expect, it } from 'vitest';

import type {
  Identity,
  ImpersonationPrincipal,
  ImpersonationSession,
  Member,
  TenantAuditEventInput,
} from '#core/domain/index.js';

import type { AuthenticatedUser, ImpersonationSessionRepository, MemberRepository, TenantAuditEventRepository } from '../ports.js';
import {
  listTenantAuditEvents,
  resolveImpersonation,
  startImpersonation,
  stopImpersonation,
  sweepLapsedImpersonations,
  type ImpersonationDeps,
} from './impersonation.js';

const NOW = '1998-08-14T10:00:00.000Z';
const TENANT = 'tenant-1';

const staffIdentity: Identity = {
  userId: 'user-owner',
  email: 'owner@example.test',
  name: 'Owner',
  emailVerified: true,
  image: null,
  tenantId: TENANT,
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
};

const member: Member = {
  id: 'member-1',
  tenantId: TENANT,
  userId: 'user-member',
  email: 'member@example.test',
  displayName: 'Kasia',
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: NOW,
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
  dmOptOutAt: null,
};

const actorUser: AuthenticatedUser = {
  sessionId: 'session-1',
  userId: 'user-owner',
  email: 'owner@example.test',
  name: 'Owner',
  emailVerified: true,
  image: null,
};

interface Harness {
  deps: ImpersonationDeps;
  sessions: Map<string, ImpersonationSession & { tokenHash: string }>;
  audit: TenantAuditEventInput[];
}

const harness = (overrides: { members?: Partial<MemberRepository>; now?: () => string } = {}): Harness => {
  const sessions = new Map<string, ImpersonationSession & { tokenHash: string }>();
  const audit: TenantAuditEventInput[] = [];
  let nextId = 0;

  const impersonations: ImpersonationSessionRepository = {
    open: async (tenantId, session, tokenHash, appendAudit) => {
      const superseded = [...sessions.values()].filter(
        (candidate) => candidate.tenantId === tenantId
          && candidate.actorSessionId === session.actorSessionId
          && candidate.endedAt === null,
      );
      for (const previous of superseded) {
        sessions.set(previous.id, { ...previous, endedAt: session.createdAt });
      }
      sessions.set(session.id, { ...session, tenantId, tokenHash });
      audit.push(
        ...appendAudit(superseded.map((previous) => ({ ...previous, endedAt: session.createdAt }))),
      );
    },
    findById: async (tenantId, id) => {
      const found = sessions.get(id);
      return found !== undefined && found.tenantId === tenantId ? found : null;
    },
    end: async (tenantId, id, endedAt, appendAudit) => {
      const found = sessions.get(id);
      if (found === undefined || found.tenantId !== tenantId || found.endedAt !== null) return null;
      const ended = { ...found, endedAt };
      sessions.set(id, ended);
      audit.push(appendAudit(ended));
      return ended;
    },
    endLapsed: async (tenantId, now, appendAudit) => {
      const lapsed = [...sessions.values()].filter(
        (session) => session.tenantId === tenantId
          && session.endedAt === null
          && Date.parse(session.expiresAt) <= Date.parse(now),
      );
      for (const session of lapsed) {
        sessions.set(session.id, { ...session, endedAt: session.expiresAt });
      }
      audit.push(...appendAudit(lapsed.map((session) => ({
        session: { ...session, endedAt: session.expiresAt },
        actorEmail: staffIdentity.email,
      }))));
      return lapsed.length;
    },
    listLapsedTenantIds: async (now) => [
      ...new Set(
        [...sessions.values()]
          .filter(
            (session) => session.endedAt === null
              && Date.parse(session.expiresAt) <= Date.parse(now),
          )
          .map((session) => session.tenantId),
      ),
    ],
  };

  const auditEvents: TenantAuditEventRepository = {
    record: async () => undefined,
    list: async (tenantId, query) => {
      const matching = audit
        .filter((event) => event.tenantId === tenantId)
        .reverse()
        .map((event) => ({ ...event, subjectLabel: member.displayName }));
      return { events: matching.slice(0, query.limit), nextCursor: null };
    },
  };

  const members: MemberRepository = {
    findById: async (_tenantId, memberId) => (memberId === member.id ? member : null),
    findByEmail: async () => null,
    listWithProductIds: async () => [],
    create: async () => undefined,
    updateEmail: async () => null,
    updateDisplayName: async () => null,
    updateLanguage: async () => null,
    updateVideoAutoplay: async () => null,
    updateDmOptOut: async () => null,
    setBanned: async () => null,
    ...overrides.members,
  };

  return {
    sessions,
    audit,
    deps: {
      impersonations,
      auditEvents,
      members,
      tokens: {
        issue: (sessionId) => ({ token: `t:${sessionId}`, tokenHash: `h:${sessionId}` }),
        verify: (token) =>
          token.startsWith('t:')
            ? { sessionId: token.slice(2), tokenHash: `h:${token.slice(2)}` }
            : null,
      },
      ids: { nextId: () => `id-${String((nextId += 1))}` },
      clock: { nowIso: overrides.now ?? (() => NOW) },
    },
  };
};

const start = async (h: Harness) =>
  startImpersonation(
    { identity: staffIdentity },
    { memberId: member.id, reason: 'support', actorSessionId: actorUser.sessionId },
    h.deps,
  );

describe('startImpersonation', () => {
  it('issues a one-hour session bound to the acting login and logs the start', async () => {
    const h = harness();
    const started = await start(h);

    expect(started).toMatchObject({ ok: true });
    if (!started.ok) throw new Error('start failed');
    expect(started.value.token).toMatch(/^t:/);
    const [session] = [...h.sessions.values()];
    expect(session).toMatchObject({
      tenantId: TENANT,
      actorUserId: 'user-owner',
      actorSessionId: 'session-1',
      subjectMemberId: member.id,
      createdAt: NOW,
      expiresAt: '1998-08-14T11:00:00.000Z',
      endedAt: null,
    });
    expect(h.audit).toMatchObject([
      {
        kind: 'impersonation_started',
        actorUserId: 'user-owner',
        subjectMemberId: member.id,
        reason: 'support',
      },
    ]);
  });

  it('refuses a member without the capability', async () => {
    const h = harness();
    const result = await startImpersonation(
      { identity: { ...staffIdentity, staffRole: null, memberId: 'member-9' } },
      { memberId: member.id, reason: null, actorSessionId: 'session-1' },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.sessions.size).toBe(0);
  });

  it('refuses an unknown or deleted member', async () => {
    const h = harness({ members: { findById: async () => ({ ...member, deletedAt: NOW }) } });
    expect(await start(h)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses to nest a second view inside an active one', async () => {
    const h = harness();
    const principal: ImpersonationPrincipal = {
      id: 'imp-1',
      actorUserId: 'user-owner',
      actorEmail: 'owner@example.test',
      actorName: 'Owner',
      actorStaffRole: 'owner',
      subjectMemberId: member.id,
      subjectName: 'Kasia',
      expiresAt: '1998-08-14T11:00:00.000Z',
    };
    const result = await startImpersonation(
      { identity: { ...staffIdentity, staffRole: null, memberId: member.id }, impersonation: principal },
      { memberId: member.id, reason: null, actorSessionId: 'session-1' },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'impersonation_read_only' } });
  });

  it('ends and logs a record left open by the same acting login', async () => {
    const h = harness();
    await start(h);
    await start(h);

    expect([...h.sessions.values()].filter((session) => session.endedAt === null)).toHaveLength(1);
    expect(h.audit.map((event) => event.kind)).toEqual([
      'impersonation_started',
      'impersonation_ended',
      'impersonation_started',
    ]);
  });
});

describe('resolveImpersonation', () => {
  const resolveWith = async (h: Harness, token: string, user: AuthenticatedUser = actorUser) =>
    resolveImpersonation({ user, identity: staffIdentity }, token, h.deps);

  it('resolves the subject for reads while carrying the actor identity', async () => {
    const h = harness();
    const started = await start(h);
    if (!started.ok) throw new Error('start failed');

    const resolved = await resolveWith(h, started.value.token);
    expect(resolved?.identity).toMatchObject({
      userId: member.userId,
      memberId: member.id,
      staffRole: null,
      tenantId: TENANT,
    });
    expect(resolved?.principal).toMatchObject({
      actorUserId: 'user-owner',
      actorStaffRole: 'owner',
      subjectMemberId: member.id,
    });
  });

  it('refuses a forged, ended, expired, or foreign-session token', async () => {
    const h = harness();
    const started = await start(h);
    if (!started.ok) throw new Error('start failed');
    const { token } = started.value;

    expect(await resolveWith(h, 'forged')).toBeNull();
    expect(await resolveWith(h, token, { ...actorUser, sessionId: 'session-2' })).toBeNull();
    expect(await resolveWith(h, token, { ...actorUser, userId: 'user-other' })).toBeNull();

    let clock = NOW;
    const expired = harness({ now: () => clock });
    await start(expired);
    clock = '1998-08-14T11:00:01.000Z';
    const expiredSessionId = [...expired.sessions.keys()][0] ?? '';
    expect(await resolveWith(expired, `t:${expiredSessionId}`)).toBeNull();

    const live = await resolveWith(h, token);
    if (live === null) throw new Error('resolve failed');
    await stopImpersonation({ identity: live.identity, impersonation: live.principal }, h.deps);
    expect(await resolveWith(h, token)).toBeNull();
  });

  it('closes the audit trail at the expiry instant when a lapsed view is rejected', async () => {
    let clock = NOW;
    const h = harness({ now: () => clock });
    const started = await start(h);
    if (!started.ok) throw new Error('start failed');
    clock = '1998-08-14T11:00:01.000Z';

    expect(await resolveWith(h, started.value.token)).toBeNull();
    expect(await resolveWith(h, started.value.token)).toBeNull();
    expect(h.audit).toMatchObject([
      { kind: 'impersonation_started' },
      { kind: 'impersonation_ended', at: '1998-08-14T11:00:00.000Z', reason: 'support' },
    ]);
  });
});

describe('stopImpersonation', () => {
  it('ends the record once and logs the exit', async () => {
    const h = harness();
    const started = await start(h);
    if (!started.ok) throw new Error('start failed');
    const resolved = await resolveImpersonation(
      { user: actorUser, identity: staffIdentity },
      started.value.token,
      h.deps,
    );
    if (resolved === null) throw new Error('resolve failed');
    const ctx = { identity: resolved.identity, impersonation: resolved.principal };

    expect(await stopImpersonation(ctx, h.deps)).toEqual({ ok: true, value: { ended: true } });
    expect(await stopImpersonation(ctx, h.deps)).toEqual({ ok: true, value: { ended: false } });
    expect(h.audit.map((event) => event.kind)).toEqual([
      'impersonation_started',
      'impersonation_ended',
    ]);
  });

  it('reports nothing to end for a plain staff session', async () => {
    const h = harness();
    expect(await stopImpersonation({ identity: staffIdentity }, h.deps)).toEqual({
      ok: true,
      value: { ended: false },
    });
  });
});

describe('listTenantAuditEvents', () => {
  it('returns the tenant trail newest first for staff and refuses members', async () => {
    const h = harness();
    await start(h);

    const listed = await listTenantAuditEvents({ identity: staffIdentity }, { limit: 25 }, h.deps);
    expect(listed).toMatchObject({
      ok: true,
      value: { events: [{ kind: 'impersonation_started' }], nextCursor: null },
    });
    expect(
      await listTenantAuditEvents(
        { identity: { ...staffIdentity, staffRole: null, memberId: member.id } },
        { limit: 25 },
        h.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('closes a view abandoned past its expiry before serving the trail', async () => {
    let clock = NOW;
    const h = harness({ now: () => clock });
    await start(h);
    clock = '1998-08-14T12:00:00.000Z';

    const listed = await listTenantAuditEvents({ identity: staffIdentity }, { limit: 25 }, h.deps);

    expect(listed).toMatchObject({
      ok: true,
      value: {
        events: [
          { kind: 'impersonation_ended', at: '1998-08-14T11:00:00.000Z' },
          { kind: 'impersonation_started' },
        ],
      },
    });
    expect([...h.sessions.values()].every((session) => session.endedAt !== null)).toBe(true);
  });

  it('stays out of reach from inside the member view', async () => {
    const h = harness();
    const started = await start(h);
    if (!started.ok) throw new Error('start failed');
    const resolved = await resolveImpersonation(
      { user: actorUser, identity: staffIdentity },
      started.value.token,
      h.deps,
    );
    if (resolved === null) throw new Error('resolve failed');

    expect(
      await listTenantAuditEvents(
        { identity: resolved.identity, impersonation: resolved.principal },
        { limit: 25 },
        h.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'impersonation_read_only' } });
  });
});

describe('sweepLapsedImpersonations', () => {
  it('closes every tenant view left open past its expiry without a request', async () => {
    let clock = NOW;
    const h = harness({ now: () => clock });
    await start(h);
    clock = '1998-08-14T12:00:00.000Z';

    expect(await sweepLapsedImpersonations(h.deps)).toMatchObject({ ok: true, value: { ended: 1 } });
    expect(h.audit.at(-1)).toMatchObject({
      kind: 'impersonation_ended',
      at: '1998-08-14T11:00:00.000Z',
    });
    expect(await sweepLapsedImpersonations(h.deps)).toMatchObject({ ok: true, value: { ended: 0 } });
  });

  it('leaves a live view untouched', async () => {
    const h = harness();
    await start(h);

    expect(await sweepLapsedImpersonations(h.deps)).toMatchObject({ ok: true, value: { ended: 0 } });
    expect([...h.sessions.values()].every((session) => session.endedAt === null)).toBe(true);
  });

  it('reports a repository failure instead of throwing into the scheduler', async () => {
    const h = harness();
    const failing = {
      ...h.deps,
      impersonations: {
        ...h.deps.impersonations,
        listLapsedTenantIds: async () => {
          throw new Error('connection lost');
        },
      },
    };

    expect(await sweepLapsedImpersonations(failing)).toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'connection lost' },
    });
  });
});
