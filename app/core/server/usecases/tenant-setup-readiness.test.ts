import { describe, expect, it } from 'vitest';

import type {
  Identity,
  Space,
  StaffRole,
  TenantSecret,
  TenantSecretKey,
  TenantSesSettings,
  TenantSettings,
  TenantSetupItemId,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import {
  getTenantSetupReadiness,
  type TenantSetupReadinessDeps,
} from './tenant-setup-readiness.js';

const NOW = '2026-08-01T00:00:00.000Z';

const ctx = (staffRole: StaffRole | null = 'owner', tenantId: string | null = 'tenant-1'): Ctx => ({
  identity: {
    userId: 'user-1',
    email: 'owner@together.dev',
    name: 'Owner',
    emailVerified: true,
    tenantId,
    tenantSlug: tenantId === null ? null : 'acme',
    tenantName: tenantId === null ? null : 'Acme',
    staffRole,
    memberId: null,
    image: null,
    memberDisplayName: null,
    memberBannedAt: null,
    memberDmOptOutAt: null,
    memberLanguage: null,
  } satisfies Identity,
});

const settings = (overrides: Partial<TenantSettings> = {}): TenantSettings => ({
  name: 'Acme',
  socialLinks: [],
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  bunnyStreamCdnHostname: null,
  logoUrl: null,
  logoDarkUrl: null,
  accentColor: null,
  faviconUrl: null,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  supportEmail: null,
  supportUrl: null,
  termsUrl: null,
  privacyUrl: null,
  defaultHomeSpaceId: null,
  ...overrides,
});

const space = (overrides: Partial<Space> = {}): Space => ({
  id: 'space-1',
  tenantId: 'tenant-1',
  slug: 'community',
  name: 'Community',
  description: null,
  visibility: 'members',
  productIds: [],
  publicReadOnly: false,
  position: 0,
  archivedAt: null,
  createdAt: NOW,
  ...overrides,
});

const senderSettings = (overrides: Partial<TenantSesSettings> = {}): TenantSesSettings => ({
  tenantId: 'tenant-1',
  fromAddress: 'hello@acme.test',
  fromName: 'Acme',
  identity: 'acme.test',
  identityVerifiedAt: null,
  identityCheckedAt: null,
  identityCheckError: null,
  configurationSet: null,
  snsTopicArn: null,
  trackingEnabled: true,
  autoPauseOnCritical: true,
  webhookToken: 'token-token-token-token',
  quotaRatePerSec: 0,
  quotaDaily: 0,
  quotaSentLast24Hours: 0,
  quotaRefreshedAt: null,
  inSandbox: true,
  webhookVerifiedAt: null,
  footerLegalName: '',
  footerAddress: '',
  broadcastsEnabled: false,
  reputationAlertStatus: null,
  reputationAlertedAt: null,
  ...overrides,
});

const secret = (key: TenantSecretKey): TenantSecret => ({
  id: `secret-${key}`,
  tenantId: 'tenant-1',
  key,
  ciphertext: 'cipher',
  iv: 'iv',
  authTag: 'tag',
  maskedPreview: '••••',
  updatedAt: NOW,
});

const deps = (input: {
  settings?: TenantSettings | null;
  secretKeys?: TenantSecretKey[];
  spaces?: Space[];
  sender?: TenantSesSettings | null;
}): TenantSetupReadinessDeps => ({
  tenants: { findSettings: async () => (input.settings === undefined ? settings() : input.settings) },
  tenantSecrets: { listByTenant: async () => (input.secretKeys ?? []).map(secret) },
  spaces: { list: async () => input.spaces ?? [] },
  sesSettings:
    input.sender === undefined ? null : { findByTenant: async () => input.sender ?? null },
});

const configuredById = async (
  input: Parameters<typeof deps>[0],
): Promise<Partial<Record<TenantSetupItemId, boolean>>> => {
  const result = await getTenantSetupReadiness(ctx(), deps(input));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  const configured: Partial<Record<TenantSetupItemId, boolean>> = {};
  for (const item of result.value.items) configured[item.id] = item.configured;
  return configured;
};

const SMTP_KEYS: TenantSecretKey[] = [
  'smtp.host',
  'smtp.port',
  'smtp.user',
  'smtp.password',
  'smtp.secure',
];

describe('getTenantSetupReadiness', () => {
  it('reports a bare tenant as unconfigured everywhere', async () => {
    expect(await configuredById({})).toEqual({
      stripe: false,
      email_sending: false,
      storage: false,
      legal_terms: false,
      public_home: false,
      billing_portal: false,
      video: false,
      branding: false,
      invoicing: false,
    });
  });

  it('requires both the Stripe key and the webhook secret, like the checkout payment config', async () => {
    expect((await configuredById({ secretKeys: ['stripe.restrictedKey'] })).stripe).toBe(false);
    expect(
      (await configuredById({ secretKeys: ['stripe.restrictedKey', 'stripe.webhookSecret'] })).stripe,
    ).toBe(true);
  });

  it('accepts any tenant transport the send path resolves, but only with a sender identity', async () => {
    expect((await configuredById({ secretKeys: SMTP_KEYS })).email_sending).toBe(false);
    expect(
      (await configuredById({ secretKeys: SMTP_KEYS, sender: senderSettings() })).email_sending,
    ).toBe(true);
    expect(
      (await configuredById({ secretKeys: ['resend.apiKey'], sender: senderSettings() })).email_sending,
    ).toBe(true);
    expect(
      (await configuredById({ secretKeys: SMTP_KEYS.slice(1), sender: senderSettings() })).email_sending,
    ).toBe(false);
  });

  it('treats SES as a transport only once the identity is verified and credentials exist', async () => {
    const sesKeys: TenantSecretKey[] = ['ses.accessKeyId', 'ses.secretAccessKey', 'ses.region'];
    expect(
      (await configuredById({ secretKeys: sesKeys, sender: senderSettings() })).email_sending,
    ).toBe(false);
    expect(
      (
        await configuredById({
          secretKeys: sesKeys,
          sender: senderSettings({ identityVerifiedAt: NOW }),
        })
      ).email_sending,
    ).toBe(true);
    expect(
      (
        await configuredById({
          secretKeys: ['ses.accessKeyId', 'ses.region'],
          sender: senderSettings({ identityVerifiedAt: NOW }),
        })
      ).email_sending,
    ).toBe(false);
  });

  it('reads storage, video, branding, terms and billing portal from settings and secrets', async () => {
    const readiness = await configuredById({
      secretKeys: ['s3.configuration', 'bunny.apiKey'],
      settings: settings({
        bunnyStreamLibraryId: '4242',
        termsUrl: 'https://acme.test/terms',
        billingPortalUrl: 'https://billing.acme.test',
        logoUrl: '/assets/logo.png',
        logoDarkUrl: null,
        accentColor: '#112233',
      }),
    });

    expect(readiness.storage).toBe(true);
    expect(readiness.video).toBe(true);
    expect(readiness.legal_terms).toBe(true);
    expect(readiness.billing_portal).toBe(true);
    expect(readiness.branding).toBe(true);
  });

  it('needs both the logo and the accent colour for branding', async () => {
    expect((await configuredById({ settings: settings({ logoUrl: '/assets/logo.png' }) })).branding).toBe(false);
  });

  it('needs a Bunny library id next to the API key', async () => {
    expect((await configuredById({ secretKeys: ['bunny.apiKey'] })).video).toBe(false);
  });

  it('counts the public home as ready once one publicly readable space exists', async () => {
    expect((await configuredById({ spaces: [space()] })).public_home).toBe(false);
    expect((await configuredById({ spaces: [space({ publicReadOnly: true })] })).public_home).toBe(true);
  });

  it('checks the invoicing provider the tenant actually issues with', async () => {
    const ifirmaKeys: TenantSecretKey[] = ['ifirma.invoiceApiKey', 'ifirma.username'];
    const ksefKeys: TenantSecretKey[] = ['ksef.token', 'ksef.contextNip'];

    expect((await configuredById({ secretKeys: ifirmaKeys })).invoicing).toBe(true);
    expect(
      (await configuredById({ secretKeys: ifirmaKeys, settings: settings({ invoicingProvider: 'ksef' }) }))
        .invoicing,
    ).toBe(false);
    expect(
      (await configuredById({ secretKeys: ksefKeys, settings: settings({ invoicingProvider: 'ksef' }) }))
        .invoicing,
    ).toBe(true);
  });

  it('accepts either legal document link, like the consent gate', async () => {
    expect(
      (await configuredById({ settings: settings({ privacyUrl: 'https://acme.test/privacy' }) }))
        .legal_terms,
    ).toBe(true);
  });

  it('survives a tenant without stored settings', async () => {
    expect((await configuredById({ settings: null })).legal_terms).toBe(false);
  });

  it('rejects non-staff callers', async () => {
    const result = await getTenantSetupReadiness(ctx(null), deps({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('forbidden');
  });

  it('requires a tenant', async () => {
    const result = await getTenantSetupReadiness(ctx('owner', null), deps({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('tenant_not_found');
  });
});
