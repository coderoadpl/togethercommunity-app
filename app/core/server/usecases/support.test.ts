import { describe, expect, it } from 'vitest';

import { ok, type EmailOutboxPayload, type Identity } from '#core/domain/index.js';

import { sendSupportMessage, type SupportMessageDeps } from './support.js';

const identity: Identity = {
  userId: 'user-1',
  email: 'member@together.dev',
  name: 'Member',
  tenantId: 'tenant-1',
  tenantSlug: 'alpha',
  tenantName: 'Alpha',
  staffRole: null,
  memberId: 'member-1',
};

const harness = (supportEmail: string | null) => {
  const queued: { to: string; payload: EmailOutboxPayload }[] = [];
  const deps: SupportMessageDeps = {
    tenants: {
      findById: async () => null,
      findBySlug: async () => null,
      findSettings: async () => ({
        billingPortalUrl: null,
        bunnyStreamLibraryId: null,
        logoUrl: null,
        accentColor: null,
        faviconUrl: null,
        ogTitle: null,
        ogDescription: null,
        ogImageUrl: null,
        supportEmail,
        supportUrl: null,
        termsUrl: null,
        privacyUrl: null,
      }),
      updateSettings: async (_tenantId, settings) => settings,
      createTenantWithOwnerGrant: async () => {
        throw new Error('not used');
      },
    },
    members: {
      findById: async () => ({
        id: 'member-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        email: 'member@together.dev',
        displayName: 'Marta',
        tags: [],
        marketingConsents: {},
        externalCustomerIds: {},
        createdAt: '2026-07-01T00:00:00.000Z',
        deletedAt: null,
      }),
      findByEmail: async () => null,
      listWithProductIds: async () => [],
      create: async () => undefined,
      updateEmail: async () => null,
    },
    tenantAccess: {
      listTenantsForStaff: async () => [],
      listStaffForTenant: async () => [],
      findStaffGrant: async () => null,
      findMember: async () => null,
    },
    emailOutbox: {
      enqueue: async (message) => {
        queued.push({ to: message.to, payload: message.payload });
        return ok({ id: message.id });
      },
      claimBatch: async () => ok([]),
      markSent: async () => ok(undefined),
      markFailed: async () => ok(undefined),
    },
    ids: { nextId: () => 'mail-1' },
    clock: { nowIso: () => '2026-07-28T10:00:00.000Z' },
    dispatchEmail: () => undefined,
  };
  return { deps, queued };
};

describe('sendSupportMessage', () => {
  it('queues identity-derived sender details to the configured address', async () => {
    const h = harness('support@alpha.test');
    const result = await sendSupportMessage(
      { identity },
      { subject: 'Help', body: 'My claimed email is attacker@example.com' },
      h.deps,
    );

    expect(result).toEqual({ ok: true, value: { queued: true } });
    expect(h.queued).toEqual([
      {
        to: 'support@alpha.test',
        payload: expect.objectContaining({
          kind: 'support-message',
          memberEmail: 'member@together.dev',
          memberDisplay: 'Marta',
        }),
      },
    ]);
  });

  it('reports missing configuration and rejects oversized messages', async () => {
    const missing = harness(null);
    expect(
      await sendSupportMessage({ identity }, { subject: 'Help', body: 'Body' }, missing.deps),
    ).toMatchObject({ ok: false, error: { code: 'integration_not_configured' } });
    const configured = harness('support@alpha.test');
    expect(
      await sendSupportMessage(
        { identity },
        { subject: 'Help', body: 'x'.repeat(5001) },
        configured.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects an authenticated identity without member or staff scope', async () => {
    const h = harness('support@alpha.test');
    expect(
      await sendSupportMessage(
        { identity: { ...identity, memberId: null } },
        { subject: 'Help', body: 'Body' },
        h.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.queued).toEqual([]);
  });

  it('does not send for a deleted member', async () => {
    const h = harness('support@alpha.test');
    const findById = h.deps.members.findById;
    h.deps.members.findById = async (tenantId, memberId) => {
      const member = await findById(tenantId, memberId);
      return member === null ? null : { ...member, deletedAt: '2026-07-28T09:00:00.000Z' };
    };
    expect(
      await sendSupportMessage(
        { identity },
        { subject: 'Help', body: 'Body' },
        h.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.queued).toEqual([]);
  });
});
