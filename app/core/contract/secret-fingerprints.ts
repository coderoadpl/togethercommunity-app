import { z } from 'zod';

const secretNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

export const secretFingerprintSchema = z.discriminatedUnion('set', [
  z.object({ name: secretNameSchema, set: z.literal(true), fingerprint: z.string().regex(/^[0-9a-f]{16}$/) }).strict(),
  z.object({ name: secretNameSchema, set: z.literal(false), fingerprint: z.null() }).strict(),
]);

export const secretFingerprintsOutputSchema = z.object({
  secrets: z.array(secretFingerprintSchema),
}).strict();

export type SecretFingerprint = z.infer<typeof secretFingerprintSchema>;
export type SecretFingerprints = z.infer<typeof secretFingerprintsOutputSchema>;
