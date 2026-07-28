import { describe, expect, it } from 'vitest';

import type { Identity, StaffRole, TenantSecret, TenantSecretKey } from '#core/domain/index.js';
import { ok } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { SecretCrypto, TenantSecretRepository } from '../ports.js';
import {
  deleteTenantSecret,
  getTenantSecretsMasked,
  setTenantSecret,
  type TenantSecretDeps,
} from './tenant-secrets.js';

const NOW = '2026-06-01T00:00:00.000Z';

const ctx = (staffRole: StaffRole | null, tenantId: string | null = 't1'): Ctx => ({
  identity: {
    userId: 'u1',
    email: 'owner@together.dev',
    name: 'Owner',
    tenantId,
    tenantSlug: tenantId ? 'acme' : null,
    tenantName: tenantId ? 'Acme' : null,
    staffRole,
    memberId: null,
  } satisfies Identity,
});

const harness = (rows: TenantSecret[] = []): { deps: TenantSecretDeps; rows: TenantSecret[] } => {
  const store = [...rows];
  let seq = 0;
  const tenantSecrets: TenantSecretRepository = {
    listByTenant: async (tenantId) => store.filter((r) => r.tenantId === tenantId),
    findByKey: async (tenantId, key) =>
      store.find((r) => r.tenantId === tenantId && r.key === key) ?? null,
    upsert: async (tenantId, secret) => {
      const index = store.findIndex((r) => r.tenantId === tenantId && r.key === secret.key);
      const stored = { ...secret, tenantId };
      if (index >= 0) store[index] = stored;
      else store.push(stored);
      return stored;
    },
    delete: async (tenantId, key) => {
      const index = store.findIndex((r) => r.tenantId === tenantId && r.key === key);
      if (index < 0) return false;
      store.splice(index, 1);
      return true;
    },
  };
  const secretCrypto: SecretCrypto = {
    encrypt: (plaintext) => ({ ciphertext: `cipher:${plaintext}`, iv: 'iv', authTag: 'tag' }),
    decrypt: (input) => ok(input.ciphertext.replace(/^cipher:/, '')),
  };
  return {
    rows: store,
    deps: {
      tenantSecrets,
      secretCrypto,
      ids: { nextId: () => `secret-${(seq += 1)}` },
      clock: { nowIso: () => NOW },
    },
  };
};

const row = (key: TenantSecretKey): TenantSecret => ({
  id: `id-${key}`,
  tenantId: 't1',
  key,
  ciphertext: `cipher:value-${key}`,
  iv: 'iv',
  authTag: 'tag',
  maskedPreview: '••••2345',
  updatedAt: NOW,
});

describe('setTenantSecret', () => {
  it('requires the declared tenant secret write capability', async () => {
    const h = harness();
    expect(await setTenantSecret(
      { ...ctx('owner'), capabilities: ['tenant:secret:read'] },
      { key: 'stripe.restrictedKey', value: 'rk_live_abcd12345' },
      h.deps,
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('lets the owner store a secret and returns only a masked view', async () => {
    const h = harness();
    const result = await setTenantSecret(
      ctx('owner'),
      { key: 'stripe.restrictedKey', value: 'rk_live_abcd12345' },
      h.deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maskedPreview).toBe('••••2345');
    expect(result.value.key).toBe('stripe.restrictedKey');
    expect(JSON.stringify(result.value)).not.toContain('rk_live_abcd12345');
    expect(JSON.stringify(result.value)).not.toContain('cipher:');
    expect(h.rows[0]?.ciphertext).toBe('cipher:rk_live_abcd12345');
  });

  it('forbids an admin from storing a secret', async () => {
    const h = harness();
    const result = await setTenantSecret(
      ctx('admin'),
      { key: 'stripe.restrictedKey', value: 'rk_live_abcd12345' },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.rows).toHaveLength(0);
  });

  it('rejects a blank value', async () => {
    const h = harness();
    const result = await setTenantSecret(ctx('owner'), { key: 'stripe.webhookSecret', value: '  ' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('requires a selected tenant', async () => {
    const h = harness();
    const result = await setTenantSecret(
      ctx('owner', null),
      { key: 'stripe.restrictedKey', value: 'rk_live_abcd12345' },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});

describe('getTenantSecretsMasked', () => {
  it('lets an admin read masked secrets without ciphertext', async () => {
    const h = harness([row('stripe.restrictedKey'), row('stripe.webhookSecret')]);
    const result = await getTenantSecretsMasked(ctx('admin'), h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(JSON.stringify(result.value)).not.toContain('cipher:');
    expect(Object.keys(result.value[0] ?? {}).sort()).toEqual(['key', 'maskedPreview', 'updatedAt']);
  });

  it('forbids a non-staff caller', async () => {
    const h = harness([row('stripe.restrictedKey')]);
    const result = await getTenantSecretsMasked(ctx(null), h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('deleteTenantSecret', () => {
  it('lets the owner delete a secret', async () => {
    const h = harness([row('stripe.restrictedKey')]);
    const result = await deleteTenantSecret(ctx('owner'), 'stripe.restrictedKey', h.deps);
    expect(result).toMatchObject({ ok: true, value: { key: 'stripe.restrictedKey' } });
    expect(h.rows).toHaveLength(0);
  });

  it('is not found for an unknown key', async () => {
    const h = harness();
    const result = await deleteTenantSecret(ctx('owner'), 'stripe.webhookSecret', h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('forbids an admin from deleting', async () => {
    const h = harness([row('stripe.restrictedKey')]);
    const result = await deleteTenantSecret(ctx('admin'), 'stripe.restrictedKey', h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
