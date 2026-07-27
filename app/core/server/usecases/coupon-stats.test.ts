import { describe, expect, it } from 'vitest';

import { type CouponStatsItem, type Identity } from '@core/domain/index.js';

import { exportCouponStats, listCouponOptions, listCouponStats } from './coupon-stats.js';

const identity: Identity = {
  userId: 'owner-1',
  email: 'owner@example.test',
  name: 'Owner',
  tenantId: 'tenant-1',
  tenantSlug: 'alpha',
  tenantName: 'Alpha',
  staffRole: 'owner',
  memberId: null,
};

const item: CouponStatsItem = {
  coupon: {
    id: 'coupon-1',
    tenantId: 'tenant-1',
    code: 'PARTNER20',
    kind: 'percent',
    value: 20,
    scope: { kind: 'all' },
    appliesTo: 'both',
    recurringDuration: 'forever',
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    maxRedemptionsPerMember: null,
    status: 'active',
    partnerLabel: 'Partner A',
    stripeCouponId: null,
    stripePromotionCodeId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
  },
  redemptions: 2,
  sessionsWithCode: 4,
  conversionRate: 0.5,
  grossAttributed: [{ currency: 'PLN', amountCents: 8000 }],
  discountGiven: [{ currency: 'PLN', amountCents: 2000 }],
  timeSeries: [
    {
      date: '2026-07-27',
      currency: 'PLN',
      redemptions: 2,
      grossAttributedCents: 8000,
      discountGivenCents: 2000,
    },
  ],
};

const queries: Array<{ since: string; through: string }> = [];
const stats = {
  listOptions: async () => [{ id: item.coupon.id, code: item.coupon.code }],
  list: async (_tenantId: string, query: { since: string; through: string }) => {
    queries.push(query);
    return { items: [item], nextCursor: null };
  },
};

describe('coupon stats', () => {
  it('returns keyset-ready aggregates with partner filtering', async () => {
    const result = await listCouponStats(
      { identity },
      { partnerLabel: 'Partner A', limit: 25 },
      { stats, clock: { nowIso: () => '2026-07-27T12:00:00.000Z' } },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { items: [{ redemptions: 2, sessionsWithCode: 4, conversionRate: 0.5 }] },
    });
    expect(queries.at(-1)).toMatchObject({
      since: '1970-01-01T00:00:00.000Z',
      through: '2026-07-27T12:00:00.000Z',
    });
  });

  it('lists lightweight coupon options for sales filters', async () => {
    expect(await listCouponOptions({ identity }, { stats })).toEqual({
      ok: true,
      value: { coupons: [{ id: 'coupon-1', code: 'PARTNER20' }] },
    });
  });

  it('exports the affiliate settlement artifact as CSV and JSON', async () => {
    const deps = { stats, clock: { nowIso: () => '2026-07-27T12:00:00.000Z' } };
    const csv = await exportCouponStats({ identity }, { format: 'csv' }, deps);
    const json = await exportCouponStats({ identity }, { format: 'json' }, deps);
    expect(csv).toMatchObject({ ok: true, value: { mimeType: 'text/csv' } });
    if (csv.ok) expect(csv.value.content).toContain('PARTNER20,Partner A,2,PLN,8000,2000');
    if (json.ok) expect(JSON.parse(json.value.content)).toMatchObject([{ code: 'PARTNER20' }]);
  });
});
