import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { secretFingerprint } from '#adapters/crypto/secret-fingerprint.js';
import {
  API_PATHS,
  envelopeSchema,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  secretFingerprintsOutputSchema,
} from '#core/contract/index.js';

import type { AppVars } from './app-vars.js';
import { envSchema } from './env.js';
import { FINGERPRINTED_SECRET_NAMES, registerSecretFingerprintsRoute, secretFingerprintsOf } from './secret-fingerprints.js';

const NOT_FINGERPRINTED_ENV_NAMES = [
  'PLATFORM_EGRESS_IP', 'PLATFORM_EGRESS_ECHO_URL', 'TELEMETRY_FREE_PLAN_HIDES_STATS', 'NODE_ENV', 'APP_ENV',
  'PORT', 'INTERNAL_PORT', 'DB_DRIVER', 'DATABASE_POOL_MAX', 'REALTIME_TRANSPORT', 'APP_BASE_DOMAIN',
  'APP_BASE_URL', 'APP_CUSTOM_DOMAIN_TARGET', 'DOMAIN_PROVISIONER_APEX_A_RECORD', 'APP_COMMIT_SHA',
  'DOMAIN_PROVISIONER_PROJECT_ID', 'DOMAIN_PROVISIONER_TEAM_ID', 'DOMAIN_PROVISIONER_GIT_BRANCH', 'VERCEL_URL',
  'VERCEL_BRANCH_URL', 'AUTH_TRUSTED_PROXY_HEADER', 'TENANT_CREATION', 'PLATFORM_OWNER_EMAILS',
  'PRODUCTION_DATABASE_FINGERPRINT', 'PAYMENT_PROVIDER', 'KSEF_ENVIRONMENT', 'KSEF_TEST_BASE_URL',
  'KSEF_PRODUCTION_BASE_URL', 'SECURE_COOKIES', 'SIMULATED_PAYMENTS', 'AUTH_DEV_EXPOSE_MAGIC_LINKS',
  'STORAGE_ALLOW_PRIVATE_ENDPOINTS', 'PERSONALISATION_MAX_BYTES', 'PLAYBACK_TOKEN_TTL_SECONDS',
  'TOGETHER_VISUAL_CLOCK', 'EMAIL_PROVIDER', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER',
  'SNS_TEST_CERT_PEM_BASE64', 'EMAIL_DISPATCH_RATE_PER_SECOND', 'MARKETING_WORKER_SECONDS',
  'MARKETING_SEND_SECONDS', 'MARKETING_BATCH_CAP', 'MARKETING_WORKER_INTERVAL_MS',
  'MARKETING_RETENTION_ENGAGEMENT_EVENTS_DAYS', 'MARKETING_RETENTION_RAW_SNS_INBOX_DAYS',
  'MARKETING_RETENTION_RENDERED_BODIES_DAYS', 'MARKETING_RETENTION_PENDING_CONSENTS_DAYS',
  'MARKETING_RETENTION_SCHEDULER_RUNS_DAYS', 'MARKETING_RETENTION_SCHEDULER_IDLE_RUNS_DAYS',
  'EMAIL_DISPATCH_INTERVAL_MS', 'KSEF_DISPATCH_INTERVAL_MS', 'CONSENT_EVIDENCE_PURGE_ENABLED',
  'EMAIL_DISPATCH_ATTEMPTS_CAP', 'EMAIL_DISPATCH_BACKOFF_BASE_MS', 'EMAIL_DISPATCH_BACKOFF_CAP_MS',
  'PUBLIC_RATE_LIMIT_REDIRECT_HITS_PER_REDIRECT_PER_MINUTE', 'PUBLIC_RATE_LIMIT_CHECKOUT_STATUS_PER_IP_PER_5_MINUTES',
  'PUBLIC_RATE_LIMIT_WRITES_PER_IP_PER_MINUTE', 'PUBLIC_RATE_LIMIT_WRITES_PER_TENANT_PER_MINUTE',
  'PUBLIC_RATE_LIMIT_SIGN_IN_PER_IP_PER_MINUTE', 'PUBLIC_RATE_LIMIT_SIGN_IN_PER_EMAIL_PER_10_MINUTES',
  'PUBLIC_RATE_LIMIT_AUTH_LINKS_PER_EMAIL_PER_10_MINUTES', 'PUBLIC_RATE_LIMIT_AUTH_RESOLVES_PER_IP_PER_MINUTE',
  'PUBLIC_RATE_LIMIT_AUTH_RESOLVES_PER_TENANT_PER_MINUTE', 'PUBLIC_RATE_LIMIT_DEEP_HEALTH_PER_IP_PER_MINUTE',
  'PUBLIC_RATE_LIMIT_SIGNUPS_PER_IP_PER_MINUTE', 'PUBLIC_RATE_LIMIT_SIGNUPS_PER_EMAIL_PER_10_MINUTES',
  'IMPORT_DAILY_MEMBER_RECORD_LIMIT', 'IMPORT_HOURLY_VALIDATION_RECORD_LIMIT', 'IMPORT_DAILY_RECORD_LIMIT',
  'M2M_TRANSACTIONAL_EMAIL_RATE_PER_MINUTE', 'M2M_TRANSACTIONAL_EMAIL_RATE_PER_DAY', 'NOTIFY_EMAIL',
  'GOOGLE_CLIENT_ID', 'WEB_DIST_DIR',
];

const SECRET_LIKE_NAME = /SECRET|PASSWORD|_TOKEN$|_KEY$|DATABASE_URL|CREDENTIAL/;

const operatorSecret = 'test-only-operator-secret';
const values = {
  BETTER_AUTH_SECRET: 'test-only-better-auth-secret',
  CRON_SECRET: 'test-only-cron-secret-value',
  DATABASE_URL: 'postgres://user:test-only-db-password@db.example.test:5432/together',
  SMTP_PASSWORD: '',
};

const harness = (env: Parameters<typeof secretFingerprintsOf>[0] = envSchema.parse(values)) => {
  const app = new Hono<AppVars>();
  registerSecretFingerprintsRoute(app, { operatorSecret, secretFingerprints: secretFingerprintsOf(env) });
  return app;
};

describe('fingerprinted secret names', () => {
  it('classify every variable the server env schema reads exactly once', () => {
    const schemaNames = Object.keys(envSchema._def.schema.shape).sort();
    const classified = [...FINGERPRINTED_SECRET_NAMES, ...NOT_FINGERPRINTED_ENV_NAMES];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual(schemaNames);
  });

  it('leave no secret-looking variable without a fingerprint', () => {
    expect(NOT_FINGERPRINTED_ENV_NAMES.filter((name) => SECRET_LIKE_NAME.test(name))).toEqual([]);
  });
});

describe('secretFingerprintsOf', () => {
  it('fingerprints the exact value the server parsed and marks absent or empty values as not set', () => {
    const env = envSchema.parse({ ...values, CRON_SECRET: ` ${values.CRON_SECRET}\n` });
    const byName = new Map(secretFingerprintsOf(env).map((entry) => [entry.name, entry]));
    expect(byName.get('CRON_SECRET')).toEqual({
      name: 'CRON_SECRET', set: true, fingerprint: secretFingerprint('CRON_SECRET', ` ${values.CRON_SECRET}\n`),
    });
    expect(byName.get('BETTER_AUTH_SECRET')?.fingerprint).toBe('55cfdafba1172c2d');
    expect(byName.get('SMTP_PASSWORD')).toEqual({ name: 'SMTP_PASSWORD', set: false, fingerprint: null });
    expect(byName.get('GOOGLE_CLIENT_SECRET')).toEqual({ name: 'GOOGLE_CLIENT_SECRET', set: false, fingerprint: null });
    expect([...byName.keys()]).toEqual([...FINGERPRINTED_SECRET_NAMES]);
  });

  it('reports a value left at its schema default as not set, so a missing DATABASE_URL never fingerprints the localhost default', () => {
    const byName = new Map(secretFingerprintsOf(envSchema.parse({ CRON_SECRET: values.CRON_SECRET })).map((entry) => [entry.name, entry]));
    expect(byName.get('DATABASE_URL')).toEqual({ name: 'DATABASE_URL', set: false, fingerprint: null });
    expect(byName.get('EMAIL_DISPATCH_SECRET')).toEqual({ name: 'EMAIL_DISPATCH_SECRET', set: false, fingerprint: null });
    expect(byName.get('CRON_SECRET')?.set).toBe(true);
  });

  it('reports an empty DATABASE_URL, the one fingerprinted name the schema keeps empty, as not set', () => {
    const env = envSchema.parse({ ...values, DATABASE_URL: '' });
    expect(env.DATABASE_URL).toBe('');
    expect(secretFingerprintsOf(env).find((entry) => entry.name === 'DATABASE_URL'))
      .toEqual({ name: 'DATABASE_URL', set: false, fingerprint: null });
  });
});

describe('secret fingerprint route', () => {
  it.each([undefined, 'wrong-operator-secret', ''])('rejects the operator secret %j with the shared operator error', async (candidate) => {
    const headers = candidate === undefined ? {} : { [SCHEDULER_OPERATOR_SECRET_HEADER]: candidate };
    const response = await harness().request(API_PATHS.secretFingerprints, { headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Invalid operator secret' } });
  });

  it('returns only names, set flags and fingerprints, with no value material', async () => {
    const response = await harness().request(API_PATHS.secretFingerprints, {
      headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: operatorSecret },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    const payload = envelopeSchema(secretFingerprintsOutputSchema).parse(JSON.parse(text));
    expect(payload.ok && payload.data.secrets.map((entry) => entry.name)).toEqual([...FINGERPRINTED_SECRET_NAMES]);
    for (const value of [...Object.values(values).filter((value) => value !== ''), operatorSecret, 'test-only', 'db-password']) {
      expect(text).not.toContain(value);
    }
    expect(text).not.toMatch(/length|prefix|value/i);
  });

  it('logs nothing while answering', async () => {
    const consoleCalls = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));
    await harness().request(API_PATHS.secretFingerprints, { headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: operatorSecret } });
    await harness().request(API_PATHS.secretFingerprints, { headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: 'wrong-operator-secret' } });
    for (const spy of consoleCalls) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
