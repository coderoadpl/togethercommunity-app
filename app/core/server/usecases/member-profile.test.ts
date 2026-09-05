import { describe, expect, it } from 'vitest';

import type { Language, Member } from '#core/domain/index.js';

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
  dmOptOutAt: null,
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
    memberDmOptOutAt: null,
    memberLanguage: null,
    memberVideoAutoplay: false,
    ...overrides,
  },
});

const harness = (stored: Member | null = member) => {
  const calls: Array<{ tenantId: string; memberId: string; displayName: string | null }> = [];
  const optOutCalls: Array<string | null> = [];
  const languageCalls: Array<Language | null> = [];
  const autoplayCalls: boolean[] = [];
  let current = stored;
  const members: MemberRepository = {
    findById: async () => current,
    findByEmail: async () => null,
    listWithProductIds: async () => [],
    create: async () => undefined,
    updateEmail: async () => null,
    updateLanguage: async (_tenantId, _memberId, language) => {
      languageCalls.push(language);
      current = current === null ? null : { ...current, language };
      return current;
    },
    updateDisplayName: async (tenantId, memberId, displayName) => {
      calls.push({ tenantId, memberId, displayName });
      current = current === null ? null : { ...current, displayName };
      return current;
    },
    updateVideoAutoplay: async (_tenantId, _memberId, videoAutoplay) => {
      autoplayCalls.push(videoAutoplay);
      current = current === null ? null : { ...current, videoAutoplay };
      return current;
    },
    updateDmOptOut: async (_tenantId, _memberId, dmOptOutAt) => {
      optOutCalls.push(dmOptOutAt);
      current = current === null ? null : { ...current, dmOptOutAt };
      return current;
    },
    setBanned: async () => null,
  };
  return {
    calls,
    optOutCalls,
    languageCalls,
    autoplayCalls,
    deps: { members, clock: { nowIso: () => now } },
  };
};

describe('updateMyProfile', () => {
  it('writes the tenant-scoped display name for the acting member', async () => {
    const { calls, deps } = harness();

    await expect(updateMyProfile(context(), { displayName: 'Ada L.' }, deps)).resolves.toEqual({
      ok: true,
      value: { displayName: 'Ada L.', dmOptOut: false, language: null, videoAutoplay: false },
    });
    expect(calls).toEqual([
      { tenantId: 'tenant-1', memberId: 'member-1', displayName: 'Ada L.' },
    ]);
  });

  it('clears the override when the display name is null', async () => {
    const { calls, deps } = harness({ ...member, displayName: 'Ada L.' });

    await expect(updateMyProfile(context(), { displayName: null }, deps)).resolves.toEqual({
      ok: true,
      value: { displayName: null, dmOptOut: false, language: null, videoAutoplay: false },
    });
    expect(calls[0]?.displayName).toBeNull();
  });

  it('leaves the stored display name untouched when the update omits it', async () => {
    const { calls, deps } = harness({ ...member, displayName: 'Ada L.' });

    await expect(updateMyProfile(context(), { language: 'en' }, deps)).resolves.toEqual({
      ok: true,
      value: { displayName: 'Ada L.', dmOptOut: false, language: 'en', videoAutoplay: false },
    });
    expect(calls).toEqual([]);
  });

  it('records and clears the direct-message opt-out beside the display name', async () => {
    const { optOutCalls, deps } = harness();

    await expect(
      updateMyProfile(context(), { displayName: 'Ada L.', dmOptOut: true }, deps),
    ).resolves.toEqual({ ok: true, value: { displayName: 'Ada L.', dmOptOut: true, language: null, videoAutoplay: false } });
    await expect(
      updateMyProfile(context(), { displayName: 'Ada L.', dmOptOut: false }, deps),
    ).resolves.toEqual({ ok: true, value: { displayName: 'Ada L.', dmOptOut: false, language: null, videoAutoplay: false } });
    expect(optOutCalls).toEqual([now, null]);
  });

  it('stores the e-mail language preference the member picked', async () => {
    const { languageCalls, deps } = harness();

    await expect(
      updateMyProfile(context(), { displayName: 'Ada L.', language: 'en' }, deps),
    ).resolves.toEqual({ ok: true, value: { displayName: 'Ada L.', dmOptOut: false, language: 'en', videoAutoplay: false } });
    expect(languageCalls).toEqual(['en']);
  });

  it('clears the stored language back to the tenant default', async () => {
    const { languageCalls, deps } = harness();

    await expect(
      updateMyProfile(context(), { displayName: 'Ada L.', language: null }, deps),
    ).resolves.toEqual({ ok: true, value: { displayName: 'Ada L.', dmOptOut: false, language: null, videoAutoplay: false } });
    expect(languageCalls).toEqual([null]);
  });

  it('leaves the stored language untouched when the update omits it', async () => {
    const { languageCalls, deps } = harness();

    await updateMyProfile(context(), { displayName: 'Ada L.' }, deps);
    expect(languageCalls).toEqual([]);
  });

  it('stores the video autoplay preference the member picked', async () => {
    const { autoplayCalls, deps } = harness();

    await expect(
      updateMyProfile(context(), { videoAutoplay: true }, deps),
    ).resolves.toEqual({
      ok: true,
      value: { displayName: null, dmOptOut: false, language: null, videoAutoplay: true },
    });
    await expect(
      updateMyProfile(context(), { videoAutoplay: false }, deps),
    ).resolves.toEqual({
      ok: true,
      value: { displayName: null, dmOptOut: false, language: null, videoAutoplay: false },
    });
    expect(autoplayCalls).toEqual([true, false]);
  });

  it('leaves the stored video autoplay preference untouched when the update omits it', async () => {
    const { autoplayCalls, deps } = harness();

    await updateMyProfile(context(), { displayName: 'Ada L.' }, deps);
    expect(autoplayCalls).toEqual([]);
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
