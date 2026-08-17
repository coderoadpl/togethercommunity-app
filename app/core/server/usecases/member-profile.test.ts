import { describe, expect, it } from 'vitest';

import type { Member } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { MemberRepository } from '../ports.js';
import { updateMyProfile } from './member-profile.js';

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

const context = (overrides: Partial<Ctx['identity']> = {}): Ctx => ({
  identity: {
    userId: 'user-1',
    email: member.email,
    name: 'Member',
    emailVerified: true,
    tenantId: 'tenant-1',
    tenantSlug: 'acme',
    tenantName: 'Acme',
    staffRole: null,
    memberId: member.id,
    image: null,
    memberDisplayName: null,
    memberBannedAt: null,
    ...overrides,
  },
});

const harness = (stored: Member | null = member) => {
  const calls: Array<{ tenantId: string; memberId: string; displayName: string | null }> = [];
  const members: MemberRepository = {
    findById: async () => stored,
    findByEmail: async () => null,
    listWithProductIds: async () => [],
    create: async () => undefined,
    updateEmail: async () => null,
    updateDisplayName: async (tenantId, memberId, displayName) => {
      calls.push({ tenantId, memberId, displayName });
      return stored === null ? null : { ...stored, displayName };
    },
    setBanned: async () => null,
  };
  return { calls, deps: { members } };
};

describe('updateMyProfile', () => {
  it('writes the tenant-scoped display name for the acting member', async () => {
    const { calls, deps } = harness();

    await expect(updateMyProfile(context(), { displayName: 'Ada L.' }, deps)).resolves.toEqual({
      ok: true,
      value: { displayName: 'Ada L.' },
    });
    expect(calls).toEqual([
      { tenantId: 'tenant-1', memberId: 'member-1', displayName: 'Ada L.' },
    ]);
  });

  it('clears the override when the display name is null', async () => {
    const { calls, deps } = harness({ ...member, displayName: 'Ada L.' });

    await expect(updateMyProfile(context(), { displayName: null }, deps)).resolves.toEqual({
      ok: true,
      value: { displayName: null },
    });
    expect(calls[0]?.displayName).toBeNull();
  });

  it('refuses an identity without a tenant', async () => {
    const { calls, deps } = harness();
    const result = await updateMyProfile(
      context({ tenantId: null, tenantSlug: null, tenantName: null }),
      { displayName: 'Ada L.' },
      deps,
    );

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses staff without a member row in the tenant', async () => {
    const { calls, deps } = harness();
    const result = await updateMyProfile(
      context({ staffRole: 'admin', memberId: null }),
      { displayName: 'Ada L.' },
      deps,
    );

    expect(result.ok ? null : result.error.code).toBe('forbidden');
    expect(calls).toEqual([]);
  });

  it('refuses a banned member', async () => {
    const { calls, deps } = harness();
    const result = await updateMyProfile(
      context({ memberBannedAt: now }),
      { displayName: 'Ada L.' },
      deps,
    );

    expect(result.ok ? null : result.error.code).toBe('banned');
    expect(calls).toEqual([]);
  });

  it('reports not found when the member row belongs to another tenant', async () => {
    const { calls, deps } = harness(null);
    const result = await updateMyProfile(context(), { displayName: 'Ada L.' }, deps);

    expect(result.ok ? null : result.error.code).toBe('not_found');
    expect(calls).toEqual([
      { tenantId: 'tenant-1', memberId: 'member-1', displayName: 'Ada L.' },
    ]);
  });
});
