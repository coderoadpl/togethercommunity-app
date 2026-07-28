import { describe, expect, it } from 'vitest';

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
