import { describe, expect, it, vi } from 'vitest';

import { CAPABILITIES, PRINCIPALS, capabilitiesForPrincipal, signInClientHostsSchema, type Identity } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { createInMemorySignInClientRepository } from '../testing/sign-in-client-fakes.js';
import {
  createSignInClient,
  disableSignInClient,
  listSignInClients,
  rotateSignInClientSecret,
  type SignInClientDeps,
} from './sign-in-clients.js';

const now = '2026-11-27T00:00:00.000Z';
const workspace = 'workspace-a';
const otherWorkspace = 'workspace-b';
const host = 'client.example.org';
const input = { name: 'Example application', redirectUris: [`https://${host}/Callback/a%2Fb`] };
const clientId = `sc_${'A'.repeat(22)}`;
const secret = `tc_sc_${'A'.repeat(43)}`;
const replacement = `tc_sc_${'B'.repeat(42)}A`;

const identity: Identity = {
  userId: 'workspace-owner', email: 'owner@example.org', name: 'Owner', emailVerified: true, image: null,
  tenantAccess: 'staff', tenantId: workspace, tenantSlug: workspace, tenantName: 'Workspace A', staffRole: 'owner',
  staffGrantSource: 'direct', memberId: null, memberDisplayName: null, memberBannedAt: null,
  memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: null,
};
const owner = { identity };

const harness = (setting = `${workspace}=${host}`) => {
  const state = { now };
  const storage = createInMemorySignInClientRepository();
  const generateSecret = vi.fn().mockReturnValueOnce(secret).mockReturnValue(replacement);
  let eventId = 0;
  const deps: SignInClientDeps = {
    signInClients: storage.repo,
    signInClientHosts: signInClientHostsSchema.parse(setting),
    signInClientCrypto: { generateId: () => clientId, generateSecret, hash: (value) => value === secret ? 'initial-digest' : 'replacement-digest' },
    clock: { nowIso: () => state.now },
    ids: { nextId: () => `event-${String(++eventId)}` },
  };
  return { deps, state, storage, generateSecret };
};

const actionWithContext = (ctx: Ctx, deps: SignInClientDeps) => Promise.all([
  createSignInClient(ctx, input, deps),
  listSignInClients(ctx, {}, deps),
  rotateSignInClientSecret(ctx, { id: clientId, expectedCredentialVersion: 1 }, deps),
  disableSignInClient(ctx, { id: clientId }, deps),
]);

const denied: { name: string; ctx: Ctx; code?: string }[] = [
  { name: 'unverified direct owner', ctx: { identity: { ...identity, emailVerified: false } } },
  { name: 'organization-derived owner', ctx: { identity: { ...identity, staffGrantSource: 'organization' } } },
  { name: 'direct admin', ctx: { identity: { ...identity, staffRole: 'admin' } } },
  { name: 'member', ctx: { identity: { ...identity, staffRole: null, memberId: 'member-1', tenantAccess: 'member' } } },
  { name: 'owner without a grant here', ctx: { identity: { ...identity, staffRole: null, tenantAccess: 'none' } } },
  { name: 'explicit capability context', ctx: { identity, capabilities: ['sign-in-client:read', 'sign-in-client:write'] } },
  {
    name: 'impersonated view', code: 'impersonation_read_only', ctx: {
      identity,
      impersonation: {
        id: 'view-1', actorUserId: identity.userId, actorEmail: identity.email, actorName: identity.name,
        actorStaffRole: 'owner', subjectMemberId: 'member-1', subjectName: 'Member', expiresAt: now,
      },
    },
  },
  ...(['direct', 'propose'] as const).map((mode) => ({
    name: `${mode} shop management key`,
    ctx: { identity, capabilities: CAPABILITIES, machineActor: { kind: 'shop_management_key' as const, apiKeyId: 'key-1', mode } },
  })),
  ...PRINCIPALS.filter((p) => p.endsWith('api-key') || p === 'operator-secret').map((principal) => ({
    name: principal, ctx: { identity, capabilities: capabilitiesForPrincipal(principal) },
  })),
];

describe('sign-in client authorization', () => {
  it('grants both capabilities only to the workspace owner role', () => {
    for (const principal of PRINCIPALS) {
      expect(capabilitiesForPrincipal(principal).includes('sign-in-client:read'), principal).toBe(principal === 'owner');
      expect(capabilitiesForPrincipal(principal).includes('sign-in-client:write'), principal).toBe(principal === 'owner');
    }
  });

  it.each(denied)('refuses $name on every operation before accessing storage or minting a secret', async ({ ctx, code = 'forbidden' }) => {
    const h = harness();
    const calls = [vi.spyOn(h.storage.repo, 'create'), vi.spyOn(h.storage.repo, 'list'), vi.spyOn(h.storage.repo, 'findById'),
      vi.spyOn(h.storage.repo, 'rotate'), vi.spyOn(h.storage.repo, 'disable')];
    for (const result of await actionWithContext(ctx, h.deps)) expect(result).toMatchObject({ ok: false, error: { code } });
    for (const call of calls) expect(call).not.toHaveBeenCalled();
    expect(h.generateSecret).not.toHaveBeenCalled();
  });

  it('does not expose a foreign client or let its owner manage it in another workspace', async () => {
    const { deps } = harness();
    const foreignOwner = { identity: { ...identity, userId: 'foreign-owner', tenantId: otherWorkspace } };
    expect(await createSignInClient(owner, input, deps)).toMatchObject({ ok: true });
    expect(await listSignInClients(foreignOwner, {}, deps)).toEqual({ ok: true, value: { clients: [], nextCursor: null } });
    const absent = { ok: false, error: { code: 'not_found', message: 'Sign-in client not found', details: { reason: 'client_not_found' } } };
    for (const id of [clientId, `sc_${'B'.repeat(22)}`]) {
      expect(await rotateSignInClientSecret(foreignOwner, { id, expectedCredentialVersion: 1 }, deps)).toEqual(absent);
      expect(await disableSignInClient(foreignOwner, { id }, deps)).toEqual(absent);
    }
    expect(await createSignInClient(foreignOwner, input, deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason: 'host_not_preapproved' } } });
  });
});

describe('sign-in client lifecycle use-cases', () => {
  it.each([
    { setting: '', reason: 'registry_disabled' },
    { setting: `${otherWorkspace}=${host}`, reason: 'host_not_preapproved' },
    { setting: `${workspace}=other.example.org`, reason: 'host_not_preapproved' },
  ])('requires an exact preapproved pair to create ($reason, $setting)', async ({ setting, reason }) => {
    const h = harness(setting);
    expect(await createSignInClient(owner, input, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason } } });
    expect(h.generateSecret).not.toHaveBeenCalled();
    expect(h.storage.events()).toEqual([]);
  });

  it('allows listing and terminal disable with an empty allow-list, but not rotation', async () => {
    const h = harness();
    expect(await createSignInClient(owner, input, h.deps)).toMatchObject({ ok: true });
    h.deps.signInClientHosts = signInClientHostsSchema.parse(undefined);
    expect(await rotateSignInClientSecret(owner, { id: clientId, expectedCredentialVersion: 1 }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason: 'registry_disabled' } } });
    h.deps.signInClientHosts = signInClientHostsSchema.parse(`${workspace}=other.example.org`);
    expect(await rotateSignInClientSecret(owner, { id: clientId, expectedCredentialVersion: 1 }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason: 'host_not_preapproved' } } });
    h.deps.signInClientHosts = signInClientHostsSchema.parse(undefined);
    expect(await listSignInClients(owner, {}, h.deps)).toMatchObject({ ok: true, value: { clients: [{ id: clientId }], nextCursor: null } });
    expect(await disableSignInClient(owner, { id: clientId }, h.deps)).toMatchObject({ ok: true, value: { state: 'retired' } });
    expect(h.generateSecret).toHaveBeenCalledTimes(1);
  });

  it('issues a new secret once per committed version, scrubs on disable, and preserves the reservation', async () => {
    const h = harness();
    const created = await createSignInClient(owner, input, h.deps);
    expect(created).toMatchObject({ ok: true, value: { secret, client: {
      id: clientId, state: 'pending_activation', credentialVersion: 1, hostVerifiedAt: null, activatedAt: null,
      redirectUris: input.redirectUris, secretExpiresAt: '2027-02-25T00:00:00.000Z',
    } } });
    expect(h.storage.storedHash(workspace, clientId)).toBe('initial-digest');
    expect(await listSignInClients(owner, {}, h.deps)).not.toHaveProperty('value.clients.0.secret');

    h.state.now = '2026-11-28T00:00:00.000Z';
    const versionOne = { id: clientId, expectedCredentialVersion: 1 };
    expect(await rotateSignInClientSecret(owner, versionOne, h.deps)).toMatchObject({ ok: true, value: { secret: replacement, client: {
      credentialVersion: 2, secretRotatedAt: h.state.now, secretExpiresAt: '2027-02-26T00:00:00.000Z',
    } } });
    expect(h.storage.storedHash(workspace, clientId)).toBe('replacement-digest');
    expect(await rotateSignInClientSecret(owner, versionOne, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { reason: 'credential_version_changed' } } });

    const retired = await disableSignInClient(owner, { id: clientId }, h.deps);
    expect(retired).toMatchObject({ ok: true, value: { credentialVersion: 3, state: 'retired', name: null, redirectUris: [], secretExpiresAt: null } });
    expect(h.storage.storedHash(workspace, clientId)).toBeNull();
    h.state.now = '2026-11-29T00:00:00.000Z';
    expect(await disableSignInClient(owner, { id: clientId }, h.deps)).toEqual(retired);
    expect(await rotateSignInClientSecret(owner, { id: clientId, expectedCredentialVersion: 3 }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { reason: 'client_retired' } } });
    expect(await createSignInClient(owner, input, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { reason: 'host_unavailable' } } });
    expect(h.storage.events().map(({ kind, actorKind, credentialVersion }) => [kind, actorKind, credentialVersion])).toEqual([
      ['created', 'direct_owner', 1], ['secret_rotated', 'direct_owner', 2], ['retired', 'direct_owner', 3],
    ]);
    for (const forbidden of [secret, replacement, input.name, input.redirectUris[0], identity.userId, 'initial-digest', 'replacement-digest']) {
      expect(JSON.stringify(h.storage.events())).not.toContain(forbidden);
    }
  });

  it('uses a fixed validation error without any request material', async () => {
    const h = harness();
    expect(await createSignInClient(owner, { name: secret, redirectUris: ['https://client.example.org/?secret=private'] }, h.deps))
      .toEqual({ ok: false, error: { code: 'validation', message: 'Invalid sign-in client request' } });
    expect(h.generateSecret).not.toHaveBeenCalled();
  });
});
