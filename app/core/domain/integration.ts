import { z } from 'zod';

export const integrationProviderSchema = z.enum(['storage', 'email', 'payment']);

export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

export const stripeModeSchema = z.enum(['test', 'live']);

export type StripeMode = z.infer<typeof stripeModeSchema>;

export const stripeModeFromKey = (restrictedKey: string): StripeMode | null => {
  if (restrictedKey.startsWith('rk_test_')) return 'test';
  if (restrictedKey.startsWith('rk_live_')) return 'live';
  return null;
};

export const configureStripeInputSchema = z.object({
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
});

export type ProviderDiagnostic = z.infer<typeof providerDiagnosticSchema>;
