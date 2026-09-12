import { z } from 'zod';

export const integrationProviderSchema = z.enum(['storage', 'email', 'payment']);

export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

export const emailIntegrationTransportSchema = z.enum(['smtp', 'ses', 'resend']);

export type EmailIntegrationTransport = z.infer<typeof emailIntegrationTransportSchema>;

export const stripeModeSchema = z.enum(['test', 'live']);

export type StripeMode = z.infer<typeof stripeModeSchema>;

export const stripeModeFromKey = (restrictedKey: string): StripeMode | null => {
  if (restrictedKey.startsWith('rk_test_')) return 'test';
  if (restrictedKey.startsWith('rk_live_')) return 'live';
  return null;
};

// A stored key may carry no recognisable prefix, so only a positively
// identified opposite mode counts as a conflict when the key is read back.
export const stripeKeyModeConflicts = (restrictedKey: string, mode: StripeMode): boolean => {
  const detected = stripeModeFromKey(restrictedKey);
  return detected !== null && detected !== mode;
};

export const configureStripeInputSchema = z.object({
  mode: stripeModeSchema.default('live'),
  restrictedKey: z.string().trim().min(1),
});

export type ConfigureStripeInput = z.input<typeof configureStripeInputSchema>;

const providerDiagnosticCodeSchema = z.enum([
  'storage.available',
  'email.available',
  'payment.available',
]);

export type ProviderDiagnosticCode = z.infer<typeof providerDiagnosticCodeSchema>;

export const providerDiagnosticSchema = z.object({
  code: providerDiagnosticCodeSchema,
  message: z.string().min(1),
  details: z.object({ transport: z.string().min(1) }).optional(),
});

export type ProviderDiagnostic = z.infer<typeof providerDiagnosticSchema>;

export const stripeTestSessionEncryptedSchema = z.object({ ciphertext: z.string(), iv: z.string(), authTag: z.string() });
export const stripeTestSessionPayloadSchema = z.object({ userId: z.string(), tenantId: z.string(), expiresAt: z.number() });
