import { describe, expect, it, vi } from 'vitest';

import {
  createMultipleTenantsReporter,
  selectAuthTrustedProxyHeader,
  selectDeploymentAuthOrigins,
  selectDevSinkPurge,
  selectTenantCreationMode,
  selectTenantRouting,
  selectTrustedAuthOrigins,
} from './composition.js';
import { envSchema, isProductionEnvironment } from './env.js';

const productionEnvironment = (overrides: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'production',
  APP_ENV: 'production',
  APP_BASE_URL: 'https://together.example',
  AUTH_TRUSTED_PROXY_HEADER: 'direct',
  BETTER_AUTH_SECRET: 'production-secret-with-at-least-16-chars',
  SECRETS_MASTER_KEY: 'production-master-key',
  PAYMENT_PROVIDER: 'stripe',
  KSEF_ENVIRONMENT: 'production',
  SECURE_COOKIES: 'true',
  EMAIL_PROVIDER: 'ses',
  EMAIL_FROM: 'Together <hello@together.example>',
  EMAIL_DISPATCH_SECRET: 'production-email-dispatch-secret',
  MARKETING_TICK_SECRET: 'production-marketing-tick-secret',
  CRON_SECRET: 'production-cron-secret',
  ...overrides,
});

describe('production posture detection', () => {
  it('treats an unlabelled NODE_ENV=production deployment as production', () => {
    expect(isProductionEnvironment({ NODE_ENV: 'production' })).toBe(true);
    expect(isProductionEnvironment({ NODE_ENV: 'production', APP_ENV: '' })).toBe(true);
    expect(isProductionEnvironment({ NODE_ENV: 'production', APP_ENV: 'self-host' })).toBe(true);
  });

  it('honours an explicit production APP_ENV regardless of NODE_ENV', () => {
    expect(isProductionEnvironment({ APP_ENV: 'production' })).toBe(true);
    expect(isProductionEnvironment({ NODE_ENV: 'development', APP_ENV: 'production' })).toBe(true);
  });

  it('lets a named preview environment opt out of the production posture', () => {
    expect(isProductionEnvironment({ NODE_ENV: 'production', APP_ENV: 'preview' })).toBe(false);
    expect(isProductionEnvironment({ NODE_ENV: 'production', APP_ENV: 'staging' })).toBe(false);
  });

  it('stays outside production when neither variable names one', () => {
    expect(isProductionEnvironment({})).toBe(false);
    expect(isProductionEnvironment({ NODE_ENV: 'development', APP_ENV: 'development' })).toBe(false);
  });

  it('applies the same precedence to the boot-time schema', () => {
    expect(envSchema.safeParse({ NODE_ENV: 'production' }).success).toBe(false);
    expect(envSchema.parse({ NODE_ENV: 'production', APP_ENV: 'preview' }).KSEF_ENVIRONMENT).toBe('test');
  });
});

describe('production adapter and cookie policy', () => {
  it('rejects the default email provider and accepts SES', () => {
    const defaultProvider = envSchema.safeParse(productionEnvironment({ EMAIL_PROVIDER: undefined }));

    expect(defaultProvider.success).toBe(false);
    if (!defaultProvider.success) {
      expect(defaultProvider.error.flatten().fieldErrors.EMAIL_PROVIDER).toContain(
        "EMAIL_PROVIDER must be 'ses' or 'smtp' in production",
      );
    }
    expect(envSchema.safeParse(productionEnvironment()).success).toBe(true);
  });

  it('rejects the default payment provider and accepts Stripe', () => {
    const defaultProvider = envSchema.safeParse(productionEnvironment({ PAYMENT_PROVIDER: undefined }));

    expect(defaultProvider.success).toBe(false);
    if (!defaultProvider.success) {
      expect(defaultProvider.error.flatten().fieldErrors.PAYMENT_PROVIDER).toContain(
        "PAYMENT_PROVIDER must be 'stripe' in production",
      );
    }
    expect(envSchema.safeParse(productionEnvironment()).success).toBe(true);
  });

  it('rejects the default cookie security and accepts secure cookies', () => {
    const defaultSecurity = envSchema.safeParse(productionEnvironment({ SECURE_COOKIES: undefined }));

    expect(defaultSecurity.success).toBe(false);
    if (!defaultSecurity.success) {
      expect(defaultSecurity.error.flatten().fieldErrors.SECURE_COOKIES).toContain(
        'SECURE_COOKIES must be true in production',
      );
    }
    expect(envSchema.safeParse(productionEnvironment()).success).toBe(true);
  });
});

describe('tenant creation policy', () => {
  it('defaults open outside production and accepts only declared modes', () => {
    const defaults = envSchema.parse({});

    expect(defaults.TENANT_CREATION).toBe('open');
    expect(envSchema.safeParse({ TENANT_CREATION: 'open' }).success).toBe(true);
    expect(envSchema.safeParse({ TENANT_CREATION: 'staff' }).success).toBe(false);
  });

  it('turns open production configuration into first-tenant bootstrap mode', () => {
    const env = envSchema.parse(productionEnvironment({
      APP_ENV: 'self-host',
      TENANT_CREATION: 'open',
      AUTH_TRUSTED_PROXY_HEADER: 'x-forwarded-for',
    }));

    expect(selectTenantCreationMode(env)).toBe('bootstrap');
  });

  it('keeps open creation outside production and honors closed mode everywhere', () => {
    expect(selectTenantCreationMode(envSchema.parse({ TENANT_CREATION: 'open' }))).toBe('open');
    expect(selectTenantCreationMode(envSchema.parse({ TENANT_CREATION: 'closed' }))).toBe('closed');
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
      tenantCreationMode: 'closed',
    });
  });

  it('closes tenant creation in single-tenant mode even when the environment requests open creation', () => {
    expect(selectTenantRouting(envSchema.parse({
      APP_BASE_URL: 'https://learn.example.com',
      TENANT_CREATION: 'open',
    })).tenantCreationMode).toBe('closed');
  });

  it('uses bootstrap creation in production single-tenant mode', () => {
    expect(selectTenantRouting(envSchema.parse(productionEnvironment({
      APP_ENV: 'self-host',
      APP_BASE_URL: 'https://learn.example.com',
      TENANT_CREATION: 'open',
      AUTH_TRUSTED_PROXY_HEADER: 'x-forwarded-for',
    }))).tenantCreationMode).toBe('bootstrap');
  });

  it('keeps subdomain routing when a base domain is configured', () => {
    expect(selectTenantRouting(envSchema.parse({
      APP_BASE_DOMAIN: 'together.example',
      APP_BASE_URL: 'https://together.example',
    }))).toEqual({ baseDomain: 'together.example', singleTenantMode: false, tenantCreationMode: 'open' });
  });

  it('trusts no sibling subdomains or HTTP custom domains in single-tenant mode', () => {
    expect(selectTrustedAuthOrigins({
      appBaseUrl: 'https://learn.example.com',
      baseDomain: 'learn.example.com',
      port: 48730,
      singleTenantMode: true,
      customDomains: ['courses.example'],
    })).toEqual([
      'https://learn.example.com',
      'https://courses.example',
    ]);
  });

  it('trusts tenant subdomains when subdomain routing is configured', () => {
    expect(selectTrustedAuthOrigins({
      appBaseUrl: 'https://example.com',
      baseDomain: 'example.com',
      port: 48730,
      singleTenantMode: false,
      customDomains: [],
    })).toContain('https://*.example.com');
  });

  it('reports multiple tenants only once per composition boot', () => {
    const write = vi.fn();
    const report = createMultipleTenantsReporter(write);

    report();
    report();

    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('deployed auth origin policy', () => {
  it('rejects an HTTP base URL outside localhost', () => {
    const parsed = envSchema.safeParse({ APP_BASE_URL: 'http://together.example' });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.APP_BASE_URL).toContain(
        'APP_BASE_URL must use https outside local development',
      );
    }
  });

  it('accepts local HTTP and deployed HTTPS base URLs', () => {
    expect(envSchema.safeParse({ APP_BASE_URL: 'http://localhost:48730' }).success).toBe(true);
    expect(envSchema.safeParse({ APP_BASE_URL: 'http://tenant.localhost:48730' }).success).toBe(true);
    expect(envSchema.safeParse({ APP_BASE_URL: 'http://127.0.0.1:48730' }).success).toBe(true);
    expect(envSchema.safeParse({ APP_BASE_URL: 'http://[::1]:48730' }).success).toBe(true);
    expect(envSchema.safeParse({ APP_BASE_URL: 'https://together.example' }).success).toBe(true);
  });

  it('allows HTTP tenant origins only on localhost and keeps custom domains HTTPS-only', () => {
    const localOrigins = selectTrustedAuthOrigins({
      appBaseUrl: 'http://localhost:48730',
      baseDomain: 'localhost',
      port: 48730,
      singleTenantMode: false,
      customDomains: ['courses.example'],
    });
    const deployedOrigins = selectTrustedAuthOrigins({
      appBaseUrl: 'https://together.example',
      baseDomain: 'together.example',
      port: 48730,
      singleTenantMode: false,
      customDomains: ['courses.example'],
    });

    expect(localOrigins).toContain('http://*.localhost');
    expect(localOrigins).toContain('https://*.localhost');
    expect(localOrigins).toContain('https://courses.example');
    expect(localOrigins).not.toContain('http://courses.example');
    expect(deployedOrigins.some((origin) => origin.startsWith('http://'))).toBe(false);
  });
});

describe('platform deployment auth origins', () => {
  it('ignores the platform deployment URLs in production', () => {
    expect(selectDeploymentAuthOrigins(envSchema.parse(productionEnvironment({
      AUTH_TRUSTED_PROXY_HEADER: 'x-vercel-forwarded-for',
      VERCEL_URL: 'together-app-9f3a1c.vercel.app',
      VERCEL_BRANCH_URL: 'together-app-git-production.vercel.app',
    })))).toEqual([]);
  });

  it('trusts the deployment and branch URLs outside production', () => {
    expect(selectDeploymentAuthOrigins(envSchema.parse({
      NODE_ENV: 'production',
      APP_ENV: 'preview',
      APP_BASE_URL: 'https://staging.example',
      VERCEL_URL: 'together-app-9f3a1c.vercel.app',
      VERCEL_BRANCH_URL: 'together-app-git-feature.vercel.app',
    }))).toEqual([
      'https://together-app-9f3a1c.vercel.app',
      'https://together-app-git-feature.vercel.app',
    ]);
  });

  it('trusts a branch URL that repeats the deployment URL only once', () => {
    expect(selectDeploymentAuthOrigins(envSchema.parse({
      APP_ENV: 'preview',
      VERCEL_URL: 'together-app-git-feature.vercel.app',
      VERCEL_BRANCH_URL: 'together-app-git-feature.vercel.app',
    }))).toEqual(['https://together-app-git-feature.vercel.app']);
  });

  it('changes nothing when the platform sets no deployment URLs', () => {
    expect(selectDeploymentAuthOrigins(envSchema.parse({ APP_ENV: 'preview' }))).toEqual([]);
    expect(selectDeploymentAuthOrigins(envSchema.parse({
      APP_ENV: 'preview',
      VERCEL_URL: '',
      VERCEL_BRANCH_URL: '',
    }))).toEqual([]);
    expect(selectDeploymentAuthOrigins(envSchema.parse({}))).toEqual([]);
  });
});

describe('auth client address policy', () => {
  it('is disabled by default and uses only the explicitly configured header', () => {
    expect(selectAuthTrustedProxyHeader(envSchema.parse({}))).toBeNull();
    expect(selectAuthTrustedProxyHeader(envSchema.parse({
      AUTH_TRUSTED_PROXY_HEADER: 'direct',
    }))).toBeNull();
    expect(selectAuthTrustedProxyHeader(envSchema.parse({
      AUTH_TRUSTED_PROXY_HEADER: 'x-edge-client-ip',
    }))).toBe('x-edge-client-ip');
  });

  it('rejects malformed configured header names', () => {
    expect(envSchema.safeParse({
      AUTH_TRUSTED_PROXY_HEADER: 'x-edge-client-ip, x-forwarded-for',
    }).success).toBe(false);
  });

  it('requires an explicit direct or protected proxy mode in production', () => {
    const parsed = envSchema.safeParse({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'production-secret-with-at-least-16-chars',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.AUTH_TRUSTED_PROXY_HEADER).toContain(
        'AUTH_TRUSTED_PROXY_HEADER must be set to direct or a protected header in production',
      );
    }

    const direct = envSchema.safeParse({
      NODE_ENV: 'production',
      AUTH_TRUSTED_PROXY_HEADER: 'direct',
      BETTER_AUTH_SECRET: 'production-secret-with-at-least-16-chars',
    });
    expect(direct.success).toBe(false);
    if (!direct.success) {
      expect(direct.error.flatten().fieldErrors.AUTH_TRUSTED_PROXY_HEADER).toBeUndefined();
    }
  });
});

describe('private storage endpoint policy', () => {
  it('requires an explicit opt-in', () => {
    expect(envSchema.parse({}).STORAGE_ALLOW_PRIVATE_ENDPOINTS).toBe(false);
    expect(envSchema.parse({ STORAGE_ALLOW_PRIVATE_ENDPOINTS: 'true' }).STORAGE_ALLOW_PRIVATE_ENDPOINTS).toBe(true);
    expect(envSchema.safeParse({ STORAGE_ALLOW_PRIVATE_ENDPOINTS: 'yes' }).success).toBe(false);
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

describe('consent evidence purge policy', () => {
  it('requires an explicit operator opt-in', () => {
    expect(envSchema.parse({}).CONSENT_EVIDENCE_PURGE_ENABLED).toBe(false);
    expect(envSchema.parse({
      CONSENT_EVIDENCE_PURGE_ENABLED: 'true',
    }).CONSENT_EVIDENCE_PURGE_ENABLED).toBe(true);
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
