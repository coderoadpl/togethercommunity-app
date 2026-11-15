import { describe, expect, it } from 'vitest';

import { ok, type Identity, type Organization, type OrganizationSecretKey } from '#core/domain/index.js';

import { organizationContext } from '../organization-context.js';
import type { SecretCrypto } from '../ports.js';
import { createOrganizationFakes } from '../testing/organization-fakes.js';

import { deleteOrganizationSecret, listOrganizationSecrets, setOrganizationSecret } from './organization-secrets.js';

const at = '2026-11-15T12:00:00.000Z';
const organization: Organization = {
  id: 'org-1', slug: 'holding', name: 'Organization holding', status: 'active', maxWorkspaces: 2, createdAt: at, updatedAt: at,
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

const harness = async () => {
  const fakes = createOrganizationFakes([], [
    { id: 'acme', slug: 'acme', name: 'Acme', status: 'active', organizationId: 'org-1', grants: [] },
    { id: 'studio', slug: 'studio', name: 'Studio', status: 'active', organizationId: null, grants: [] },
  ]);
  const { organizations, organizationMembers } = fakes.repositories;
  await organizations.create(organization);
  await organizationMembers.add('org-1', { id: 'm-1', userId: 'owner-1', role: 'owner', createdAt: at, createdByUserId: 'operator' });
  await organizationMembers.add('org-1', { id: 'm-2', userId: 'admin-1', role: 'admin', createdAt: at, createdByUserId: 'owner-1' });
  let next = 0;
  const deps = { ...fakes.repositories, secretCrypto, ids: { nextId: () => `id-${++next}` }, clock: { nowIso: () => at } };
  const octx = async (userId: string) => {
    const built = await organizationContext({ identity: identity(userId) }, 'org-1', deps);
    if (!built.ok) throw new Error(built.error.message);
    return built.value;
  };
  return { ...fakes, deps, octx };
};

describe('organization secrets', () => {
  it('stores an allow-listed secret encrypted and lists only masked previews to owners and admins', async () => {
    const h = await harness();
    const owner = await h.octx('owner-1');
    expect(await setOrganizationSecret(owner, { organizationId: 'org-1', key: 'ifirma.invoiceApiKey', value: ' invoice-secret-abcd ' }, h.deps)).toEqual({
      ok: true, value: { secret: { key: 'ifirma.invoiceApiKey', maskedPreview: '••••abcd', updatedAt: at } },
    });
    expect(h.secretRows).toEqual([{
      id: 'id-2', organizationId: 'org-1', key: 'ifirma.invoiceApiKey', ciphertext: 'cipher:invoice-secret-abcd', iv: 'iv-value',
      authTag: 'tag-value', maskedPreview: '••••abcd', updatedAt: at,
    }]);
    for (const userId of ['owner-1', 'admin-1']) {
      const listed = await listOrganizationSecrets(await h.octx(userId), { organizationId: 'org-1' }, h.deps);
      expect(listed).toEqual({ ok: true, value: { secrets: [{ key: 'ifirma.invoiceApiKey', maskedPreview: '••••abcd', updatedAt: at }] } });
      expect(JSON.stringify(listed)).not.toMatch(/cipher|iv-value|tag-value|invoice-secret/);
    }
    expect(h.auditRows).toEqual([{
      id: 'id-1', organizationId: 'org-1', kind: 'secret.set', actorUserId: 'owner-1', actorEmail: 'owner-1@example.test',
      actorKeyId: null, subjectTenantId: null, subjectUserId: null,
      data: { key: 'ifirma.invoiceApiKey', group: 'invoicing' }, at,
    }]);
  });

  it('masks a value shorter than twelve characters completely in the response, the stored row and the audit row', async () => {
    const h = await harness();
    const owner = await h.octx('owner-1');
    const values: ReadonlyArray<readonly [OrganizationSecretKey, string]> = [['smtp.port', '2525'], ['smtp.password', 'a7Q!'], ['smtp.user', 'mailer-1234']];
    for (const [key, value] of values) {
      expect(await setOrganizationSecret(owner, { organizationId: 'org-1', key, value }, h.deps), key)
        .toEqual({ ok: true, value: { secret: { key, maskedPreview: '••••', updatedAt: at } } });
    }
    const listed = await listOrganizationSecrets(owner, { organizationId: 'org-1' }, h.deps);
    expect(listed).toEqual({ ok: true, value: { secrets: ['smtp.password', 'smtp.port', 'smtp.user'].map((key) => ({ key, maskedPreview: '••••', updatedAt: at })) } });
    expect(h.secretRows.map((row) => [row.key, row.maskedPreview])).toEqual([
      ['smtp.port', '••••'], ['smtp.password', '••••'], ['smtp.user', '••••'],
    ]);
    await deleteOrganizationSecret(owner, { organizationId: 'org-1', key: 'smtp.password' }, h.deps);
    expect(h.auditRows.map((event) => [event.kind, event.data])).toEqual([
      ['secret.set', { key: 'smtp.port', group: 'email_transport' }],
      ['secret.set', { key: 'smtp.password', group: 'email_transport' }],
      ['secret.set', { key: 'smtp.user', group: 'email_transport' }],
      ['secret.deleted', { key: 'smtp.password', group: 'email_transport' }],
    ]);
  });

  it('shows only the last four characters of a value of at least twelve characters', async () => {
    const h = await harness();
    const owner = await h.octx('owner-1');
    expect(await setOrganizationSecret(owner, { organizationId: 'org-1', key: 'smtp.password', value: 'Pa55word-xyz' }, h.deps))
      .toMatchObject({ ok: true, value: { secret: { maskedPreview: '••••-xyz' } } });
    expect(h.secretRows.map((row) => row.maskedPreview)).toEqual(['••••-xyz']);
    expect(JSON.stringify(h.auditRows)).not.toContain('xyz');
  });

  it('rejects keys outside the allow-list and the dedicated-flow keys through the generic setter', async () => {
    const h = await harness();
    const owner = await h.octx('owner-1');
    for (const key of ['stripe.restrictedKey', 'stripe.testRestrictedKey', 'telemetry.mongodb'] as const) {
      const result = await setOrganizationSecret(owner, { organizationId: 'org-1', key, value: 'rk_live_secret-1234' }, h.deps);
      expect(result, key).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(h.secretRows).toEqual([]);
    expect(h.auditRows).toEqual([]);
  });

  it('refuses writes to an admin and answers not_found to a non-member', async () => {
    const h = await harness();
    const admin = await h.octx('admin-1');
    expect(await setOrganizationSecret(admin, { organizationId: 'org-1', key: 'smtp.password', value: 'smtp-secret' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await deleteOrganizationSecret(admin, { organizationId: 'org-1', key: 'smtp.password' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const outsider = await h.octx('outsider');
    expect(await listOrganizationSecrets(outsider, { organizationId: 'org-1' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses to delete a secret while a workspace of the organization takes its group from the organization', async () => {
    const h = await harness();
    const owner = await h.octx('owner-1');
    await setOrganizationSecret(owner, { organizationId: 'org-1', key: 'shipx.token', value: 'shipx-token-9876' }, h.deps);
    await setOrganizationSecret(owner, { organizationId: 'org-1', key: 'resend.apiKey', value: 're_secret_4321' }, h.deps);
    h.configSourceRows.push(
      { tenantId: 'acme', group: 'shipping_carrier', source: 'organization', updatedAt: at, updatedByUserId: 'owner-1' },
      { tenantId: 'studio', group: 'email_transport', source: 'organization', updatedAt: at, updatedByUserId: 'owner-1' },
    );

    expect(await deleteOrganizationSecret(owner, { organizationId: 'org-1', key: 'shipx.token' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.secretRows.map((row) => row.key)).toEqual(['shipx.token', 'resend.apiKey']);

    expect(await deleteOrganizationSecret(owner, { organizationId: 'org-1', key: 'resend.apiKey' }, h.deps))
      .toEqual({ ok: true, value: { key: 'resend.apiKey' } });
    expect(await deleteOrganizationSecret(owner, { organizationId: 'org-1', key: 'resend.apiKey' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });

    h.configSourceRows.splice(0, 1);
    expect(await deleteOrganizationSecret(owner, { organizationId: 'org-1', key: 'shipx.token' }, h.deps))
      .toEqual({ ok: true, value: { key: 'shipx.token' } });
    expect(h.secretRows).toEqual([]);
    expect(h.auditRows.filter((event) => event.kind === 'secret.deleted').map((event) => event.data)).toEqual([
      { key: 'resend.apiKey', group: 'email_transport' },
      { key: 'shipx.token', group: 'shipping_carrier' },
    ]);
  });
});
