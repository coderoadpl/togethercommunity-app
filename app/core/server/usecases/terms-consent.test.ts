import { describe, expect, it } from 'vitest';

import type { TenantSettings, TermsConsent } from '#core/domain/index.js';
import type { TenantRepository, TermsConsentRepository } from '../ports.js';

import { enforceTermsConsent, tenantLegalUrls, validateTermsConsent } from './terms-consent.js';

const settings = (overrides: Partial<TenantSettings> = {}): TenantSettings => ({
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  logoUrl: null,
  accentColor: null,
  faviconUrl: null,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  supportEmail: null,
  supportUrl: null,
  termsUrl: null,
  privacyUrl: null,
  ...overrides,
});

const harness = (stored: TenantSettings | null) => {
  const recorded: TermsConsent[] = [];
  const tenants: TenantRepository = {
    findById: async () => null,
    findBySlug: async () => null,
    findSole: async () => null,
    findSettings: async () => stored,
    updateSettings: async (_tenantId, next) => next,
    createTenantWithOwnerGrant: async () => {
      throw new Error('not used');
    },
  };
  const consents: TermsConsentRepository = {
    record: async (_tenantId, consent) => {
      recorded.push(consent);
    },
    listByEmail: async () => recorded,
  };
  return {
    recorded,
    deps: {
      tenants,
      consents,
      ids: { nextId: () => 'consent-1' },
      clock: { nowIso: () => '2026-07-20T12:00:00.000Z' },
    },
  };
};

describe('tenantLegalUrls', () => {
  it('is null without settings or with both documents unset', () => {
    expect(tenantLegalUrls(null)).toBeNull();
    expect(tenantLegalUrls(settings())).toBeNull();
  });

  it('returns the configured urls when at least one document is set', () => {
    expect(tenantLegalUrls(settings({ termsUrl: 'https://acme.test/terms' }))).toEqual({
      termsUrl: 'https://acme.test/terms',
      privacyUrl: null,
    });
  });
});

describe('enforceTermsConsent', () => {
  const input = {
    userId: 'user-1',
    email: 'member@acme.test',
    source: 'register' as const,
  };

  it('is a no-op for tenants without configured documents', async () => {
    const h = harness(settings());
    const result = await enforceTermsConsent('tenant-a', { ...input, accepted: undefined }, h.deps);
    expect(result).toEqual({ ok: true, value: { recorded: false } });
    expect(h.recorded).toEqual([]);
  });

  it('rejects a configured tenant without acceptance and records nothing', async () => {
    const h = harness(settings({ termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' }));
    for (const accepted of [undefined, false]) {
      const result = await enforceTermsConsent('tenant-a', { ...input, accepted }, h.deps);
      expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(h.recorded).toEqual([]);
  });

  it('persists an accepted consent with timestamp and document-url snapshot', async () => {
    const h = harness(settings({ termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' }));
    const result = await enforceTermsConsent(
      'tenant-a',
      { ...input, accepted: true, source: 'checkout' },
      h.deps,
    );
    expect(result).toEqual({ ok: true, value: { recorded: true } });
    expect(h.recorded).toEqual([
      {
        id: 'consent-1',
        tenantId: 'tenant-a',
        userId: 'user-1',
        email: 'member@acme.test',
        source: 'checkout',
        termsUrl: 'https://acme.test/terms',
        privacyUrl: 'https://acme.test/privacy',
        acceptedAt: '2026-07-20T12:00:00.000Z',
      },
    ]);
  });
});

describe('validateTermsConsent', () => {
  it('reports whether acceptance is required without recording evidence', async () => {
    const optional = harness(settings());
    await expect(validateTermsConsent('tenant-a', undefined, optional.deps.tenants)).resolves.toEqual({
      ok: true,
      value: { required: false },
    });

    const required = harness(settings({ termsUrl: 'https://acme.test/terms' }));
    await expect(validateTermsConsent('tenant-a', true, required.deps.tenants)).resolves.toEqual({
      ok: true,
      value: { required: true },
    });
    await expect(validateTermsConsent('tenant-a', undefined, required.deps.tenants)).resolves.toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(optional.recorded).toEqual([]);
    expect(required.recorded).toEqual([]);
  });
});
