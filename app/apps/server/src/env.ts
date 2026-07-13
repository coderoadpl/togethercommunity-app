import { z } from 'zod';

/** Parse, don't cast: the process refuses to boot on invalid configuration. */
const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    APP_ENV: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(48730),
    DATABASE_URL: z
      .string()
      .default('postgres://together:together@localhost:48912/together'),
    DB_DRIVER: z.enum(['node-postgres', 'neon-http']).default('node-postgres'),
    APP_BASE_DOMAIN: z.string().default('localhost'),
    APP_BASE_URL: z.string().url().default('http://localhost:48730'),
    BETTER_AUTH_SECRET: z.string().min(16).default('dev-only-secret-do-not-use-in-prod'),
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
    if (env.EMAIL_PROVIDER === 'ses' && !env.EMAIL_FROM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_FROM'],
        message: 'EMAIL_FROM must be set when EMAIL_PROVIDER=ses',
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
