import { describe, expect, expectTypeOf, it } from 'vitest';

import { allocateOrderLineGross, allocatePaidOrderLineGross, orderLineSchema } from './commerce.js';
import { newProductSchema, productSchema } from './product.js';
import type { ProductCompliance } from './product-compliance.js';
import {
  applyPickupPointLookup,
  checkoutShippingInputSchema,
  deliveryMethodAllowed,
  hasActiveParcelLockerRate,
  inpostPointRejection,
  parcelLockerLookupView,
  pickupPointDetails,
  orderShippingFrom,
  orderShippingSchema,
  pickupPointCodeValid,
  publicShippingRates,
  requiresWorkspaceCheckout,
  resolveCheckoutShipping,
  SHIPPING_ALLOWED_COUNTRIES,
  shippingRateSchema,
  shippingRatesSchema,
  storableText,
  type CheckoutShippingSelection,
  type InpostPoint,
  type ShippingRate,
} from './shipping.js';

const rate = (overrides: Partial<ShippingRate> = {}): ShippingRate => ({
  id: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost', pickupPoint: 'inpost_locker', active: true,
  ...overrides,
});

describe('shipping rates', () => {
  it('defaults the VAT rate to 23 percent and keeps the optional delivery estimate', () => {
    expect(shippingRateSchema.parse({ id: 'courier-1', label: ' Courier ', amountCents: 0, carrier: 'other', pickupPoint: 'none', active: false, deliveryEstimateDays: { min: 2, max: 4 } }))
      .toEqual({ id: 'courier-1', label: 'Courier', amountCents: 0, vatRatePercent: 23, carrier: 'other', pickupPoint: 'none', active: false, deliveryEstimateDays: { min: 2, max: 4 } });
  });

  it.each([
    ['an uppercase id', { id: 'Locker' }],
    ['an id longer than 40 characters', { id: 'a'.repeat(41) }],
    ['an empty label', { label: ' ' }],
    ['a label longer than 100 characters', { label: 'a'.repeat(101) }],
    ['a negative amount', { amountCents: -1 }],
    ['a fractional amount', { amountCents: 1.5 }],
    ['an unsupported VAT rate', { vatRatePercent: 7 }],
    ['an unknown carrier', { carrier: 'post' }],
    ['an unknown pickup point kind', { pickupPoint: 'kiosk' }],
    ['a delivery estimate ending before it starts', { deliveryEstimateDays: { min: 3, max: 1 } }],
    ['a zero-day delivery estimate', { deliveryEstimateDays: { min: 0, max: 1 } }],
  ])('rejects %s', (_case, overrides) => {
    expect(shippingRateSchema.safeParse({ ...rate(), ...overrides }).success).toBe(false);
  });

  it('allows at most five rates with unique ids', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((id) => rate({ id }));
    expect(shippingRatesSchema.safeParse(five).success).toBe(true);
    expect(shippingRatesSchema.safeParse([...five, rate({ id: 'f' })]).success).toBe(false);
    expect(shippingRatesSchema.safeParse([rate(), rate()]).success).toBe(false);
  });

  it('exposes only active rates without their VAT configuration', () => {
    expect(publicShippingRates([rate({ deliveryEstimateDays: { min: 1, max: 2 } }), rate({ id: 'old', active: false })])).toEqual([
      { id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker', deliveryEstimateDays: { min: 1, max: 2 } },
    ]);
    expect(publicShippingRates(undefined)).toEqual([]);
  });
});

describe('delivery method', () => {
  it('defaults products to collection in person', () => {
    expect(newProductSchema.parse({ title: 'Accessory', priceCents: 100 }).deliveryMethod).toBe('pickup');
    expect(productSchema.parse({
      id: 'p', tenantId: 't', type: 'physical', slug: 'p', title: 'P', description: '', coverUrl: null, priceCents: 1, currency: 'PLN',
      published: false, accessItems: [], legacyId: null, createdAt: '2026-11-05T12:00:00.000Z',
    }).deliveryMethod).toBe('pickup');
  });

  it.each([
    ['physical', 'shipping', true],
    ['physical', 'pickup', true],
    ['course', 'shipping', false],
    ['digital_download', 'shipping', false],
    ['membership', 'shipping', false],
    ['course', 'pickup', true],
  ] as const)('allows %s products with %s delivery: %s', (type, method, allowed) => {
    expect(deliveryMethodAllowed(type, method)).toBe(allowed);
  });

  it('routes shipped products and consent-bound products to the workspace checkout page', () => {
    expect(requiresWorkspaceCheckout({ deliveryMethod: 'shipping' })).toBe(true);
    expect(requiresWorkspaceCheckout({ deliveryMethod: 'pickup', checkoutConsentDefinitionIds: ['consent'] })).toBe(true);
    expect(requiresWorkspaceCheckout({ deliveryMethod: 'pickup', checkoutConsentDefinitionIds: [] })).toBe(false);
  });

  it('routes products with product safety information to the workspace checkout page', () => {
    const compliance = {
      manufacturerName: 'Maker', manufacturerAddress: 'Main Street 1, Warsaw', manufacturerEmail: 'maker@example.com',
      manufacturerOutsideEu: false, modelIdentifier: 'M-1', safetyWarnings: '',
    };
    expect(requiresWorkspaceCheckout({ deliveryMethod: 'pickup', compliance })).toBe(true);
    expect(requiresWorkspaceCheckout({ deliveryMethod: 'pickup', compliance: null })).toBe(false);
    expectTypeOf<Parameters<typeof requiresWorkspaceCheckout>[0]['compliance']>()
      .toEqualTypeOf<ProductCompliance | null | undefined>();
  });
});

describe('checkout shipping resolution', () => {
  const rates = [rate(), rate({ id: 'courier', label: 'Courier', pickupPoint: 'none', carrier: 'other', vatRatePercent: 8 })];

  it('normalizes a locker code before matching the pattern', () => {
    expect(pickupPointCodeValid(' waw01m ')).toBe(true);
    expect(pickupPointCodeValid('WAW-01M')).toBe(false);
    expect(pickupPointCodeValid('ABC')).toBe(false);
    expect(pickupPointCodeValid('A'.repeat(13))).toBe(false);
  });

  it('returns no shipping for collected products and freezes the selected rate otherwise', () => {
    expect(resolveCheckoutShipping([{ deliveryMethod: 'pickup' }], rates, undefined)).toEqual({ ok: true, value: null });
    expect(resolveCheckoutShipping([{ deliveryMethod: 'pickup' }, { deliveryMethod: 'shipping' }], rates, { rateId: 'courier' })).toEqual({ ok: true, value: {
      rateId: 'courier', label: 'Courier', amountCents: 1499, vatRatePercent: 8, carrier: 'other', pickupPoint: null, allowedCountries: [...SHIPPING_ALLOWED_COUNTRIES],
    } });
  });

  it('reports a missing delivery selection with its own error code', () => {
    expect(resolveCheckoutShipping([{ deliveryMethod: 'shipping' }], rates, undefined)).toMatchObject({ ok: false, error: { code: 'shipping_required' } });
  });

  const nul = String.fromCharCode(0);
  const loneHigh = String.fromCharCode(0xd800);
  const loneLow = String.fromCharCode(0xdc00);

  it.each([
    ['ordinary non-ASCII text', 'Café Straße, Zürich 📦', true],
    ['a NUL character', `Kiosk${nul}`, false],
    ['a lone high surrogate', `Kiosk ${loneHigh}`, false],
    ['a lone low surrogate', `${loneLow} Kiosk`, false],
    ['a reversed surrogate pair', `${loneLow}${loneHigh}`, false],
  ])('judges whether %s is storable', (_case, value, storable) => {
    expect(storableText(value)).toBe(storable);
  });

  it('drops an unstorable map name or address the buyer sends and keeps the locker code', () => {
    const parsed = checkoutShippingInputSchema.parse({
      rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'waw01m', name: `Kiosk${nul}`, address: `Main Street ${loneHigh}` },
    });
    expect(parsed.pickupPoint).toMatchObject({ provider: 'inpost', code: 'WAW01M' });
    expect(parsed.pickupPoint?.name).toBeUndefined();
    expect(parsed.pickupPoint?.address).toBeUndefined();
    expect(resolveCheckoutShipping([{ deliveryMethod: 'shipping' }], rates, parsed)).toMatchObject({ ok: true, value: {
      pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
    } });
    expect(checkoutShippingInputSchema.parse({ rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'WAW01M', name: 'Café' } }).pickupPoint)
      .toMatchObject({ name: 'Café' });
  });
});

describe('order shipping from collected details', () => {
  const snapshot = { rateId: 'courier', label: 'Courier', amountCents: 1999, vatRatePercent: 23 as const, carrier: 'other' as const, pickupPoint: null, allowedCountries: ['PL'] };
  const collected = { name: 'Jane Buyer', phone: null, address: { line1: 'Garden Street 5', line2: '', postalCode: '00-950', city: 'Warsaw', country: 'pl', state: null } };

  it('combines the frozen rate with the collected address', () => {
    expect(orderShippingFrom(snapshot, collected)).toEqual({ ok: true, value: {
      rateId: 'courier', label: 'Courier', amountCents: 1999, vatRatePercent: 23, carrier: 'other', pickupPoint: null,
      address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' }, phone: null,
    } });
  });

  it.each([
    ['missing details', null],
    ['a missing country', { ...collected, address: { ...collected.address, country: null } }],
    ['a country outside the allowed list', { ...collected, address: { ...collected.address, country: 'DE' } }],
  ])('rejects %s', (_case, details) => {
    expect(orderShippingFrom(snapshot, details)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('truncates overlong collected values to the stored order limits', () => {
    const result = orderShippingFrom(snapshot, {
      name: 'n'.repeat(250), phone: '+48'.padEnd(60, '1'),
      address: { line1: 'a'.repeat(299) + '\u{1F4E6}', line2: 'b'.repeat(400), postalCode: '0'.repeat(50), city: 'c'.repeat(200), country: 'PL', state: null },
    });
    if (!result.ok) throw new Error('Expected collected shipping to be accepted');
    expect(orderShippingSchema.safeParse(result.value).success).toBe(true);
    expect(result.value.address).toEqual({
      name: 'n'.repeat(200), line1: 'a'.repeat(299), line2: 'b'.repeat(300), postalCode: '0'.repeat(30), city: 'c'.repeat(120), country: 'PL',
    });
    expect(result.value.phone).toBe('+48'.padEnd(40, '1'));
  });
});

describe('paid amount allocation with shipping', () => {
  const line = (grossCents: number, productType: 'course' | 'physical' | 'shipping' = 'course') => orderLineSchema.parse({
    productId: `${productType}-${grossCents}`, name: 'Line', productType, grossCents, netCents: grossCents, vatCents: 0, vatRate: 'exempt', vatExemptionBasis: null, issuedCount: null,
  });

  it('accepts a shipping order line type next to product types', () => {
    expect(line(1499, 'shipping').productType).toBe('shipping');
    expect(orderLineSchema.safeParse({ ...line(1), productType: 'gift' }).success).toBe(false);
  });

  it('matches the plain allocation when the order has no shipping', () => {
    const lines = [line(4900), line(5400, 'physical')];
    expect(allocatePaidOrderLineGross(lines, 10300)).toEqual(allocateOrderLineGross(lines, 10300));
  });

  it('keeps shipping at face value when the paid total is not discounted', () => {
    expect(allocatePaidOrderLineGross([line(4900), line(5400), line(1499, 'shipping')], 11799)).toEqual([4900, 5400, 1499]);
  });

  it('spreads a coupon over product lines only and still sums to the paid total', () => {
    const lines = [line(4900), line(5400), line(2100, 'physical'), line(1499, 'shipping')];
    const amounts = allocatePaidOrderLineGross(lines, 7699);
    expect(amounts.at(-1)).toBe(1499);
    expect(amounts.slice(0, 3)).toEqual(allocateOrderLineGross(lines.slice(0, 3), 6200));
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(7699);
  });

  it('rounds odd discounts with the cumulative method so the lines add up', () => {
    const lines = [line(333), line(333), line(334), line(999, 'shipping')];
    const amounts = allocatePaidOrderLineGross(lines, 1666);
    expect(amounts).toEqual([222, 222, 223, 999]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(1666);
  });
});

describe('InPost point verdict', () => {
  const point = (change: Partial<InpostPoint> = {}): InpostPoint => ({
    name: 'kra14a', status: 'Operating', types: ['parcel_locker'], functions: ['parcel_send', 'parcel_collect'],
    locationDescription: ' Next to the market ', address: { line1: ' Market Street 16 ', line2: null }, ...change,
  });

  it.each([
    ['an operating locker that holds parcels for collection', point(), null],
    ['an InPost partner pickup point the map also offers', point({ types: ['parcel_locker', 'parcel_locker_superpop', 'pop'] }), null],
    ['a removed point', point({ status: 'Removed', types: [] }), 'not_operating'],
    ['a disabled point', point({ status: 'Disabled' }), 'not_operating'],
    ['a non-operating point', point({ status: 'NonOperating' }), 'not_operating'],
    ['a point of another type', point({ types: ['pop'] }), 'not_usable'],
    ['a send-only point', point({ functions: ['parcel_send'] }), 'not_usable'],
  ])('judges %s', (_case, candidate, reason) => {
    expect(inpostPointRejection(candidate)).toBe(reason);
  });

  it('builds the stored name and address the way the map choice does', () => {
    expect(pickupPointDetails(point({ address: { line1: 'Market Street 16', line2: ' 31-630 Krakow ' } }))).toEqual({
      code: 'KRA14A', name: 'Next to the market', address: 'Market Street 16, 31-630 Krakow',
    });
    expect(pickupPointDetails(point({ locationDescription: '  ', address: null }))).toEqual({ code: 'KRA14A', name: null, address: null });
    expect(pickupPointDetails(point({ locationDescription: 'x'.repeat(250) })).name).toHaveLength(200);
  });

  it('describes a lookup for the page with the reason a point is refused', () => {
    expect(parcelLockerLookupView({ kind: 'found', point: point({ status: 'NonOperating' }) })).toEqual({
      status: 'found', code: 'KRA14A', name: 'Next to the market', address: 'Market Street 16', usable: false, reason: 'not_operating',
    });
    expect(parcelLockerLookupView({ kind: 'not_found' })).toEqual({ status: 'not_found' });
    expect(parcelLockerLookupView({ kind: 'unavailable' })).toEqual({ status: 'unavailable' });
  });

  const lockerSelection: CheckoutShippingSelection = {
    rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
    pickupPoint: { provider: 'inpost', code: 'KRA14A', name: 'Typed', address: 'Typed street 1' }, allowedCountries: ['PL'],
  };

  it.each(['NonOperating', 'Disabled', 'Removed'])('refuses the sale for the known negative status %s', (status) => {
    expect(applyPickupPointLookup(lockerSelection, { kind: 'found', point: point({ status }) }))
      .toMatchObject({ ok: false, error: { code: 'validation', details: { pickupPointReason: 'not_operating' } } });
  });

  it.each(['Overloaded', 'Created', 'operating', ''])('reads the undocumented status %j as an unavailable answer and keeps only the unverified mark', (status) => {
    const lookup = { kind: 'found', point: point({ status }) } as const;
    expect(parcelLockerLookupView(lookup)).toEqual({ status: 'unavailable' });
    const applied = applyPickupPointLookup(lockerSelection, lookup);
    expect(applied).toEqual({ ok: true, value: { ...lockerSelection, pickupPoint: { ...lockerSelection.pickupPoint, verified: false } } });
  });

  it('accepts an operating locker with the carrier details and no unverified mark', () => {
    expect(applyPickupPointLookup(lockerSelection, { kind: 'found', point: point() })).toEqual({ ok: true, value: {
      ...lockerSelection, pickupPoint: { provider: 'inpost', code: 'KRA14A', name: 'Next to the market', address: 'Market Street 16' },
    } });
  });

  it('knows whether a workspace offers an active parcel locker rate', () => {
    expect(hasActiveParcelLockerRate([rate({ pickupPoint: 'inpost_locker', active: true })])).toBe(true);
    expect(hasActiveParcelLockerRate([rate({ pickupPoint: 'inpost_locker', active: false }), rate({ pickupPoint: 'none' })])).toBe(false);
    expect(hasActiveParcelLockerRate(null)).toBe(false);
  });
});
