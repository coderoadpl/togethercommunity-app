import { z } from 'zod';

import { memberSubscriptionSummarySchema } from './commerce.js';
import { normalizeEmail } from './email.js';
import { APPLICATION_KEY_MAX_PRODUCTS } from './application-key.js';
import type { GrantSource } from './grant.js';

export const ENTITLEMENT_CHECK_VERSION = 1;

const ENTITLEMENT_CHECK_MAX_SUBJECTS = 25;

const entitlementSubjectSchema = z.union([
  z.object({ email: z.string().trim().max(254).email().transform(normalizeEmail) }).strict(),
  z.object({ memberId: z.string().trim().min(1).max(200) }).strict(),
]);

export type EntitlementSubject = z.output<typeof entitlementSubjectSchema>;

export const entitlementCheckInputSchema = z.object({
  subjects: z.array(entitlementSubjectSchema).min(1).max(ENTITLEMENT_CHECK_MAX_SUBJECTS),
  productIds: z.array(z.string().trim().min(1).max(200)).min(1).max(APPLICATION_KEY_MAX_PRODUCTS).optional(),
}).strict();

export type EntitlementCheckInput = z.input<typeof entitlementCheckInputSchema>;

const entitlementSourceSchema = z.enum(['purchase', 'subscription', 'grant', 'import']);

export type EntitlementSource = z.output<typeof entitlementSourceSchema>;

const entitlementSubscriptionSchema = memberSubscriptionSummarySchema.pick({
  status: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
});

const productEntitlementSchema = z.object({
  productId: z.string(),
  access: z.boolean(),
  source: entitlementSourceSchema.nullable(),
  subscription: entitlementSubscriptionSchema.nullable(),
  checkedAt: z.string().datetime(),
});

export type ProductEntitlement = z.output<typeof productEntitlementSchema>;

const entitlementIdentitySchema = z.enum(['verified']);

export type EntitlementIdentity = z.output<typeof entitlementIdentitySchema>;

const entitlementCheckResultSchema = z.object({
  subject: entitlementSubjectSchema,
  // A later release may add ways to match; an older client reads an identity it does not know as no identity.
  identity: entitlementIdentitySchema.nullable().catch(null),
  products: z.array(productEntitlementSchema),
  member: z.object({ id: z.string() }).nullable(),
});

export type EntitlementCheckResult = z.output<typeof entitlementCheckResultSchema>;

export const entitlementCheckOutputSchema = z.object({
  version: z.literal(ENTITLEMENT_CHECK_VERSION),
  results: z.array(entitlementCheckResultSchema),
});

export type EntitlementCheckOutput = z.output<typeof entitlementCheckOutputSchema>;

const sourceByGrantSource: Record<GrantSource, EntitlementSource> = {
  stripe: 'purchase',
  simulated: 'purchase',
  manual: 'grant',
  import: 'import',
};

export const entitlementSourceOf = (grantSource: GrantSource, hasSubscription: boolean): EntitlementSource => {
  const source = sourceByGrantSource[grantSource];
  return source === 'purchase' && hasSubscription ? 'subscription' : source;
};
