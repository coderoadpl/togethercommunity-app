import { describe, expect, it } from 'vitest';

import { tenantSettingsSchema, type ShippingRate } from '#core/domain/index.js';

import { createPickupPointDirectoryFake, TEST_PICKUP_POINTS } from '../testing/pickup-point-fake.js';
import { lookupParcelLocker } from './pickup-points.js';

const lockerRate: ShippingRate = { id: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost', pickupPoint: 'inpost_locker', active: true };

const harness = (rates: ShippingRate[] = [lockerRate]) => {
  const pickupPoints = createPickupPointDirectoryFake();
  const settings = tenantSettingsSchema.parse({ name: 'Alpha', billingPortalUrl: null, bunnyStreamLibraryId: null, shippingRates: rates });
  return { pickupPoints, deps: { tenants: { findSettings: async () => settings }, pickupPoints } };
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
  });

  it('answers not found without asking the carrier when the workspace offers no active locker rate', async () => {
    const h = harness([{ ...lockerRate, active: false }, { ...lockerRate, id: 'courier', pickupPoint: 'none' }]);
    expect(await lookupParcelLocker('tenant-a', { code: 'WAW01M' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.pickupPoints.lookups).toEqual([]);
  });

  it('answers unavailable when no carrier directory is configured', async () => {
    const { deps } = harness();
    expect(await lookupParcelLocker('tenant-a', { code: 'WAW01M' }, { tenants: deps.tenants })).toEqual({ ok: true, value: { status: 'unavailable' } });
  });
});
