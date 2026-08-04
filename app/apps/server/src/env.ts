import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().min(1).optional(),
);

const optionalHeaderName = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().regex(/^[a-z0-9-]+$/).optional(),
);

const isLocalHostname = (hostname: string): boolean =>
  hostname === 'localhost'
  || hostname.endsWith('.localhost')
  || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  || hostname === '[::1]';

const NON_PRODUCTION_APP_ENVS: readonly string[] = ['preview', 'staging'];

/**
 * Vercel sets `NODE_ENV=production` on Preview deployments as well, so
 * `NODE_ENV` alone cannot separate a preview from production. Only an
 * explicitly named non-production `APP_ENV` opts out; anything unrecognised
 * keeps the strict production posture.
 */
export const isProductionEnvironment = (
  env: { NODE_ENV?: string | undefined; APP_ENV?: string | undefined },
): boolean =>
  env.APP_ENV === 'production'
  || (env.NODE_ENV === 'production' && !NON_PRODUCTION_APP_ENVS.includes(env.APP_ENV ?? ''));

/** Parse, don't cast: the process refuses to boot on invalid configuration. */
export const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    APP_ENV: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(48730),
    INTERNAL_PORT: z.coerce.number().int().positive().optional(),
    DATABASE_URL: z
      .string()
      .default('postgres://together:together@localhost:48912/together'),
    DB_DRIVER: z
      .literal('node-postgres', {
        errorMap: () => ({
          message:
            'DB_DRIVER must be node-postgres because runtime adapters require interactive transactions',
        }),
      })
      .default('node-postgres'),
    APP_BASE_DOMAIN: optionalNonEmptyString,
    APP_BASE_URL: z.string().url().default('http://localhost:48730'),
    APP_COMMIT_SHA: optionalNonEmptyString,
    VERCEL_URL: optionalNonEmptyString,
    VERCEL_BRANCH_URL: optionalNonEmptyString,
    AUTH_TRUSTED_PROXY_HEADER: optionalHeaderName,
    TENANT_CREATION: z.enum(['open', 'closed']).default('open'),
    BETTER_AUTH_SECRET: z.string().min(16).default('dev-only-secret-do-not-use-in-prod'),
    // 32-byte AES-256-GCM key, base64. Generate: openssl rand -base64 32
    SECRETS_MASTER_KEY: z.string().min(1).default('dG9nZXRoZXItZGV2LXNlY3JldHMtbWFzdGVyLWtleSE='),
    PAYMENT_PROVIDER: z.enum(['stripe', 'fake']).default('fake'),
    KSEF_ENVIRONMENT: z.enum(['test', 'production']).default('test'),
    KSEF_TEST_BASE_URL: z.string().url().default('https://api-test.ksef.mf.gov.pl/v2'),
    KSEF_PRODUCTION_BASE_URL: z.string().url().default('https://api.ksef.mf.gov.pl/v2'),
    SECURE_COOKIES: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SIMULATED_PAYMENTS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    AUTH_DEV_EXPOSE_MAGIC_LINKS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    STORAGE_ALLOW_PRIVATE_ENDPOINTS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    PLAYBACK_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(21_600),
    TOGETHER_VISUAL_CLOCK: z.string().datetime({ offset: true }).optional(),
    EMAIL_PROVIDER: z.enum(['ses', 'smtp', 'dev']).default('dev'),
    EMAIL_FROM: optionalNonEmptyString,
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(48925),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: optionalNonEmptyString,
    SMTP_PASSWORD: optionalNonEmptyString,
    EMAIL_DISPATCH_SECRET: z.string().min(16).default('dev-email-dispatch-secret'),
    MARKETING_TICK_SECRET: z.string().min(16).default('dev-marketing-tick-secret'),
    CRON_SECRET: z.string().min(16).optional(),
    SNS_TEST_CERT_PEM_BASE64: optionalNonEmptyString,
    EMAIL_DISPATCH_RATE_PER_SECOND: z.coerce.number().positive().default(5),
    EMAIL_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(100).max(2000).default(1000),
    KSEF_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    CONSENT_EVIDENCE_PURGE_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    EMAIL_DISPATCH_ATTEMPTS_CAP: z.coerce.number().int().positive().default(5),
    EMAIL_DISPATCH_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(1000),
    EMAIL_DISPATCH_BACKOFF_CAP_MS: z.coerce.number().int().positive().default(900000),
    M2M_TRANSACTIONAL_EMAIL_RATE_PER_MINUTE: z.coerce.number().int().positive().default(60),
    M2M_TRANSACTIONAL_EMAIL_RATE_PER_DAY: z.coerce.number().int().positive().default(5000),
    NOTIFY_EMAIL: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    WEB_DIST_DIR: z.string().default('dist/web'),
  })
  .superRefine((env, ctx) => {
    if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [env.SMTP_USER === undefined ? 'SMTP_USER' : 'SMTP_PASSWORD'],
        message: 'SMTP_USER and SMTP_PASSWORD must be set together',
      });
    }
    if (env.EMAIL_PROVIDER === 'smtp' && !env.EMAIL_FROM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_FROM'],
        message: 'EMAIL_FROM must be set when EMAIL_PROVIDER=smtp',
      });
    }
    const appUrl = new URL(env.APP_BASE_URL);
    if (appUrl.protocol !== 'https:' && !isLocalHostname(appUrl.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_BASE_URL'],
        message: 'APP_BASE_URL must use https outside local development',
      });
    }
    if (!isProductionEnvironment(env)) return;
    if (env.BETTER_AUTH_SECRET === 'dev-only-secret-do-not-use-in-prod') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BETTER_AUTH_SECRET'],
        message: 'BETTER_AUTH_SECRET must be set to a production secret',
      });
    }
    if (env.AUTH_TRUSTED_PROXY_HEADER === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_TRUSTED_PROXY_HEADER'],
        message: 'AUTH_TRUSTED_PROXY_HEADER must be set to direct or a protected header in production',
      });
    }
    if (env.SECRETS_MASTER_KEY === 'dG9nZXRoZXItZGV2LXNlY3JldHMtbWFzdGVyLWtleSE=') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SECRETS_MASTER_KEY'],
        message: 'SECRETS_MASTER_KEY must be set to a production key (32 random bytes, base64)',
      });
    }
    if (env.EMAIL_PROVIDER === 'dev') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_PROVIDER'],
        message: "EMAIL_PROVIDER must be 'ses' or 'smtp' in production",
      });
    }
    if (env.PAYMENT_PROVIDER !== 'stripe') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_PROVIDER'],
        message: "PAYMENT_PROVIDER must be 'stripe' in production",
      });
    }
    if (!env.SECURE_COOKIES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SECURE_COOKIES'],
        message: 'SECURE_COOKIES must be true in production',
      });
    }
    if (env.SIMULATED_PAYMENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SIMULATED_PAYMENTS'],
        message: 'SIMULATED_PAYMENTS cannot be enabled in production',
      });
    }
    if (env.AUTH_DEV_EXPOSE_MAGIC_LINKS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_DEV_EXPOSE_MAGIC_LINKS'],
        message: 'AUTH_DEV_EXPOSE_MAGIC_LINKS cannot be enabled in production',
      });
    }
    if (env.TOGETHER_VISUAL_CLOCK !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TOGETHER_VISUAL_CLOCK'],
        message: 'TOGETHER_VISUAL_CLOCK cannot be enabled in production',
      });
    }
    if (env.KSEF_ENVIRONMENT !== 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KSEF_ENVIRONMENT'],
        message: 'KSEF_ENVIRONMENT must be production in a production deployment',
      });
    }
    if (env.EMAIL_PROVIDER === 'ses' && !env.EMAIL_FROM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_FROM'],
        message: 'EMAIL_FROM must be set when EMAIL_PROVIDER=ses',
      });
    }
    if (env.EMAIL_DISPATCH_SECRET === 'dev-email-dispatch-secret') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_DISPATCH_SECRET'],
        message: 'EMAIL_DISPATCH_SECRET must be set to a production secret',
      });
    }
    if (env.MARKETING_TICK_SECRET === 'dev-marketing-tick-secret') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MARKETING_TICK_SECRET'],
        message: 'MARKETING_TICK_SECRET must be set to a production secret',
      });
    }
    if (env.CRON_SECRET === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CRON_SECRET'],
        message: 'CRON_SECRET must be set for production scheduled jobs',
      });
    }
    if (env.SNS_TEST_CERT_PEM_BASE64 !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SNS_TEST_CERT_PEM_BASE64'],
        message: 'SNS_TEST_CERT_PEM_BASE64 cannot be set in production',
      });
    }
  });

export type Env = z.output<typeof envSchema>;

export const loadEnv = (): Env => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
};
