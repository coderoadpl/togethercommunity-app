import { describe, expect, it } from 'vitest';

import {
  erasureRequestDueAt,
  err,
  integrationUnavailable,
  ok,
  type Member,
  type MemberErasureRequest,
  type MemberErasureRequestEvent,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  MemberErasureRequestRepository,
  MemberRepository,
} from '../ports.js';
import {
  cancelMyErasureRequest,
  getMyErasureRequest,
  requestMyErasure,
  type MemberErasureRequestDeps,
} from './member-erasure-requests.js';

const now = '1998-07-29T10:00:00.000Z';
const member: Member = {
  id: 'member-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  email: 'member@example.com',
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: now,
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
};

const context = (kind: 'member' | 'staff'): Ctx => ({
  identity: {
    userId: kind === 'member' ? 'user-1' : 'staff-1',
    email: kind === 'member' ? member.email : 'staff@example.com',
    name: kind,
    tenantId: 'tenant-1',
    tenantSlug: 'acme',
    tenantName: 'Acme',
    staffRole: kind === 'staff' ? 'admin' : null,
    memberId: kind === 'member' ? member.id : null,
    memberBannedAt: null,
  },
});

const harness = (selectedMember: Member | null = member) => {
  let request: MemberErasureRequest | null = null;
  const events: MemberErasureRequestEvent[] = [];
  const repository: MemberErasureRequestRepository = {
    create: async (_tenantId, value, event) => {
      if (request?.status === 'open') return 'already-open';
      request = value;
      events.push(event);
      return 'created';
    },
    findOpenForMember: async (_tenantId, memberId) =>
      request?.memberId === memberId && request.status === 'open' ? request : null,
    findLatestForMember: async () => request,
    list: async () => [],
    resolve: async (_tenantId, input, event) => {
      if (request === null || request.id !== input.id || request.status !== 'open') {
        return null;
      }
      request = {
        ...request,
        status: input.status,
        resolvedAt: input.resolvedAt,
        resolvedByUserId: input.resolvedByUserId,
        resolutionNote: input.resolutionNote,
      };
      events.push(event);
      return request;
    },
  };
  const members: MemberRepository = {
    findById: async () => selectedMember,
    findByEmail: async () => null,
    listWithProductIds: async () => [],
    create: async () => undefined,
    updateEmail: async () => null,
    setBanned: async () => null,
  };
  let sequence = 0;
  const deps: MemberErasureRequestDeps = {
    members,
    erasureRequests: repository,
    ids: { nextId: () => `id-${String(++sequence)}` },
    clock: { nowIso: () => now },
  };
  return { deps, events, getRequest: () => request };
};

describe('member erasure requests', () => {
  it('calculates the controller deadline at 30 days', () => {
    expect(erasureRequestDueAt(now)).toBe('1998-08-28T10:00:00.000Z');
  });

  it('validates the confirmation e-mail', async () => {
    const h = harness();
    const result = await requestMyErasure(
      context('member'),
      { confirmEmail: 'wrong@example.com' },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('forbids staff without a member identity', async () => {
    const h = harness();
    const result = await requestMyErasure(
      context('staff'),
      { confirmEmail: member.email },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('rejects a second open request', async () => {
    const h = harness();
    await requestMyErasure(context('member'), { confirmEmail: member.email }, h.deps);
    const second = await requestMyErasure(
      context('member'),
      { confirmEmail: member.email },
      h.deps,
    );
    expect(second).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('queues staff notifications with the tenant panel URL', async () => {
    const h = harness();
    const queued: Array<{ to: string; payload: unknown }> = [];
    let dispatched = 0;
    h.deps.notifications = {
      tenants: {
        findById: async () => null,
        findBySlug: async () => null,
        findSole: async () => null,
        findSettings: async () => null,
        updateSettings: async (_tenantId, settings) => settings,
        createTenantWithOwnerGrant: async () => {
          throw new Error('not used');
        },
      },
      tenantAccess: {
        listTenantsForStaff: async () => [],
        listStaffForTenant: async () => [
          { userId: 'staff-1', email: 'first@example.com' },
          { userId: 'staff-2', email: 'second@example.com' },
        ],
        findStaffGrant: async () => null,
        findMember: async () => null,
      },
      emailOutbox: {
        enqueue: async (input) => {
          queued.push({ to: input.to, payload: input.payload });
          return ok({ id: input.id });
        },
        claimBatch: async () => ok([]),
        markSent: async () => ok(undefined),
        markFailed: async () => ok(undefined),
      },
      appBaseUrl: 'https://app.example.com',
      baseDomain: 'example.com',
      singleTenantMode: false,
      dispatchEmail: () => {
        dispatched += 1;
      },
    };

    await expect(
      requestMyErasure(
        context('member'),
        { confirmEmail: member.email },
        h.deps,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(queued).toEqual([
      {
        to: 'first@example.com',
        payload: expect.objectContaining({
          kind: 'member-erasure-request',
          memberEmail: member.email,
          requestedAt: now,
          dueAt: erasureRequestDueAt(now),
          panelUrl: 'https://acme.example.com/panel/members',
        }),
      },
      {
        to: 'second@example.com',
        payload: expect.objectContaining({
          kind: 'member-erasure-request',
          panelUrl: 'https://acme.example.com/panel/members',
        }),
      },
    ]);
    expect(dispatched).toBe(1);
  });

  it('keeps the durable request successful when notification enqueue fails', async () => {
    const h = harness();
    h.deps.notifications = {
      tenants: {
        findById: async () => null,
        findBySlug: async () => null,
        findSole: async () => null,
        findSettings: async () => null,
        updateSettings: async (_tenantId, settings) => settings,
        createTenantWithOwnerGrant: async () => {
          throw new Error('not used');
        },
      },
      tenantAccess: {
        listTenantsForStaff: async () => [],
        listStaffForTenant: async () => [
          { userId: 'staff-1', email: 'staff@example.com' },
        ],
        findStaffGrant: async () => null,
        findMember: async () => null,
      },
      emailOutbox: {
        enqueue: async () => err(integrationUnavailable('outbox unavailable')),
        claimBatch: async () => ok([]),
        markSent: async () => ok(undefined),
        markFailed: async () => ok(undefined),
      },
      appBaseUrl: 'https://app.example.com',
      baseDomain: 'example.com',
      singleTenantMode: false,
      dispatchEmail: () => undefined,
    };

    await expect(
      requestMyErasure(
        context('member'),
        { confirmEmail: member.email },
        h.deps,
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: 'open' } });
    expect(h.getRequest()).toMatchObject({ status: 'open' });
  });

  it('cancels only the signed-in member open request', async () => {
    const h = harness();
    await requestMyErasure(context('member'), { confirmEmail: member.email }, h.deps);
    const result = await cancelMyErasureRequest(context('member'), h.deps);
    expect(result).toMatchObject({
      ok: true,
      value: { status: 'cancelled', memberId: member.id },
    });
    expect(h.events.map((event) => event.type)).toEqual(['requested', 'cancelled']);
  });

  it('reads only the signed-in member request in the resolved tenant', async () => {
    const h = harness();
    await requestMyErasure(context('member'), { confirmEmail: member.email }, h.deps);
    const calls: Array<{ tenantId: string; memberId: string }> = [];
    const findLatest = h.deps.erasureRequests.findLatestForMember;
    h.deps.erasureRequests.findLatestForMember = async (tenantId, memberId) => {
      calls.push({ tenantId, memberId });
      return findLatest(tenantId, memberId);
    };
    expect(await getMyErasureRequest(context('member'), h.deps)).toMatchObject({
      ok: true,
      value: { memberId: member.id, status: 'open' },
    });
    expect(calls).toEqual([{ tenantId: 'tenant-1', memberId: member.id }]);
  });

  it('forbids requester-side reads without a member identity', async () => {
    expect(await getMyErasureRequest(context('staff'), harness().deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('hides requests for a tombstoned member', async () => {
    const h = harness({ ...member, deletedAt: now });
    const result = await requestMyErasure(
      context('member'),
      { confirmEmail: member.email },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
