import { z } from 'zod';

import { normalizeEmail } from './email.js';
import { consentDefinitionVersionSchema } from './marketing-email.js';
import { marketingTagsSchema } from './marketing-contact.js';

const marketingSignupFormSlugSchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const httpsUrlSchema = z.string().url().max(2000).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && url.username === '' && url.password === '';
}, 'A HTTPS URL without credentials is required');
const allowedOriginSchema = httpsUrlSchema.refine((value) => URL.canParse(value) && new URL(value).origin === value && !new URL(value).hostname.includes('*'), 'An exact HTTPS origin is required');

const marketingSignupFormSuccessTextSchema = z.object({
  pl: z.string().trim().min(1).max(500),
  en: z.string().trim().min(1).max(500),
}).strict();

export const marketingSignupFormSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  slug: marketingSignupFormSlugSchema,
  name: z.string().trim().min(1).max(200),
  consentDefinitionId: z.string().min(1),
  consentVersion: consentDefinitionVersionSchema,
  listId: z.string().min(1).nullable(),
  tags: marketingTagsSchema,
  collectName: z.boolean(),
  successText: marketingSignupFormSuccessTextSchema,
  redirectUrl: httpsUrlSchema.nullable(),
  allowedOrigins: z.array(allowedOriginSchema).max(20).transform((origins) => [...new Set(origins)]),
  token: z.string().regex(/^[A-Za-z0-9_-]{22,}$/),
  status: z.enum(['active', 'archived']),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MarketingSignupForm = z.output<typeof marketingSignupFormSchema>;

export const marketingSignupFormInputSchema = marketingSignupFormSchema.pick({
  slug: true,
  name: true,
  consentDefinitionId: true,
  listId: true,
  tags: true,
  collectName: true,
  successText: true,
  redirectUrl: true,
  allowedOrigins: true,
  status: true,
}).extend({
  status: z.enum(['active', 'archived']).default('active'),
  listId: z.string().min(1).nullable().default(null),
  tags: marketingTagsSchema.default([]),
  collectName: z.boolean().default(false),
  redirectUrl: httpsUrlSchema.nullable().default(null),
  allowedOrigins: z.array(allowedOriginSchema).max(20).default([]),
}).strict();

export const marketingSignupFormUpdateSchema = marketingSignupFormInputSchema.extend({
  expectedRevision: z.number().int().positive(),
}).strict();

export const marketingSignupFormCountersSchema = z.object({
  submissions24h: z.number().int().nonnegative(),
  submissions7d: z.number().int().nonnegative(),
  submissionsTotal: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  computedAt: z.string().datetime(),
});

export type MarketingSignupFormCounters = z.output<typeof marketingSignupFormCountersSchema>;

export const marketingSignupSubmissionSchema = z.object({
  email: z.string().trim().transform(normalizeEmail).pipe(z.string().email().max(254)),
  displayName: z.string().trim().max(120).optional().transform((value) => value === '' ? undefined : value),
  website: z.string().max(500).optional().default(''),
  token: z.string().min(1).max(200),
});

export const isMarketingSignupHoneypot = (input: unknown): boolean => {
  const parsed = z.object({ website: z.string() }).safeParse(input);
  return parsed.success && parsed.data.website !== '';
};
