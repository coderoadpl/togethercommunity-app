import { describe, expect, it } from 'vitest';

import { visitorJoinTarget } from './visitor-actions.js';

const emptyOffer = { products: [], salesLinks: [] };
const salesLink = { id: 'l1', slug: 'bundle', heading: 'Bundle', description: '', totalCents: 100, currency: 'PLN' };

describe('visitorJoinTarget', () => {
  it('opens checkout for a product space tied to exactly one product', () => {
    expect(visitorJoinTarget({
      space: { visibility: 'product', products: [{ id: 'p1', title: 'Club pass' }] },
      offer: emptyOffer,
      lockedSpaceCount: 0,
      settled: true,
    })).toEqual({ kind: 'checkout', productId: 'p1' });
    expect(visitorJoinTarget({
      space: { visibility: 'product', products: [{ id: 'p1', title: 'Club pass' }] },
      offer: undefined,
      lockedSpaceCount: 0,
      settled: false,
    })).toEqual({ kind: 'checkout', productId: 'p1' });
  });

  it('points at the offer section for an open space while anything is for sale', () => {
    expect(visitorJoinTarget({ space: { visibility: 'members' }, offer: { products: [], salesLinks: [salesLink] }, lockedSpaceCount: 0, settled: true }))
      .toEqual({ kind: 'offer' });
    expect(visitorJoinTarget({ space: { visibility: 'members' }, offer: emptyOffer, lockedSpaceCount: 1, settled: true }))
      .toEqual({ kind: 'offer' });
  });

  it('waits while the offer or the navigation is still loading', () => {
    expect(visitorJoinTarget({ space: undefined, offer: undefined, lockedSpaceCount: undefined, settled: false }))
      .toEqual({ kind: 'pending' });
    expect(visitorJoinTarget({ space: { visibility: 'members' }, offer: undefined, lockedSpaceCount: 0, settled: false }))
      .toEqual({ kind: 'pending' });
  });

  it('points at the offer section when the offer or the navigation failed to load', () => {
    expect(visitorJoinTarget({ space: undefined, offer: undefined, lockedSpaceCount: 0, settled: true })).toEqual({ kind: 'offer' });
    expect(visitorJoinTarget({ space: undefined, offer: emptyOffer, lockedSpaceCount: undefined, settled: true })).toEqual({ kind: 'offer' });
  });

  it('has no join target when the workspace sells nothing', () => {
    expect(visitorJoinTarget({ space: { visibility: 'members' }, offer: emptyOffer, lockedSpaceCount: 0, settled: true }))
      .toEqual({ kind: 'none' });
  });
});
