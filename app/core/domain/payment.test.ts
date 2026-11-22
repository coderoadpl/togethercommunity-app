import { describe, expect, it } from 'vitest';

import { checkoutShippingFromStripe } from './payment.js';

const address = (line1: string) => ({ line1, line2: null, postal_code: '00-950', city: 'Warsaw', state: null, country: 'PL' });

describe('checkoutShippingFromStripe', () => {
  it('prefers the newest delivery location when a session carries several', () => {
    expect(checkoutShippingFromStripe({
      collected_information: { shipping_details: { name: 'Basil Buyer', address: address('Basil Street 1') } },
      shipping_details: { name: 'Acacia Buyer', address: address('Acacia Street 1') },
      shipping: { name: 'Old Buyer', address: address('Old Street 1') },
    }).shipping).toMatchObject({ name: 'Basil Buyer', address: { line1: 'Basil Street 1' } });
    expect(checkoutShippingFromStripe({
      shipping_details: { name: 'Acacia Buyer', address: address('Acacia Street 1') },
      shipping: { name: 'Old Buyer', address: address('Old Street 1') },
    }).shipping).toMatchObject({ name: 'Acacia Buyer', address: { line1: 'Acacia Street 1' } });
  });

  it('reads the phone from the customer details first and from the delivery hash otherwise', () => {
    const shipping = { name: 'Test Buyer', phone: '+48500100900', address: address('Old Street 1') };
    expect(checkoutShippingFromStripe({ shipping, customer_details: { phone: '+48500100200' } }).shipping?.phone).toBe('+48500100200');
    expect(checkoutShippingFromStripe({ shipping, customer_details: { phone: null } }).shipping?.phone).toBe('+48500100900');
    expect(checkoutShippingFromStripe({ shipping: { name: 'Test Buyer', address: address('Old Street 1') } }).shipping?.phone).toBeNull();
  });

  it('reads the shipping cost from shipping_cost and falls back to total_details.amount_shipping', () => {
    const shipping = { name: 'Test Buyer', address: address('Old Street 1') };
    expect(checkoutShippingFromStripe({ shipping, shipping_cost: { amount_total: 1599 }, total_details: { amount_shipping: 999 } }).shippingCostCents).toBe(1599);
    expect(checkoutShippingFromStripe({ shipping, shipping_rate: 'shr_1', total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 } }).shippingCostCents).toBe(0);
    expect(checkoutShippingFromStripe({ shipping, shipping_rate: 'shr_1' }).shippingCostCents).toBeNull();
  });

  it('reports no shipping cost for a session that collected no delivery address', () => {
    expect(checkoutShippingFromStripe({ total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 } })).toEqual({ shipping: null, shippingCostCents: null });
    expect(checkoutShippingFromStripe({ shipping_cost: { amount_total: 0 } })).toEqual({ shipping: null, shippingCostCents: 0 });
  });

  it('keeps every readable field when another one has an unexpected shape', () => {
    expect(checkoutShippingFromStripe({
      collected_information: { shipping_details: 'unexpected' },
      shipping: { name: 'Test Buyer', phone: '+48500100900', address: address('Old Street 1') },
      customer_details: { phone: 48500100200 },
      shipping_cost: { amount_total: '1599' },
      total_details: { amount_discount: 'unexpected', amount_shipping: 1599 },
    })).toEqual({
      shipping: { name: 'Test Buyer', phone: '+48500100900', address: { line1: 'Old Street 1', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL', state: null } },
      shippingCostCents: 1599,
    });
  });

  it('reports nothing for a session it cannot read', () => {
    expect(checkoutShippingFromStripe({ shipping: { name: 'Test Buyer' } })).toEqual({ shipping: null, shippingCostCents: null });
    expect(checkoutShippingFromStripe(null)).toEqual({ shipping: null, shippingCostCents: null });
  });
});
