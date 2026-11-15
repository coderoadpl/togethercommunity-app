import { describe, expect, it } from 'vitest';

import {
  ok,
  SHOP_MANAGEMENT_KEY_SECRET_KEYS,
  shopIntegrationSecretInputSchema,
  shopIntegrationSecretKeySchema,
  type Identity,
  type TenantSecret,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';

import { deleteShopIntegrationSecret, getShopIntegrationSecrets, setShopIntegrationSecret } from './shop-integrations.js';
import type { TenantSecretDeps } from './tenant-secrets.js';

const owner: Identity = {
  userId: 'user-1',
  email: 'owner@example.test',
  name: 'Owner',
  emailVerified: true,
  image: null,
  tenantAccess: 'staff',
  tenantId: 'tenant-1',
  tenantSlug: 'alpha',
  tenantName: 'Alpha',
  staffRole: 'owner',
  memberId: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
};

const keyCtx = (capabilities: Ctx['capabilities']): Ctx => ({
  identity: owner,
  ...(capabilities === undefined ? {} : { capabilities }),
  machineActor: { kind: 'shop_management_key', apiKeyId: 'key-1' },
});

const harness = () => {
  const rows = new Map<string, TenantSecret>();
  const deleted: string[] = [];
  const deps: TenantSecretDeps & { appBaseUrl: string; baseDomain: string; singleTenantMode: boolean } = {
    tenantSecrets: {
      listByTenant: async () => [...rows.values()],
      findByKey: async (_tenantId, key) => rows.get(key) ?? null,
      upsert: async (_tenantId, secret) => {
        rows.set(secret.key, secret);
        return secret;
      },
      upsertMany: async (_tenantId, secrets) => [...secrets],
      delete: async (_tenantId, key) => {
        deleted.push(key);
        return rows.delete(key);
      },
    },
    secretCrypto: {
      encrypt: (value) => ({ ciphertext: value, iv: 'iv', authTag: 'tag' }),
      decrypt: (secret) => ok(secret.ciphertext),
    },
    ids: { nextId: () => 'secret-1' },
    clock: { nowIso: () => '2026-11-15T10:00:00.000Z' },
    appBaseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    singleTenantMode: false,
  };
  return { deps, rows, deleted };
};

describe('shop integration secret use-cases', () => {
  it('allows exactly the iFirma and KSeF credential keys of the shop management key allow-list', () => {
    expect(shopIntegrationSecretKeySchema.options).toBe(SHOP_MANAGEMENT_KEY_SECRET_KEYS);
    expect(shopIntegrationSecretKeySchema.options).toEqual([
      'ifirma.invoiceApiKey', 'ifirma.username', 'ksef.token', 'ksef.contextNip', 'ksef.test.token', 'ksef.test.contextNip',
    ]);
  });

  it.each(SHOP_MANAGEMENT_KEY_SECRET_KEYS.filter((key) => !key.endsWith('contextNip')))(
    'lets a key ctx holding only the secret write capability set and delete %s past the allow-list guard',
    async (key) => {
      const { deps, rows, deleted } = harness();
      const ctx = keyCtx(['tenant:secret:write']);
      expect(await setShopIntegrationSecret(ctx, { key, value: 'credential-5678' }, deps)).toMatchObject({ ok: true, value: { key } });
      expect(await deleteShopIntegrationSecret(ctx, key, deps)).toEqual({ ok: true, value: { key } });
      expect(rows.size).toBe(0);
      expect(deleted).toEqual([key]);
    },
  );

  it('stores an allow-listed credential and returns only its masked preview', async () => {
    const { deps, rows } = harness();
    const result = await setShopIntegrationSecret(keyCtx(['tenant:secret:write']), { key: 'ifirma.username', value: ' seller-login ' }, deps);
    expect(result).toEqual({ ok: true, value: { key: 'ifirma.username', maskedPreview: '••••ogin', updatedAt: '2026-11-15T10:00:00.000Z' } });
    expect(rows.get('ifirma.username')?.ciphertext).toBe('seller-login');
  });

  it('rejects keys outside the allow-list and a NIP with a wrong checksum', async () => {
    const { deps, rows } = harness();
    const ctx = keyCtx(['tenant:secret:write']);
    for (const key of ['stripe.restrictedKey', 'shipx.token', 's3.configuration', 'telemetry.mongodb', 'unknown.key']) {
      expect(shopIntegrationSecretInputSchema.safeParse({ key, value: 'override' }).success, key).toBe(false);
      expect(await deleteShopIntegrationSecret(ctx, key, deps), key).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(await setShopIntegrationSecret(ctx, { key: 'ksef.contextNip', value: '1234567890' }, deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await setShopIntegrationSecret(ctx, { key: 'ksef.test.contextNip', value: '12345' }, deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(rows.size).toBe(0);
  });

  it('needs the secret capabilities of the key', async () => {
    const { deps, rows, deleted } = harness();
    expect(await getShopIntegrationSecrets(keyCtx(['tenant:settings:read']), deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await setShopIntegrationSecret(keyCtx(['tenant:secret:read']), { key: 'ksef.token', value: 'token' }, deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await deleteShopIntegrationSecret(keyCtx(['tenant:secret:read']), 'ksef.token', deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(rows.size).toBe(0);
    expect(deleted).toEqual([]);
  });

  it('lists the masked view and deletes an allow-listed credential', async () => {
    const { deps } = harness();
    const ctx = keyCtx(['tenant:secret:read', 'tenant:secret:write']);
    await setShopIntegrationSecret(ctx, { key: 'ksef.token', value: 'ksef-token-1234' }, deps);
    const listed = await getShopIntegrationSecrets(ctx, deps);
    expect(listed).toMatchObject({ ok: true, value: { secrets: [{ key: 'ksef.token', maskedPreview: '••••1234' }], stripeMode: null } });
    expect(await deleteShopIntegrationSecret(ctx, 'ksef.token', deps)).toEqual({ ok: true, value: { key: 'ksef.token' } });
    expect(await deleteShopIntegrationSecret(ctx, 'ksef.token', deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
