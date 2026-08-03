import { describe, expect, it, vi } from 'vitest';

import { selectDevSinkPurge, selectTenantRouting } from './composition.js';
import { envSchema } from './env.js';

describe('tenant creation policy', () => {
  it('defaults open outside production and accepts only declared modes', () => {
    const defaults = envSchema.parse({});

    expect(defaults.TENANT_CREATION).toBe('open');
    expect(envSchema.safeParse({ TENANT_CREATION: 'open' }).success).toBe(true);
    expect(envSchema.safeParse({ TENANT_CREATION: 'staff' }).success).toBe(false);
  });

  it('requires closed tenant creation in production', () => {
    const parsed = envSchema.safeParse({
      NODE_ENV: 'production',
      TENANT_CREATION: 'open',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.TENANT_CREATION).toContain(
        'TENANT_CREATION must be closed in production',
      );
    }
  });
});

describe('tenant routing mode', () => {
  it('defaults to single-tenant mode when APP_BASE_DOMAIN is absent or empty', () => {
    expect(envSchema.parse({}).APP_BASE_DOMAIN).toBeUndefined();
    expect(envSchema.parse({ APP_BASE_DOMAIN: '' }).APP_BASE_DOMAIN).toBeUndefined();
    expect(envSchema.parse({ APP_BASE_DOMAIN: 'example.com' }).APP_BASE_DOMAIN).toBe('example.com');
  });

  it('falls back to the app host as base domain when none is configured', () => {
    expect(selectTenantRouting(envSchema.parse({ APP_BASE_URL: 'https://learn.example.com' }))).toEqual({
      baseDomain: 'learn.example.com',
      singleTenantMode: true,
    });
  });

  it('keeps subdomain routing when a base domain is configured', () => {
    expect(selectTenantRouting(envSchema.parse({
      APP_BASE_DOMAIN: 'together.com',
      APP_BASE_URL: 'https://together.com',
    }))).toEqual({ baseDomain: 'together.com', singleTenantMode: false });
  });
});

describe('database driver policy', () => {
  it('rejects neon-http while runtime adapters require interactive transactions', () => {
    const parsed = envSchema.safeParse({ DB_DRIVER: 'neon-http' });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.DB_DRIVER).toContain(
        'DB_DRIVER must be node-postgres because runtime adapters require interactive transactions',
      );
    }
  });
});

describe('local SMTP policy', () => {
  it('treats empty optional settings as unset', () => {
    const parsed = envSchema.safeParse({
      APP_COMMIT_SHA: '',
      EMAIL_FROM: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      SNS_TEST_CERT_PEM_BASE64: '',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.APP_COMMIT_SHA).toBeUndefined();
      expect(parsed.data.EMAIL_FROM).toBeUndefined();
      expect(parsed.data.SMTP_USER).toBeUndefined();
      expect(parsed.data.SMTP_PASSWORD).toBeUndefined();
      expect(parsed.data.SNS_TEST_CERT_PEM_BASE64).toBeUndefined();
    }
  });

  it('accepts Mailpit without SMTP credentials when a sender is configured', () => {
    const parsed = envSchema.safeParse({
      EMAIL_PROVIDER: 'smtp',
      EMAIL_FROM: 'Together <dev@together.local>',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '47925',
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects incomplete SMTP credential pairs', () => {
    const parsed = envSchema.safeParse({
      SMTP_USER: 'user',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.SMTP_PASSWORD).toContain(
        'SMTP_USER and SMTP_PASSWORD must be set together',
      );
    }
  });
});

describe('development sink policy', () => {
  it.each([
    { NODE_ENV: 'production' as const, APP_ENV: 'development' as const },
    { NODE_ENV: 'development' as const, APP_ENV: 'production' as const },
  ])('omits the purge adapter in production', (env) => {
    const create = vi.fn();

    expect(selectDevSinkPurge(env, create)).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('visual clock policy', () => {
  it('accepts an explicit timestamp outside production', () => {
    const parsed = envSchema.safeParse({
      TOGETHER_VISUAL_CLOCK: '2026-07-01T12:00:00.000Z',
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects the override in production', () => {
    const parsed = envSchema.safeParse({
      NODE_ENV: 'production',
      TOGETHER_VISUAL_CLOCK: '2026-07-01T12:00:00.000Z',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.TOGETHER_VISUAL_CLOCK).toContain(
        'TOGETHER_VISUAL_CLOCK cannot be enabled in production',
      );
    }
  });
});
