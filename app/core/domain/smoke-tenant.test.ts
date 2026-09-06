import { describe, expect, it } from 'vitest';

import {
  isSmokeTenant,
  resolveSmokeTenantPasswords,
  smokeTenantReseedRefusal,
  SMOKE_TENANT_CREATOR_EMAIL,
  SMOKE_TENANT_ID,
  SMOKE_TENANT_MEMBER_EMAIL,
} from './smoke-tenant.js';

const DEMO_PASSWORD = 'demo-password-15';
const MEMBER_PASSWORD = 'production-only-member-password';
const CREATOR_PASSWORD = 'production-only-creator-password';

describe('smoke tenant identity', () => {
  it('marks only the seeded acme tenant', () => {
    expect(isSmokeTenant(SMOKE_TENANT_ID)).toBe(true);
    expect(isSmokeTenant('tenant-studio')).toBe(false);
  });
});

describe('resolveSmokeTenantPasswords', () => {
  const configured = (member: string | undefined, creator = member) => ({ member, creator });

  it('uses the demo password for both accounts off production', () => {
    expect(resolveSmokeTenantPasswords({
      production: false,
      demoPassword: DEMO_PASSWORD,
      configured: configured(undefined),
    })).toEqual({ ok: true, passwords: { member: DEMO_PASSWORD, creator: DEMO_PASSWORD } });
  });

  it('prefers configured passwords off production', () => {
    expect(resolveSmokeTenantPasswords({
      production: false,
      demoPassword: DEMO_PASSWORD,
      configured: { member: MEMBER_PASSWORD, creator: CREATOR_PASSWORD },
    })).toEqual({ ok: true, passwords: { member: MEMBER_PASSWORD, creator: CREATOR_PASSWORD } });
  });

  it.each([
    ['SMOKE_MEMBER_PASSWORD', { member: undefined, creator: CREATOR_PASSWORD }],
    ['SMOKE_CREATOR_PASSWORD', { member: MEMBER_PASSWORD, creator: '  ' }],
  ])('requires %s on production', (variable, configuredPasswords) => {
    expect(resolveSmokeTenantPasswords({
      production: true,
      demoPassword: DEMO_PASSWORD,
      configured: configuredPasswords,
    })).toEqual({ ok: false, reason: expect.stringContaining(`${variable} is required`) });
  });

  it.each([
    ['SMOKE_MEMBER_PASSWORD', { member: DEMO_PASSWORD, creator: CREATOR_PASSWORD }],
    ['SMOKE_CREATOR_PASSWORD', { member: MEMBER_PASSWORD, creator: DEMO_PASSWORD }],
  ])('refuses to write the demo password as %s to a production database', (variable, configuredPasswords) => {
    expect(resolveSmokeTenantPasswords({
      production: true,
      demoPassword: DEMO_PASSWORD,
      configured: configuredPasswords,
    })).toEqual({
      ok: false,
      reason: expect.stringContaining(`${variable} must not be the shared demo password`),
    });
  });

  it('accepts two distinct production passwords', () => {
    expect(resolveSmokeTenantPasswords({
      production: true,
      demoPassword: DEMO_PASSWORD,
      configured: { member: ` ${MEMBER_PASSWORD} `, creator: ` ${CREATOR_PASSWORD} ` },
    })).toEqual({ ok: true, passwords: { member: MEMBER_PASSWORD, creator: CREATOR_PASSWORD } });
  });
});

describe('smokeTenantReseedRefusal', () => {
  it('allows the seeded fixture, smoke accounts included', () => {
    expect(smokeTenantReseedRefusal({
      tenant: { id: SMOKE_TENANT_ID, slug: 'acme' },
      memberEmails: [SMOKE_TENANT_MEMBER_EMAIL, 'student2@together.dev'],
      consentEmails: [SMOKE_TENANT_CREATOR_EMAIL.toUpperCase(), 'student2@together.dev'],
    })).toBeNull();
  });

  it('refuses another address on the smoke accounts domain', () => {
    expect(smokeTenantReseedRefusal({
      tenant: { id: SMOKE_TENANT_ID, slug: 'acme' },
      memberEmails: [SMOKE_TENANT_MEMBER_EMAIL, 'kontakt@togethercommunity.app'],
      consentEmails: [],
    })).toContain('has a member outside');
  });

  it('allows a first seed when the tenant does not exist yet', () => {
    expect(smokeTenantReseedRefusal({
      tenant: null,
      memberEmails: [],
      consentEmails: [],
    })).toBeNull();
  });

  it('refuses a tenant that took over the id under another slug', () => {
    expect(smokeTenantReseedRefusal({
      tenant: { id: SMOKE_TENANT_ID, slug: 'coderoad' },
      memberEmails: [],
      consentEmails: [],
    })).toContain('slug "coderoad"');
  });

  it('refuses when a member looks like a real customer', () => {
    expect(smokeTenantReseedRefusal({
      tenant: { id: SMOKE_TENANT_ID, slug: 'acme' },
      memberEmails: [SMOKE_TENANT_MEMBER_EMAIL, 'Kupujacy@Gmail.com'],
      consentEmails: [],
    })).toContain('has a member outside @together.dev and the smoke accounts');
  });

  it('refuses when a real person left a marketing consent behind', () => {
    expect(smokeTenantReseedRefusal({
      tenant: { id: SMOKE_TENANT_ID, slug: 'acme' },
      memberEmails: [SMOKE_TENANT_MEMBER_EMAIL],
      consentEmails: ['Zapisany@Gmail.com'],
    })).toContain('holds a marketing consent outside @together.dev and the smoke accounts');
  });
});
