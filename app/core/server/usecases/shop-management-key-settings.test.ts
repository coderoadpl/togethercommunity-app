import { describe, expect, it } from 'vitest';

import {
  capabilitiesForPrincipal,
  ok,
  SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS,
  SHOP_MANAGEMENT_KEY_SETTINGS_OPERATIONS,
  shopManagementCapabilities,
  shopManagementKeyMayWriteSetting,
  type Identity,
  type TenantSettings,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { updateTenantSettings, type TenantSettingsDeps } from './tenant-settings.js';

const stored: TenantSettings = {
  name: 'Alpha',
  socialLinks: [],
  signInNotice: { enabled: false, text: '' },
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  bunnyStreamCdnHostname: null,
  logoUrl: null,
  logoDarkUrl: null,
  accentColor: null,
  accentLight: null,
  faviconUrl: null,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  supportEmail: null,
  supportUrl: null,
  termsUrl: null,
  privacyUrl: null,
  defaultHomeSpaceId: null,
  invoiceVatMode: 'rate',
  invoiceVatRatePercent: 23,
};

const owner: Identity = {
  userId: 'owner-1',
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

const ownerCapabilities = capabilitiesForPrincipal('owner');

const keyCtx: Ctx = {
  identity: owner,
  capabilities: shopManagementCapabilities(['shop:settings:read', 'shop:settings:write'])
    .filter((capability) => ownerCapabilities.includes(capability)),
  machineActor: { kind: 'shop_management_key', apiKeyId: 'key-1' },
};

const ownerSession: Ctx = { identity: owner };

const harness = () => {
  const writes: TenantSettings[] = [];
  const deps: TenantSettingsDeps = {
    tenants: {
      findById: async () => null,
      findBySlug: async () => null,
      findSole: async () => null,
      hasAny: async () => false,
      findSettings: async () => stored,
      updateSettings: async (_tenantId, next) => {
        writes.push(next);
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

const forbidden = { ok: false, error: { code: 'forbidden' } };

describe('shop management key settings allow-list', () => {
  it('lists exactly the shop settings fields a key may change', () => {
    expect(Object.keys(SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS)).toEqual([
      'name', 'defaultLanguage', 'logoUrl', 'logoDarkUrl', 'faviconUrl', 'accentColor', 'accentLight', 'ogTitle',
      'ogDescription', 'ogImageUrl', 'socialLinks', 'checkoutAppearance', 'supportEmail', 'supportUrl', 'termsUrl',
      'privacyUrl', 'invoiceSellerName', 'invoiceSellerAddress', 'invoiceVatMode', 'invoiceVatRatePercent',
      'invoiceExemptionBasisKind', 'invoiceExemptionBasis', 'invoicingProvider', 'autoIssueInvoices',
      'autoIssueInvoiceScope', 'ksefSubmissionMode', 'shippingRates', 'inpostGeowidgetToken',
    ]);
    expect(SHOP_MANAGEMENT_KEY_SETTINGS_OPERATIONS).toEqual(['shop-settings:update', 'shop-settings:branding-asset-upload']);
    expect(shopManagementKeyMayWriteSetting('analyticsTagId')).toBe(false);
  });

  it('refuses a key ctx the settings write capability without an allow-listed settings grant', () => {
    expect(authorizeTenant(keyCtx, 'tenant:settings:write')).toMatchObject(forbidden);
    expect(authorizeTenant(keyCtx, 'tenant:settings:write', { shopManagementKeyGrant: { operation: 'stripe:configure' } }))
      .toMatchObject(forbidden);
    expect(authorizeTenant(keyCtx, 'tenant:settings:write', {
      shopManagementKeyGrant: { operation: 'shop-settings:update', fields: ['name', 'directMessagesEnabled'] },
    })).toMatchObject(forbidden);
    expect(authorizeTenant(keyCtx, 'tenant:settings:write', {
      shopManagementKeyGrant: { operation: 'shop-settings:update', fields: ['name'] },
    })).toEqual(ok('tenant-1'));
    expect(authorizeTenant(keyCtx, 'tenant:settings:read')).toEqual(ok('tenant-1'));
  });

  it('refuses a key ctx a secret write named by a settings grant', () => {
    const integrationKey: Ctx = {
      ...keyCtx,
      capabilities: shopManagementCapabilities(['shop:settings:write', 'shop:integrations:write']),
    };
    expect(authorizeTenant(integrationKey, 'tenant:secret:write', {
      shopManagementKeyGrant: { operation: 'shop-settings:update', fields: ['name'] },
    })).toMatchObject(forbidden);
  });

  it('refuses a key ctx updating settings without a grant', async () => {
    const h = harness();
    expect(await updateTenantSettings(keyCtx, { name: 'Renamed' }, h.deps)).toMatchObject(forbidden);
    expect(h.writes).toEqual([]);
  });

  it('refuses a key ctx whose grant names a field outside the allow-list', async () => {
    const h = harness();
    expect(await updateTenantSettings(keyCtx, { analyticsTagId: 'G-ABCDEF1234' }, h.deps, {
      shopManagementKeyGrant: { operation: 'shop-settings:update', fields: ['analyticsTagId'] },
    })).toMatchObject(forbidden);
    expect(h.writes).toEqual([]);
  });

  it('refuses a key ctx changing a field its grant does not name', async () => {
    const h = harness();
    expect(await updateTenantSettings(keyCtx, { name: 'Renamed', directMessagesEnabled: false }, h.deps, {
      shopManagementKeyGrant: { operation: 'shop-settings:update', fields: ['name'] },
    })).toMatchObject(forbidden);
    expect(await updateTenantSettings(keyCtx, { logoUrl: null }, h.deps, {
      shopManagementKeyGrant: { operation: 'shop-settings:branding-asset-upload', fields: ['logoUrl'] },
    })).toMatchObject(forbidden);
    expect(h.writes).toEqual([]);
  });

  it('refuses a key ctx the checkout return origins even with the settings write scope', async () => {
    expect(Object.keys(SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS)).not.toContain('checkoutReturnOrigins');
    expect(shopManagementKeyMayWriteSetting('checkoutReturnOrigins')).toBe(false);
    expect(authorizeTenant(keyCtx, 'tenant:settings:write', {
      shopManagementKeyGrant: { operation: 'shop-settings:update', fields: ['checkoutReturnOrigins'] },
    })).toMatchObject(forbidden);
    const h = harness();
    expect(await updateTenantSettings(keyCtx, { checkoutReturnOrigins: ['https://shop.example.test'] }, h.deps, {
      shopManagementKeyGrant: { operation: 'shop-settings:update', fields: ['checkoutReturnOrigins'] },
    })).toMatchObject(forbidden);
    expect(await updateTenantSettings(keyCtx, { name: 'Renamed', checkoutReturnOrigins: ['https://shop.example.test'] }, h.deps, {
      shopManagementKeyGrant: { operation: 'shop-settings:update', fields: ['name'] },
    })).toMatchObject(forbidden);
    expect(h.writes).toEqual([]);
  });

  it('lets a key ctx update an allow-listed field its grant names', async () => {
    const h = harness();
    expect(await updateTenantSettings(keyCtx, { name: 'Renamed', supportUrl: 'https://alpha.example.test/help' }, h.deps, {
      shopManagementKeyGrant: { operation: 'shop-settings:update', fields: ['name', 'supportUrl'] },
    })).toMatchObject({ ok: true, value: { name: 'Renamed', supportUrl: 'https://alpha.example.test/help' } });
    expect(h.writes).toHaveLength(1);
  });

  it('keeps every settings field open to an owner session without a grant', async () => {
    const h = harness();
    expect(await updateTenantSettings(ownerSession, { analyticsTagId: 'G-ABCDEF1234', directMessagesEnabled: false }, h.deps))
      .toMatchObject({ ok: true, value: { analyticsTagId: 'G-ABCDEF1234', directMessagesEnabled: false } });
    expect(authorizeTenant(ownerSession, 'tenant:settings:write')).toEqual(ok('tenant-1'));
  });
});
