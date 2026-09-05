import { describe, expect, it } from 'vitest';

import type { Coupon, Identity } from '#core/domain/index.js';

import type { CouponManagementRepository } from '../ports.js';
import { archiveCoupon, createCoupon } from './coupon-management.js';

const identity: Identity = {
  userId: 'owner-1',
  email: 'owner@example.test',
  name: 'Owner',
  emailVerified: true,
  tenantId: 'tenant-1',
  tenantSlug: 'alpha',
  tenantName: 'Alpha',
  staffRole: 'owner',
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
};

const baseCoupon: Coupon = {
  id: 'coupon-1',
  tenantId: 'tenant-1',
  code: 'PARTNER20',
  kind: 'percent',
  value: 20,
  scope: { kind: 'all' },
  appliesTo: 'both',
  recurringDuration: 'first_invoice',
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  maxRedemptionsPerMember: null,
  status: 'active',
  partnerLabel: 'Partner A',
  stripeCouponId: null,
  stripePromotionCodeId: null,
  createdAt: '1998-07-27T12:00:00.000Z',
};

const harness = () => {
  const created: Coupon[] = [];
  const events: string[] = [];
  const repository: CouponManagementRepository = {
    findByCode: async () => null,
    findById: async () => created[0] ?? null,
    create: async (_tenantId, coupon, event) => {
      created.push(coupon);
      events.push(event.type);
      return coupon;
    },
    archive: async (_tenantId, _couponId, event) => {
      events.push(event.type);
      return created[0] === undefined ? null : { ...created[0], status: 'archived' };
    },
    cacheStripeIds: async () => null,
  };
  return { repository, created, events };
};

describe('coupon management', () => {
  it('creates normalized coupons and an append-only lifecycle event', async () => {
    const h = harness();
    const result = await createCoupon(
      { identity },
      {
        code: ' partner20 ',
        kind: 'percent',
        value: 20,
        scope: { kind: 'all' },
        appliesTo: 'both',
        partnerLabel: 'Partner A',
      },
      {
        coupons: h.repository,
        ids: { nextId: () => (h.created.length === 0 ? 'coupon-1' : 'event-1') },
        clock: { nowIso: () => '1998-07-27T12:00:00.000Z' },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: { coupon: { code: 'PARTNER20', recurringDuration: 'first_invoice' } },
    });
    expect(h.events).toEqual(['created']);
  });

  it('rejects invalid percentage boundaries before persistence', async () => {
    const h = harness();
    const result = await createCoupon(
      { identity },
      {
        code: 'BAD',
        kind: 'percent',
        value: 101,
        scope: { kind: 'all' },
        appliesTo: 'both',
      },
      {
        coupons: h.repository,
        ids: { nextId: () => 'unused' },
        clock: { nowIso: () => '1998-07-27T12:00:00.000Z' },
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.created).toEqual([]);
  });

  it('rejects zero discounts and inverted date ranges before persistence', async () => {
    const invalidInputs = [
      {
        code: 'ZERO',
        kind: 'percent' as const,
        value: 0,
        scope: { kind: 'all' as const },
        appliesTo: 'both' as const,
      },
      {
        code: 'DATES',
        kind: 'percent' as const,
        value: 10,
        scope: { kind: 'all' as const },
        appliesTo: 'both' as const,
        startsAt: '1998-08-20T00:00:00.000Z',
        endsAt: '1998-08-19T00:00:00.000Z',
      },
    ];

    for (const input of invalidInputs) {
      const h = harness();
      const result = await createCoupon(
        { identity },
        input,
        {
          coupons: h.repository,
          ids: { nextId: () => 'unused' },
          clock: { nowIso: () => '1998-07-27T12:00:00.000Z' },
        },
      );
      expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(h.created).toEqual([]);
    }
  });

  it('archives a tenant coupon and records the transition', async () => {
    const h = harness();
    h.created.push(baseCoupon);
    const result = await archiveCoupon(
      { identity },
      { id: 'coupon-1' },
      {
        coupons: h.repository,
        ids: { nextId: () => 'event-2' },
        clock: { nowIso: () => '1998-07-27T12:00:00.000Z' },
      },
    );
    expect(result).toMatchObject({ ok: true, value: { coupon: { status: 'archived' } } });
    expect(h.events).toEqual(['archived']);
  });
});
