import { z } from 'zod';

/** Parse, don't cast: the process refuses to boot on invalid configuration. */
export const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    APP_ENV: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(48730),
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
    APP_BASE_DOMAIN: z.string().default('localhost'),
    APP_BASE_URL: z.string().url().default('http://localhost:48730'),
    APP_COMMIT_SHA: z.string().min(1).optional(),
    TENANT_CREATION: z.enum(['open', 'closed']).default('closed'),
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
    EMAIL_PROVIDER: z.enum(['ses', 'dev']).default('dev'),
    EMAIL_FROM: z.string().min(1).optional(),
    EMAIL_DISPATCH_SECRET: z.string().min(16).default('dev-email-dispatch-secret'),
    MARKETING_TICK_SECRET: z.string().min(16).default('dev-marketing-tick-secret'),
    CRON_SECRET: z.string().min(16).optional(),
    SNS_TEST_CERT_PEM_BASE64: z.string().min(1).optional(),
    EMAIL_DISPATCH_RATE_PER_SECOND: z.coerce.number().positive().default(5),
    EMAIL_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(100).max(2000).default(1000),
    KSEF_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    EMAIL_DISPATCH_ATTEMPTS_CAP: z.coerce.number().int().positive().default(5),
    EMAIL_DISPATCH_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(1000),
    EMAIL_DISPATCH_BACKOFF_CAP_MS: z.coerce.number().int().positive().default(900000),
    NOTIFY_EMAIL: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    WEB_DIST_DIR: z.string().default('dist/web'),
  })
  .superRefine((env, ctx) => {
    const production = env.NODE_ENV === 'production' || env.APP_ENV === 'production';
    if (!production) return;
    if (env.BETTER_AUTH_SECRET === 'dev-only-secret-do-not-use-in-prod') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BETTER_AUTH_SECRET'],
        message: 'BETTER_AUTH_SECRET must be set to a production secret',
      });
    }
    if (env.SECRETS_MASTER_KEY === 'dG9nZXRoZXItZGV2LXNlY3JldHMtbWFzdGVyLWtleSE=') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SECRETS_MASTER_KEY'],
        message: 'SECRETS_MASTER_KEY must be set to a production key (32 random bytes, base64)',
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
