import { describe, expect, it } from 'vitest';

import { operatorCtx, operatorIdentity, operatorTenantHarness } from '../testing/operator-tenant-fakes.js';
import { provisionTenant } from './provision-tenant.js';
import { createTenant } from './create-tenant.js';
import { getOperatorTenantReadiness } from './operator-tenant-readiness.js';

const input = { slug: ' Acme ', name: 'Acme', ownerEmail: ' OWNER@EXAMPLE.TEST ', defaultLanguage: 'en' as const };

describe('operator tenant provisioning', () => {
  it('creates the tenant, owner grant and audit together and retries without changing them', async () => {
    const h = operatorTenantHarness();
    const first = await provisionTenant(operatorCtx, input, h.deps);
    expect(first).toMatchObject({ ok: true, value: {
      tenant: { id: 'id-1', slug: 'acme', name: 'Acme' }, created: true, ownerUserId: 'owner-1',
      readiness: { tenantExists: true, ownerGrantPresent: true, stripeConfigured: false },
    } });
    const second = await provisionTenant(operatorCtx, { ...input, name: 'Changed', defaultLanguage: 'pl' }, h.deps);
    expect(second).toMatchObject({ ok: true, value: { tenant: { name: 'Acme' }, created: false } });
    expect(h.tenants).toHaveLength(1);
    expect(h.tenants[0]).toMatchObject({ defaultLanguage: 'en' });
    expect(h.owners.size).toBe(1);
    expect(h.audits).toMatchObject([{ kind: 'tenant_provisioned', actorUserId: 'operator-secret', tenantId: 'id-1' }]);
    expect(h.state.ownerEmails).toEqual(['owner@example.test', 'owner@example.test']);
    expect(h.state.creationOptions).toEqual([
      { requireEmpty: false, idempotentOwner: true }, { requireEmpty: false, idempotentOwner: true },
    ]);
  });

  it('provisions a further workspace for the verified owner idempotently while bootstrap self-service stays closed', async () => {
    const h = operatorTenantHarness();
    const first = await provisionTenant(operatorCtx, input, h.deps);
    if (!first.ok) throw new Error(first.error.message);
    const existingTenant = structuredClone(h.tenants[0]);
    const existingAudit = structuredClone(h.audits[0]);
    const further = { slug: 'studio', name: 'Studio', ownerEmail: 'owner@example.test', defaultLanguage: 'en' as const };
    const ownerCtx = { identity: {
      ...operatorIdentity, userId: first.value.ownerUserId, email: further.ownerEmail,
      tenantAccess: 'staff' as const, tenantId: first.value.tenant.id,
      tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner' as const,
    } };

    expect(await createTenant(ownerCtx, further, { ...h.deps, tenantCreationMode: 'bootstrap' })).toMatchObject({
      ok: false, error: { code: 'forbidden', message: 'Tenant creation is closed after the first workspace' },
    });
    expect(h.tenants).toEqual([existingTenant]);
    const second = await provisionTenant(operatorCtx, further, h.deps);
    expect(second).toMatchObject({ ok: true, value: {
      created: true, ownerUserId: first.value.ownerUserId,
      tenant: { slug: 'studio', name: 'Studio' }, readiness: { ownerGrantPresent: true },
    } });
    if (!second.ok) throw new Error(second.error.message);
    expect(second.value.tenant.id).not.toBe(first.value.tenant.id);
    const tenantsBeforeReplay = structuredClone(h.tenants);
    const auditsBeforeReplay = structuredClone(h.audits);
    expect(await provisionTenant(operatorCtx, { ...further, name: 'Akademia', defaultLanguage: 'pl' }, h.deps))
      .toMatchObject({ ok: true, value: { created: false, tenant: second.value.tenant } });
    expect(h.tenants).toEqual(tenantsBeforeReplay);
    expect(h.tenants).toHaveLength(2);
    expect(h.tenants[0]).toEqual(existingTenant);
    expect(h.audits).toEqual(auditsBeforeReplay);
    expect(h.audits).toHaveLength(2);
    expect(h.audits[0]).toEqual(existingAudit);
    expect([...h.owners.entries()]).toEqual([
      [first.value.tenant.id, first.value.ownerUserId], [second.value.tenant.id, first.value.ownerUserId],
    ]);
  });

  it('refuses a slug belonging to another owner', async () => {
    const h = operatorTenantHarness();
    await provisionTenant(operatorCtx, input, h.deps);
    h.state.owner.userId = 'other-owner';
    expect(await provisionTenant(operatorCtx, input, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.owners.get('id-1')).toBe('owner-1');
    expect(h.audits).toHaveLength(1);
  });

  it.each(['unknown', 'unverified'])('conceals whether the owner is %s', async (kind) => {
    const h = operatorTenantHarness();
    h.state.ownerExists = kind !== 'unknown';
    h.state.owner.emailVerified = kind !== 'unverified';
    expect(await provisionTenant(operatorCtx, input, h.deps)).toEqual({ ok: false, error: {
      code: 'validation', message: 'Owner account not found or not verified',
    } });
    expect(h.tenants).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it.each([
    [{ ...input, slug: 'api' }, 'slug_reserved'],
    [{ ...input, slug: 'a b' }, 'validation'],
    [{ ...input, name: 'x'.repeat(101) }, 'validation'],
  ] as const)('rejects invalid provisioning input', async (value, code) => {
    const h = operatorTenantHarness();
    expect(await provisionTenant(operatorCtx, value, h.deps)).toMatchObject({ ok: false, error: { code } });
    expect(h.state.calls).toBe(0);
  });

  it.each(['owner', 'admin', 'member', 'authenticated'] as const)('denies session %s before any database access', async (role) => {
    const h = operatorTenantHarness();
    const ctx = { identity: {
      ...operatorIdentity, staffRole: role === 'owner' || role === 'admin' ? role : null,
      memberId: role === 'member' ? 'member-1' : null,
    } };
    expect(await provisionTenant(ctx, input, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await getOperatorTenantReadiness(ctx, { slug: 'acme' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.state.calls).toBe(0);
  });
});


it('keeps owner failure generic when verification changes before the transaction', async () => {
  const h = operatorTenantHarness();
  h.deps.tenants.createTenantWithOwnerGrant = async () => {
    h.state.owner.emailVerified = false;
    return null;
  };
  expect(await provisionTenant(operatorCtx, input, h.deps)).toMatchObject({ ok: false, error: {
    code: 'validation', message: 'Owner account not found or not verified',
  } });
  expect(h.tenants).toEqual([]);
});
