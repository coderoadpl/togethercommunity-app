import { z } from 'zod';

import { adoptStripeSubscriptionInputSchema, listStripeSubscriptionsInputSchema } from '#core/domain/index.js';

export const subscriptionAdoptOptionsSchema = z.object({
  subscription: z.string(), member: z.string(), product: z.string(),
  price: z.string().optional(), allowEmailMismatch: z.boolean().optional(), apiKey: z.string().optional(),
}).transform((options) => ({
  apiKey: options.apiKey,
  input: {
    subscriptionId: options.subscription,
    ...(options.member.includes('@') ? { email: options.member } : { memberId: options.member }),
    productId: options.product,
    ...(options.price === undefined ? {} : { priceId: options.price }),
    ...(options.allowEmailMismatch === undefined ? {} : { allowEmailMismatch: options.allowEmailMismatch }),
  },
})).pipe(z.object({ apiKey: z.string().optional(), input: adoptStripeSubscriptionInputSchema }));

export const subscriptionListOptionsSchema = listStripeSubscriptionsInputSchema.extend({ apiKey: z.string().optional() });
