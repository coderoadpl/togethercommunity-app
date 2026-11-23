import { describe, expect, it } from 'vitest';

import { tenantSettingsSchema, type CheckoutShippingSelection, type ShippingRate } from '#core/domain/index.js';

import type { PublicRateLimitRepository } from '../ports.js';
import { createPickupPointDirectoryFake, TEST_PICKUP_POINTS } from '../testing/pickup-point-fake.js';
import {
  lookupParcelLocker,
  PICKUP_POINT_LOOKUP_BUDGET_SCOPE,
  PUBLIC_PICKUP_POINT_LOOKUP_SCOPE,
  verifyCheckoutPickupPoint,
  withPickupPointLookupBudget,
} from './pickup-points.js';

const lockerRate: ShippingRate = { id: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost', pickupPoint: 'inpost_locker', active: true };

const countingBuckets = (): PublicRateLimitRepository & { claims: string[] } => {
  const claims: string[] = [];
  return {
    claims,
    claim: async (input) => {
      claims.push(`${input.scope}:${input.key}`);
      return claims.filter((claim) => claim === `${input.scope}:${input.key}`).length <= input.limit;
    },
    purgeExpired: async () => 0,
  };
};

const harness = (rates: ShippingRate[] = [lockerRate], budget = 10, publicShare = 10) => {
  const directory = createPickupPointDirectoryFake();
  const buckets = countingBuckets();
  const clock = { nowIso: () => '2026-11-22T10:00:00.000Z' };
  const pickupPoints = withPickupPointLookupBudget(directory, { buckets, clock, window: { limit: budget, windowMs: 60_000 } });
  const settings = tenantSettingsSchema.parse({ name: 'Alpha', billingPortalUrl: null, bunnyStreamLibraryId: null, shippingRates: rates });
  return { pickupPoints: directory, buckets, deps: {
    tenants: { findSettings: async () => settings }, pickupPoints, publicShare: { buckets, clock, window: { limit: publicShare, windowMs: 60_000 } },
  } };
};

const lockerSelection: CheckoutShippingSelection = {
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: TEST_PICKUP_POINTS.operating, name: null, address: null }, allowedCountries: ['PL'],
};

describe('parcel locker lookup', () => {
  it('answers with the canonical code, name and address of a usable locker', async () => {
    const h = harness();
    expect(await lookupParcelLocker('tenant-a', { code: ' waw01m ' }, h.deps)).toEqual({ ok: true, value: {
      status: 'found', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1, 00-001 Warsaw', usable: true, reason: null,
    } });
    expect(h.pickupPoints.lookups).toEqual(['WAW01M']);
  });

  it.each([
    [TEST_PICKUP_POINTS.notFound, { status: 'not_found' }],
    [TEST_PICKUP_POINTS.unavailable, { status: 'unavailable' }],
    [TEST_PICKUP_POINTS.notOperating, { status: 'found', usable: false, reason: 'not_operating' }],
    [TEST_PICKUP_POINTS.wrongType, { status: 'found', usable: false, reason: 'not_usable' }],
  ])('describes %s', async (code, expected) => {
    expect(await lookupParcelLocker('tenant-a', { code }, harness().deps)).toMatchObject({ ok: true, value: expected });
  });

  it.each(['WAW-01', 'ab1', 'A'.repeat(13), '../points'])('refuses the malformed code %s without asking the carrier', async (code) => {
    const h = harness();
    expect(await lookupParcelLocker('tenant-a', { code }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.pickupPoints.lookups).toEqual([]);
    expect(h.buckets.claims).toEqual([]);
  });

  it('answers not found without asking the carrier when the workspace offers no active locker rate', async () => {
    const h = harness([{ ...lockerRate, active: false }, { ...lockerRate, id: 'courier', pickupPoint: 'none' }]);
    expect(await lookupParcelLocker('tenant-a', { code: 'WAW01M' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.pickupPoints.lookups).toEqual([]);
    expect(h.buckets.claims).toEqual([]);
  });

  it('draws every carrier call from one platform-wide budget and answers unavailable once it is spent', async () => {
    const h = harness([lockerRate], 2);
    expect(await lookupParcelLocker('tenant-a', { code: 'WAW01M' }, h.deps)).toMatchObject({ ok: true, value: { status: 'found' } });
    expect(await lookupParcelLocker('tenant-b', { code: 'WAW01M' }, h.deps)).toMatchObject({ ok: true, value: { status: 'found' } });
    expect(await lookupParcelLocker('tenant-a', { code: 'WAW01M' }, h.deps)).toEqual({ ok: true, value: { status: 'unavailable' } });
    expect(h.pickupPoints.lookups).toEqual(['WAW01M', 'WAW01M']);
    expect(h.buckets.claims.filter((claim) => claim === `${PICKUP_POINT_LOOKUP_BUDGET_SCOPE}:platform`)).toHaveLength(3);
  });

  it('caps the public route at its own share of the carrier budget so checkout still reaches the carrier', async () => {
    const h = harness([lockerRate], 10, 1);
    expect(await lookupParcelLocker('tenant-a', { code: 'WAW01M' }, h.deps)).toMatchObject({ ok: true, value: { status: 'found' } });
    expect(await lookupParcelLocker('tenant-b', { code: 'WAW01M' }, h.deps)).toEqual({ ok: true, value: { status: 'unavailable' } });
    expect(h.pickupPoints.lookups).toEqual(['WAW01M']);
    const verified = await verifyCheckoutPickupPoint(lockerSelection, h.deps.pickupPoints);
    expect(verified).toMatchObject({ ok: true, value: { pickupPoint: { code: 'WAW01M', name: 'Next to the main entrance' } } });
    expect(verified.ok && verified.value.pickupPoint?.verified).toBeUndefined();
    expect(h.pickupPoints.lookups).toEqual(['WAW01M', 'WAW01M']);
    expect(h.buckets.claims).toEqual([
      `${PUBLIC_PICKUP_POINT_LOOKUP_SCOPE}:platform`, `${PICKUP_POINT_LOOKUP_BUDGET_SCOPE}:platform`,
      `${PUBLIC_PICKUP_POINT_LOOKUP_SCOPE}:platform`,
      `${PICKUP_POINT_LOOKUP_BUDGET_SCOPE}:platform`,
    ]);
  });

  it('answers unavailable without claiming any budget when no carrier directory is configured', async () => {
    const h = harness();
    expect(await lookupParcelLocker('tenant-a', { code: 'WAW01M' }, { ...h.deps, pickupPoints: undefined })).toEqual({ ok: true, value: { status: 'unavailable' } });
    expect(h.buckets.claims).toEqual([]);
  });
});
