import { describe, expect, it } from 'vitest';

import {
  erasureRequestDueAt,
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
