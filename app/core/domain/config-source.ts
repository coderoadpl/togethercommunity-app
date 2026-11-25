import { z } from 'zod';

export const configSourceSchema = z.enum(['workspace', 'organization']);

export type ConfigSource = z.infer<typeof configSourceSchema>;

export const paymentSourcesSchema = z.object({ live: configSourceSchema, test: configSourceSchema }).strict();

export type PaymentSources = z.infer<typeof paymentSourcesSchema>;
