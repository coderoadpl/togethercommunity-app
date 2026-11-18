import { describe, expect, it } from 'vitest';

import { shopSettingsSchema, type Identity, type TenantSettings } from '#core/domain/index.js';

import type { Ctx } from '../context.js';

import { getShopSettings, updateShopSettings } from './shop-settings.js';
import type { TenantSettingsDeps } from './tenant-settings.js';

const stored: TenantSettings = {
  name: 'Alpha',
  socialLinks: [],
  signInNotice: { enabled: true, text: 'Staff notice' },
  billingPortalUrl: 'https://billing.example.test',
  bunnyStreamLibraryId: 'library-1',
  bunnyStreamCdnHostname: null,
  logoUrl: null,
  logoDarkUrl: null,
  accentColor: null,
  accentLight: null,
  faviconUrl: null,
  ogTitle: 'Private title',
  ogDescription: null,
  ogImageUrl: null,
  supportEmail: 'help@example.test',
  supportUrl: 'https://brand.example.test/help',
  termsUrl: null,
  privacyUrl: null,
  defaultHomeSpaceId: null,
  analyticsTagId: 'G-ABCDEF1234',
  invoiceVatMode: 'rate',
  invoiceVatRatePercent: 23,
  shippingRates: [],
};

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
  const writes: TenantSettings[] = [];
  let current = stored;
  const deps: TenantSettingsDeps = {
    tenants: {
      findById: async () => null,
      findBySlug: async () => null,
      findSole: async () => null,
      hasAny: async () => false,
      findSettings: async () => current,
      updateSettings: async (_tenantId, next) => {
        writes.push(next);
        current = next;
        return next;
      },
      createTenantWithOwnerGrant: async () => {
        throw new Error('not used');
      },
    },
    spaces: {
      list: async () => [],
      findById: async () => null,
      findBySlug: async () => null,
      create: async () => undefined,
      update: async () => null,
      setArchived: async () => null,
      delete: async () => false,
      stats: async () => new Map(),
    },
    products: { bumpContentVersion: async () => undefined },
    personalisationMaxBytes: 1024,
  };
  return { deps, writes };
};

describe('shop settings use-cases', () => {
  it('projects only the allow-listed fields', async () => {
    const { deps } = harness();
    const result = await getShopSettings(keyCtx(['tenant:settings:read']), deps);
    if (!result.ok) throw new Error('Expected settings');
    expect(Object.keys(result.value).toSorted()).toEqual(Object.keys(shopSettingsSchema.shape).toSorted());
    expect(result.value).toMatchObject({ name: 'Alpha', supportEmail: 'help@example.test', invoiceVatRatePercent: 23, ogTitle: 'Private title', ogDescription: null });
    expect(result.value).not.toHaveProperty('analyticsTagId');
    expect(result.value).not.toHaveProperty('signInNotice');
    expect(result.value).not.toHaveProperty('billingPortalUrl');
  });

  it('merges a patch into the stored settings and keeps every other field', async () => {
    const { deps, writes } = harness();
    const result = await updateShopSettings(keyCtx(['tenant:settings:write']), { termsUrl: 'https://brand.example.test/terms', supportUrl: null }, deps);
    expect(result).toMatchObject({ ok: true, value: { termsUrl: 'https://brand.example.test/terms', supportUrl: null, supportEmail: 'help@example.test' } });
    expect(writes).toEqual([{ ...stored, termsUrl: 'https://brand.example.test/terms', supportUrl: null, invoiceExemptionBasisKind: null, invoiceExemptionBasis: null }]);
  });

  it('rejects fields outside the allow-list even when a caller passes a wider object', async () => {
    const { deps, writes } = harness();
    const wider = { termsUrl: 'https://brand.example.test/terms', analyticsTagId: null, signInNotice: { enabled: false, text: '' } };
    expect(await updateShopSettings(keyCtx(['tenant:settings:write']), wider, deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(writes).toEqual([]);
  });

  it('needs the settings capabilities of the key', async () => {
    const { deps, writes } = harness();
    expect(await getShopSettings(keyCtx(['product:read']), deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await updateShopSettings(keyCtx(['tenant:settings:read']), { name: 'Renamed' }, deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(writes).toEqual([]);
  });

  it('keeps the staff-role requirement of the settings read', async () => {
    const { deps } = harness();
    const ctx: Ctx = { identity: { ...owner, staffRole: null, tenantAccess: 'none' }, capabilities: ['tenant:settings:read'] };
    expect(await getShopSettings(ctx, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
