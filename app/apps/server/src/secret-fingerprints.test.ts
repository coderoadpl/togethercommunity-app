import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { secretFingerprint } from '#adapters/crypto/secret-fingerprint.js';
import {
  API_PATHS,
  envelopeSchema,
  FINGERPRINTED_SECRET_NAMES,
  OUT_OF_SCHEMA_SECRET_NAMES,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  SECRET_FINGERPRINT_NAMES,
  SECRET_FINGERPRINT_READ_SECRET_HEADER,
  secretFingerprintsOutputSchema,
} from '#core/contract/index.js';

import type { AppVars } from './app-vars.js';
import { selectOperatorSecret } from './composition.js';
import { DEV_EMAIL_DISPATCH_SECRET, envSchema } from './env.js';
import {
  registerSecretFingerprintsRoute,
  secretFingerprintsGuard,
  secretFingerprintsOf,
  selectSecretFingerprintReadSecret,
} from './secret-fingerprints.js';

const NOT_FINGERPRINTED_ENV_NAMES = [
  'PLATFORM_EGRESS_IP', 'PLATFORM_EGRESS_ECHO_URL', 'TELEMETRY_FREE_PLAN_HIDES_STATS', 'NODE_ENV', 'APP_ENV',
  'PORT', 'INTERNAL_PORT', 'DB_DRIVER', 'DATABASE_POOL_MAX', 'REALTIME_TRANSPORT', 'APP_BASE_DOMAIN',
  'APP_BASE_URL', 'APP_CUSTOM_DOMAIN_TARGET', 'DOMAIN_PROVISIONER_APEX_A_RECORD', 'APP_COMMIT_SHA',
  'DOMAIN_PROVISIONER_PROJECT_ID', 'DOMAIN_PROVISIONER_TEAM_ID', 'DOMAIN_PROVISIONER_GIT_BRANCH', 'VERCEL_URL',
  'VERCEL_BRANCH_URL', 'AUTH_TRUSTED_PROXY_HEADER', 'TENANT_CREATION', 'SHOP_MANAGEMENT_KEYS', 'PLATFORM_OWNER_EMAILS',
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
const readSecret = 'test-only-fingerprint-read-secret';
const values = {
  BETTER_AUTH_SECRET: 'test-only-better-auth-secret',
  CRON_SECRET: 'test-only-cron-secret-value',
  OPERATOR_SECRET: operatorSecret,
  SECRET_FINGERPRINT_READ_SECRET: readSecret,
  DATABASE_URL: 'postgres://user:test-only-db-password@db.example.test:5432/together',
  SMTP_PASSWORD: '',
};
const processEnv = { AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: ' test-only-aws-secret-access-key\n' };
const allNames = SECRET_FINGERPRINT_NAMES;

const harness = (env: Parameters<typeof secretFingerprintsOf>[0] = envSchema.parse(values)) => {
  const app = new Hono<AppVars>();
  registerSecretFingerprintsRoute(app, {
    secretFingerprintReadSecret: readSecret, secretFingerprints: secretFingerprintsOf(env, processEnv),
  });
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

  it('pin the secrets read from the process environment outside the schema to the AWS SDK credential pair', () => {
    expect([...OUT_OF_SCHEMA_SECRET_NAMES]).toEqual(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);
    const schemaNames = new Set(Object.keys(envSchema._def.schema.shape));
    expect(OUT_OF_SCHEMA_SECRET_NAMES.filter((name) => schemaNames.has(name))).toEqual([]);
  });
});

describe('secretFingerprintsOf', () => {
  it('fingerprints the exact value the server parsed and marks absent or empty values as not set', () => {
    const env = envSchema.parse({ ...values, CRON_SECRET: ` ${values.CRON_SECRET}\n` });
    const byName = new Map(secretFingerprintsOf(env, processEnv).map((entry) => [entry.name, entry]));
    expect(byName.get('CRON_SECRET')).toEqual({
      name: 'CRON_SECRET', set: true, fingerprint: secretFingerprint('CRON_SECRET', ` ${values.CRON_SECRET}\n`),
    });
    expect(byName.get('BETTER_AUTH_SECRET')?.fingerprint).toBe('55cfdafba1172c2d');
    expect(byName.get('SMTP_PASSWORD')).toEqual({ name: 'SMTP_PASSWORD', set: false, fingerprint: null });
    expect(byName.get('GOOGLE_CLIENT_SECRET')).toEqual({ name: 'GOOGLE_CLIENT_SECRET', set: false, fingerprint: null });
    expect([...byName.keys()]).toEqual(allNames);
  });

  it('fingerprints the raw process value of an out-of-schema secret and marks an absent or empty one as not set', () => {
    const byName = new Map(secretFingerprintsOf(envSchema.parse(values), processEnv).map((entry) => [entry.name, entry]));
    expect(byName.get('AWS_SECRET_ACCESS_KEY')).toEqual({
      name: 'AWS_SECRET_ACCESS_KEY',
      set: true,
      fingerprint: secretFingerprint('AWS_SECRET_ACCESS_KEY', processEnv.AWS_SECRET_ACCESS_KEY),
    });
    expect(byName.get('AWS_ACCESS_KEY_ID')).toEqual({ name: 'AWS_ACCESS_KEY_ID', set: false, fingerprint: null });
    expect(secretFingerprintsOf(envSchema.parse(values), {}).find((entry) => entry.name === 'AWS_SECRET_ACCESS_KEY'))
      .toEqual({ name: 'AWS_SECRET_ACCESS_KEY', set: false, fingerprint: null });
  });

  it('reports a value left at its schema default as not set, so a missing DATABASE_URL never fingerprints the localhost default', () => {
    const byName = new Map(secretFingerprintsOf(envSchema.parse({ CRON_SECRET: values.CRON_SECRET }), {}).map((entry) => [entry.name, entry]));
    expect(byName.get('DATABASE_URL')).toEqual({ name: 'DATABASE_URL', set: false, fingerprint: null });
    expect(byName.get('EMAIL_DISPATCH_SECRET')).toEqual({ name: 'EMAIL_DISPATCH_SECRET', set: false, fingerprint: null });
    expect(byName.get('CRON_SECRET')?.set).toBe(true);
  });

  it('reports an empty DATABASE_URL, the one fingerprinted name the schema keeps empty, as not set', () => {
    const env = envSchema.parse({ ...values, DATABASE_URL: '' });
    expect(env.DATABASE_URL).toBe('');
    expect(secretFingerprintsOf(env, {}).find((entry) => entry.name === 'DATABASE_URL'))
      .toEqual({ name: 'DATABASE_URL', set: false, fingerprint: null });
  });
});

describe('selectSecretFingerprintReadSecret', () => {
  it('keeps the route off while SECRET_FINGERPRINT_READ_SECRET is unset', () => {
    const env = envSchema.parse({ ...values, SECRET_FINGERPRINT_READ_SECRET: undefined });
    expect(selectSecretFingerprintReadSecret(env, processEnv, selectOperatorSecret(env))).toBeUndefined();
  });

  it('returns a read secret that differs from every platform secret', () => {
    const env = envSchema.parse(values);
    expect(selectSecretFingerprintReadSecret(env, processEnv, selectOperatorSecret(env))).toBe(readSecret);
  });

  it.each([
    ['OPERATOR_SECRET', { OPERATOR_SECRET: readSecret }, {}],
    ['PROD_OPERATOR_SECRET', { OPERATOR_SECRET: undefined, PROD_OPERATOR_SECRET: readSecret }, {}],
    ['STAGING_OPERATOR_SECRET', { STAGING_OPERATOR_SECRET: readSecret }, {}],
    ['CRON_SECRET', { CRON_SECRET: readSecret }, {}],
    ['EMAIL_DISPATCH_SECRET', { EMAIL_DISPATCH_SECRET: readSecret }, {}],
    ['BETTER_AUTH_SECRET', { BETTER_AUTH_SECRET: readSecret }, {}],
    ['AWS_SECRET_ACCESS_KEY', {}, { AWS_SECRET_ACCESS_KEY: readSecret }],
  ] as const)('keeps the route off when the read secret equals %s', (_name, override, processOverride) => {
    const env = envSchema.parse({ ...values, ...override });
    expect(selectSecretFingerprintReadSecret(env, { ...processEnv, ...processOverride }, selectOperatorSecret(env)))
      .toBeUndefined();
  });

  it('keeps the route off when the read secret equals the dispatch default the operator secret falls back to', () => {
    const env = envSchema.parse({ SECRET_FINGERPRINT_READ_SECRET: DEV_EMAIL_DISPATCH_SECRET });
    expect(selectOperatorSecret(env)).toBe(DEV_EMAIL_DISPATCH_SECRET);
    expect(selectSecretFingerprintReadSecret(env, {}, selectOperatorSecret(env))).toBeUndefined();
  });
});

const sharedRejection = { ok: false, error: { code: 'unauthorized', message: 'Invalid operator secret' } };

describe('secret fingerprint guard', () => {
  const guarded = (secretFingerprintReadSecret: string | undefined) => {
    const downstream = vi.fn(() => new Response('downstream', { status: 200 }));
    const app = new Hono<AppVars>();
    app.use('*', secretFingerprintsGuard({ secretFingerprintReadSecret }));
    app.get('*', downstream);
    return { app, downstream };
  };

  it('passes the matching read secret on in its own header', async () => {
    const { app, downstream } = guarded(readSecret);
    const response = await app.request('/', { headers: { [SECRET_FINGERPRINT_READ_SECRET_HEADER]: readSecret } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('downstream');
    expect(downstream).toHaveBeenCalledOnce();
  });

  it.each([
    ['no read secret is configured', undefined, { [SECRET_FINGERPRINT_READ_SECRET_HEADER]: readSecret }],
    ['the read secret arrives in the operator header', readSecret, { [SCHEDULER_OPERATOR_SECRET_HEADER]: readSecret }],
    ['the operator secret arrives in the operator header', readSecret, { [SCHEDULER_OPERATOR_SECRET_HEADER]: operatorSecret }],
    ['the operator secret arrives in the read header', readSecret, { [SECRET_FINGERPRINT_READ_SECRET_HEADER]: operatorSecret }],
    ['the read header is wrong', readSecret, { [SECRET_FINGERPRINT_READ_SECRET_HEADER]: 'wrong-read-secret' }],
  ] as const)('rejects with the shared 401 when %s', async (_case, configured, headers) => {
    const { app, downstream } = guarded(configured);
    const response = await app.request('/', { headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(sharedRejection);
    expect(downstream).not.toHaveBeenCalled();
  });
});

describe('secret fingerprint route', () => {
  it.each([undefined, 'wrong-read-secret', ''])('rejects the read secret %j with the shared 401', async (candidate) => {
    const headers = candidate === undefined ? {} : { [SECRET_FINGERPRINT_READ_SECRET_HEADER]: candidate };
    const response = await harness().request(API_PATHS.secretFingerprints, { headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(sharedRejection);
  });

  it('returns only names, set flags and fingerprints, with no value material', async () => {
    const response = await harness().request(API_PATHS.secretFingerprints, {
      headers: { [SECRET_FINGERPRINT_READ_SECRET_HEADER]: readSecret },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    const payload = envelopeSchema(secretFingerprintsOutputSchema).parse(JSON.parse(text));
    expect(payload.ok && payload.data.secrets.map((entry) => entry.name)).toEqual(allNames);
    expect(payload.ok && payload.data.secrets.find((entry) => entry.name === 'SECRET_FINGERPRINT_READ_SECRET')).toEqual({
      name: 'SECRET_FINGERPRINT_READ_SECRET', set: true, fingerprint: secretFingerprint('SECRET_FINGERPRINT_READ_SECRET', readSecret),
    });
    const leakable = [...Object.values(values), ...Object.values(processEnv)].map((value) => value.trim()).filter((value) => value !== '');
    for (const value of [...leakable, 'test-only', 'db-password']) {
      expect(text).not.toContain(value);
    }
    expect(text).not.toMatch(/length|prefix|value/i);
  });

  it('refuses the production operator secret in either header and serves only the read secret', async () => {
    const productionOperatorSecret = 'test-only-production-operator-secret';
    const env = envSchema.parse({ ...values, OPERATOR_SECRET: undefined, PROD_OPERATOR_SECRET: productionOperatorSecret });
    expect(selectOperatorSecret(env)).toBe(productionOperatorSecret);
    const app = new Hono<AppVars>();
    app.use(API_PATHS.secretFingerprints, secretFingerprintsGuard({
      secretFingerprintReadSecret: selectSecretFingerprintReadSecret(env, {}, selectOperatorSecret(env)),
    }));
    registerSecretFingerprintsRoute(app, {
      secretFingerprintReadSecret: selectSecretFingerprintReadSecret(env, {}, selectOperatorSecret(env)),
      secretFingerprints: secretFingerprintsOf(env, {}),
    });
    for (const header of [SCHEDULER_OPERATOR_SECRET_HEADER, SECRET_FINGERPRINT_READ_SECRET_HEADER]) {
      const response = await app.request(API_PATHS.secretFingerprints, { headers: { [header]: productionOperatorSecret } });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual(sharedRejection);
    }
    const served = await app.request(API_PATHS.secretFingerprints, { headers: { [SECRET_FINGERPRINT_READ_SECRET_HEADER]: readSecret } });
    expect(served.status).toBe(200);
  });

  it('stays off on a preview deployment that set no read secret, also for the public dispatch default', async () => {
    const env = envSchema.parse({
      NODE_ENV: 'production',
      APP_ENV: 'preview',
      APP_BASE_URL: 'https://preview.example.test',
      DATABASE_URL: 'postgres://preview:test-only-preview-db-password@db.example.test/together',
      SMOKE_MEMBER_PASSWORD: 'test-only-smoke-password',
    });
    expect(selectOperatorSecret(env)).toBe(DEV_EMAIL_DISPATCH_SECRET);
    const app = new Hono<AppVars>();
    registerSecretFingerprintsRoute(app, {
      secretFingerprintReadSecret: selectSecretFingerprintReadSecret(env, {}, selectOperatorSecret(env)),
      secretFingerprints: secretFingerprintsOf(env, {}),
    });
    for (const header of [SCHEDULER_OPERATOR_SECRET_HEADER, SECRET_FINGERPRINT_READ_SECRET_HEADER]) {
      const response = await app.request(API_PATHS.secretFingerprints, { headers: { [header]: DEV_EMAIL_DISPATCH_SECRET } });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual(sharedRejection);
    }
  });

  it('logs nothing while answering', async () => {
    const consoleCalls = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));
    await harness().request(API_PATHS.secretFingerprints, { headers: { [SECRET_FINGERPRINT_READ_SECRET_HEADER]: readSecret } });
    await harness().request(API_PATHS.secretFingerprints, { headers: { [SECRET_FINGERPRINT_READ_SECRET_HEADER]: 'wrong-read-secret' } });
    for (const spy of consoleCalls) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
