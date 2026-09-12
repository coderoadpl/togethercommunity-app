import { describe, expect, it } from 'vitest';

import { subscriptionAdoptOptionsSchema, subscriptionListOptionsSchema } from './subscription-input.js';

describe('subscription CLI options', () => {
  it.each(['member-1', 'buyer@example.com'])('parses member %s and an explicit mismatch override', (member) => {
    expect(subscriptionAdoptOptionsSchema.parse({ subscription: 'sub_existing', member, product: 'product-1', price: 'price-1', allowEmailMismatch: true }))
      .toEqual({ input: { subscriptionId: 'sub_existing', ...(member.includes('@') ? { email: member } : { memberId: member }), productId: 'product-1', priceId: 'price-1', allowEmailMismatch: true } });
  });
  it('leaves the override absent and rejects malformed ids', () => {
    expect(subscriptionAdoptOptionsSchema.parse({ subscription: 'sub_existing', member: 'member-1', product: 'product-1' }).input.allowEmailMismatch).toBeUndefined();
    expect(subscriptionAdoptOptionsSchema.safeParse({ subscription: 'not-stripe', member: 'member-1', product: 'product-1' }).success).toBe(false);
  });
  it('parses status, unadopted and cursor and rejects an unknown status', () => {
    const options = { status: 'active', unadopted: true, startingAfter: 'sub_previous' };
    expect(subscriptionListOptionsSchema.parse(options)).toEqual(options);
    expect(subscriptionListOptionsSchema.safeParse({ status: 'unknown' }).success).toBe(false);
  });
});
