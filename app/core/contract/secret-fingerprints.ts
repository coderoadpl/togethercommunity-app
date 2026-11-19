import { z } from 'zod';

export const FINGERPRINTED_SECRET_NAMES = [
  'BETTER_AUTH_SECRET',
  'SECRETS_MASTER_KEY',
  'EMAIL_DISPATCH_SECRET',
  'MARKETING_TICK_SECRET',
  'CRON_SECRET',
  'OPERATOR_SECRET',
  'PROD_OPERATOR_SECRET',
  'STAGING_OPERATOR_SECRET',
  'SECRET_FINGERPRINT_READ_SECRET',
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'REALTIME_DATABASE_URL',
  'DOMAIN_PROVISIONER_TOKEN',
  'SMTP_PASSWORD',
  'GOOGLE_CLIENT_SECRET',
  'SMOKE_MEMBER_PASSWORD',
  'SMOKE_CREATOR_PASSWORD',
] as const;

export const OUT_OF_SCHEMA_SECRET_NAMES = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const;

export const SECRET_FINGERPRINT_NAMES: readonly string[] = [...FINGERPRINTED_SECRET_NAMES, ...OUT_OF_SCHEMA_SECRET_NAMES];

const secretNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

const secretFingerprintSchema = z.discriminatedUnion('set', [
  z.object({ name: secretNameSchema, set: z.literal(true), fingerprint: z.string().regex(/^[0-9a-f]{16}$/) }).strict(),
  z.object({ name: secretNameSchema, set: z.literal(false), fingerprint: z.null() }).strict(),
]);

export const secretFingerprintsOutputSchema = z.object({
  secrets: z.array(secretFingerprintSchema),
}).strict();

export type SecretFingerprint = z.infer<typeof secretFingerprintSchema>;
export type SecretFingerprints = z.infer<typeof secretFingerprintsOutputSchema>;
