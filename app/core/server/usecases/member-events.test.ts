import { describe, expect, it } from 'vitest';

import type { Identity, Member, MemberEvent } from '#core/domain/index.js';
import type { MemberEventRepository, MemberRepository } from '../ports.js';

import { listMemberTimeline } from './member-events.js';

const identity = (tenantId: string | null): Identity => ({
  userId: 'owner-1',
  email: 'owner@example.test',
  name: 'Owner',
  tenantId,
  tenantSlug: tenantId === null ? null : 'acme',
  tenantName: tenantId === null ? null : 'Acme',
  staffRole: tenantId === null ? null : 'owner',
  memberId: null,
  memberBannedAt: null,
});

const member: Member = {
  id: 'member-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  email: 'member@example.test',
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: '2026-08-01T10:00:00.000Z',
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
};

const event: MemberEvent = {
  id: 'purchase:order-1',
  tenantId: 'tenant-1',
  memberId: member.id,
  type: 'purchase',
  payload: {
    orderId: 'order-1',
    productId: 'product-1',
    kind: 'one_time',
    status: 'paid',
    amountCents: 4900,
    currency: 'PLN',
    provider: 'stripe',
  },
  occurredAt: '2026-08-02T10:00:00.000Z',
};

const members: MemberRepository = {
  findById: async (tenantId, memberId) =>
    tenantId === member.tenantId && memberId === member.id ? member : null,
  findByEmail: async () => null,
  listWithProductIds: async () => [],
  create: async () => undefined,
  updateEmail: async () => null,
  setBanned: async () => null,
};

describe('listMemberTimeline', () => {
  it('returns the one tenant-scoped merged event stream', async () => {
    const calls: Array<[string, string]> = [];
    const memberEvents: MemberEventRepository = {
      append: async () => undefined,
      listForMember: async (tenantId, memberId) => {
        calls.push([tenantId, memberId]);
        return [event];
      },
    };
    const result = await listMemberTimeline(
      { identity: identity('tenant-1') },
      { memberId: member.id },
      { members, memberEvents },
    );

    expect(result).toEqual({ ok: true, value: [event] });
    expect(calls).toEqual([['tenant-1', 'member-1']]);
  });

  it('does not query another tenant or an unknown member', async () => {
    let queried = false;
    const memberEvents: MemberEventRepository = {
      append: async () => undefined,
      listForMember: async () => {
        queried = true;
        return [];
      },
    };
    const result = await listMemberTimeline(
      { identity: identity('tenant-2') },
      { memberId: member.id },
      { members, memberEvents },
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(queried).toBe(false);
  });
});
