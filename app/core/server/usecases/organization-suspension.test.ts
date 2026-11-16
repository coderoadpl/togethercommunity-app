import { describe, expect, it } from 'vitest';

import { ok, type AppError, type Identity, type Organization, type Result } from '#core/domain/index.js';

import type { Ctx, OrganizationCtx } from '../context.js';
import { organizationContext } from '../organization-context.js';
import type { SecretCrypto } from '../ports.js';
import { createOrganizationFakes } from '../testing/organization-fakes.js';

import { addOrganizationMember, removeOrganizationMember, setOrganizationMemberRole } from './organization-members.js';
import { deleteOrganizationSecret, listOrganizationSecrets, setOrganizationSecret } from './organization-secrets.js';
import {
  getWorkspaceConfigSources,
  linkOrganizationWorkspace,
  listOrganizationWorkspaces,
  unlinkOrganizationWorkspace,
  unlinkWorkspaceFromOrganization,
} from './organization-workspaces.js';
import { getOrganization, listOrganizationAuditEvents, listOrganizationMembers, updateOrganization } from './organizations.js';

const at = '2026-11-15T12:00:00.000Z';
const organizationId = 'org-1';
const suspendedRefusal = {
  ok: false, error: { code: 'forbidden', message: 'This organization is suspended; only reads are allowed until it is reactivated' },
};
const organization: Organization = {
  id: organizationId, slug: 'holding', name: 'Organization holding', status: 'active', maxWorkspaces: 5, createdAt: at, updatedAt: at,
};

const identity = (userId: string): Identity => ({
  userId, email: `${userId}@example.test`, name: userId, emailVerified: true, image: null,
  tenantAccess: 'none', tenantId: null, tenantSlug: null, tenantName: null, staffRole: null, memberId: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const secretCrypto: SecretCrypto = {
  encrypt: (plaintext) => ({ ciphertext: `cipher:${plaintext}`, iv: 'iv-value', authTag: 'tag-value' }),
  decrypt: (input) => ok(input.ciphertext.replace('cipher:', '')),
};

const harness = () => {
  const fakes = createOrganizationFakes([
    { userId: 'owner-1', email: 'owner-1@example.test', emailVerified: true },
    { userId: 'admin-1', email: 'admin-1@example.test', emailVerified: true },
    { userId: 'candidate', email: 'candidate@example.test', emailVerified: true },
  ], [
    { id: 'acme', slug: 'acme', name: 'Workspace acme', status: 'active', organizationId, grants: [{ userId: 'owner-1', role: 'owner' }] },
    { id: 'studio', slug: 'studio', name: 'Workspace studio', status: 'active', organizationId: null, grants: [{ userId: 'owner-1', role: 'owner' }] },
    { id: 'akademia', slug: 'akademia', name: 'Workspace akademia', status: 'active', organizationId, grants: [{ userId: 'outsider', role: 'owner' }] },
  ]);
  fakes.organizationRows.push({ ...organization });
  fakes.memberRows.push(
    { organizationId: organizationId, id: 'm-1', userId: 'owner-1', role: 'owner', createdAt: at, createdByUserId: 'operator' },
    { organizationId: organizationId, id: 'm-2', userId: 'admin-1', role: 'admin', createdAt: at, createdByUserId: 'owner-1' },
  );
  let next = 0;
  const deps = {
    ...fakes.repositories, authPort: fakes.authPort, secretCrypto, ids: { nextId: () => `id-${++next}` }, clock: { nowIso: () => at },
  };
  const octx = async (userId: string) => {
    const built = await organizationContext({ identity: identity(userId) }, organizationId, deps);
    if (!built.ok) throw new Error(built.error.message);
    return built.value;
  };
  const setStatus = (status: Organization['status']) => {
    for (const row of fakes.organizationRows) if (row.id === organizationId) row.status = status;
  };
  const workspaceOwnerCtx = (userId: string, tenantId: string): Ctx => ({
    identity: {
      ...identity(userId), tenantAccess: 'staff', tenantId, tenantSlug: tenantId, tenantName: `Workspace ${tenantId}`,
      staffRole: 'owner', staffGrantSource: 'direct',
    },
  });
  const snapshot = () => JSON.stringify({
    organizations: fakes.organizationRows,
    members: fakes.memberRows,
    secrets: fakes.secretRows,
    settings: [...fakes.settingsRows],
    links: fakes.workspaceRows.map(({ id, organizationId: linked }) => [id, linked]),
    audit: fakes.auditRows,
    tenantAudit: fakes.tenantAuditRows,
  });
  return { ...fakes, deps, octx, setStatus, workspaceOwnerCtx, snapshot };
};

type Harness = Awaited<ReturnType<typeof harness>>;

const writes = (h: Harness, owner: OrganizationCtx): Array<[string, () => Promise<Result<unknown, AppError>>]> => [
  ['update', () => updateOrganization(owner, { organizationId, update: { legalName: 'Holding Ltd' } }, h.deps)],
  ['member add', () => addOrganizationMember(owner, { organizationId, email: 'candidate@example.test', role: 'admin' }, h.deps)],
  ['member role', () => setOrganizationMemberRole(owner, { organizationId, email: 'admin-1@example.test', role: 'owner' }, h.deps)],
  ['member remove', () => removeOrganizationMember(owner, { organizationId, email: 'admin-1@example.test' }, h.deps)],
  ['secret set', () => setOrganizationSecret(owner, { organizationId, key: 'ifirma.invoiceApiKey', value: 'invoice-secret-wxyz' }, h.deps)],
  ['secret delete', () => deleteOrganizationSecret(owner, { organizationId, key: 'ifirma.invoiceApiKey' }, h.deps)],
  ['workspace link', () => linkOrganizationWorkspace(owner, { organizationId, tenantId: 'studio' }, h.deps)],
  ['workspace unlink', () => unlinkOrganizationWorkspace(owner, { organizationId, tenantId: 'acme' }, h.deps)],
];

const reads = (h: Harness, octx: OrganizationCtx): Array<[string, () => Promise<Result<unknown, AppError>>]> => [
  ['organization', () => getOrganization(octx, { organizationId }, h.deps)],
  ['members', () => listOrganizationMembers(octx, { organizationId }, h.deps)],
  ['workspaces', () => listOrganizationWorkspaces(octx, { organizationId }, h.deps)],
  ['sources', () => getWorkspaceConfigSources(octx, { organizationId, tenantId: 'acme' }, h.deps)],
  ['secrets', () => listOrganizationSecrets(octx, { organizationId }, h.deps)],
  ['audit', () => listOrganizationAuditEvents(octx, { organizationId, limit: 25 }, h.deps)],
];

describe('suspended organization', () => {
  it('refuses every organization write without a change and keeps every read open to owners and admins', async () => {
    const h = harness();
    expect(await setOrganizationSecret(await h.octx('owner-1'), { organizationId, key: 'ifirma.invoiceApiKey', value: 'invoice-secret-abcd' }, h.deps))
      .toMatchObject({ ok: true });
    h.setStatus('suspended');
    const before = h.snapshot();

    for (const [label, write] of writes(h, await h.octx('owner-1'))) {
      expect(await write(), label).toEqual(suspendedRefusal);
    }
    expect(h.snapshot()).toBe(before);

    for (const userId of ['owner-1', 'admin-1']) {
      for (const [label, read] of reads(h, await h.octx(userId))) {
        expect(await read(), `${userId} ${label}`).toMatchObject({ ok: true });
      }
    }
    expect(await getOrganization(await h.octx('admin-1'), { organizationId }, h.deps))
      .toMatchObject({ ok: true, value: { organization: { status: 'suspended' }, role: 'admin' } });
    expect(await listOrganizationSecrets(await h.octx('admin-1'), { organizationId }, h.deps)).toEqual({
      ok: true, value: { secrets: [{ key: 'ifirma.invoiceApiKey', maskedPreview: '••••abcd', updatedAt: at }] },
    });
  });

  it('refuses a write whose context was built before the organization was suspended', async () => {
    const h = harness();
    const owner = await h.octx('owner-1');
    h.setStatus('suspended');
    const before = h.snapshot();

    for (const [label, write] of writes(h, owner)) {
      expect(await write(), label).toEqual(suspendedRefusal);
    }
    expect(h.snapshot()).toBe(before);
  });

  it('accepts the same writes again once the organization is reactivated', async () => {
    const h = harness();
    h.setStatus('suspended');
    h.setStatus('active');

    for (const [label, write] of writes(h, await h.octx('owner-1'))) {
      expect(await write(), label).toMatchObject({ ok: true });
    }
    expect(h.memberRows.map(({ userId, role }) => [userId, role])).toEqual([['owner-1', 'owner'], ['candidate', 'admin']]);
    expect(h.workspaceRows.map(({ id, organizationId: linked }) => [id, linked]))
      .toEqual([['acme', null], ['studio', organizationId], ['akademia', organizationId]]);
  });

  it('lets a direct workspace owner take the workspace out of a suspended organization', async () => {
    const h = harness();
    h.setStatus('suspended');
    expect(await unlinkWorkspaceFromOrganization(h.workspaceOwnerCtx('outsider', 'akademia'), h.deps)).toEqual({
      ok: true, value: { workspace: { id: 'akademia', slug: 'akademia', name: 'Workspace akademia', status: 'active' }, changed: true },
    });
    expect(h.workspaceRows.find(({ id }) => id === 'akademia')?.organizationId).toBeNull();
  });
});
