import { z } from 'zod';

export const integrationProviderSchema = z.enum(['storage', 'email', 'payment']);

export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

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
