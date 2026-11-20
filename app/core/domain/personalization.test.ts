import { describe, expect, it } from 'vitest';

import { checkoutCartInputSchema, checkoutSessionInputSchema } from './payment.js';
import {
  correctedLinePersonalization,
  orderPersonalizationSummary,
  productPersonalizationSchema,
  resolveCheckoutPersonalizations,
  type OrderLinePersonalization,
} from './personalization.js';
import { newProductSchema, productSchema, updateProductInputSchema } from './product.js';
import { requiresWorkspaceCheckout } from './shipping.js';
import { buildSnapshot } from './versioning.js';

const condition = 'I understand a personalised item is made to my order.';
const setting = productPersonalizationSchema.parse({ label: 'Add an engraving', inputLabel: 'Engraving text', condition });
const now = '2026-11-18T09:00:00.000Z';

describe('product personalisation setting', () => {
  it('trims the labels, defaults the limit, the description and the condition, and keeps seller text as entered', () => {
    expect(productPersonalizationSchema.parse({ label: '  Add an engraving ', inputLabel: ' Engraving text ' })).toEqual({
      label: 'Add an engraving', description: '', inputLabel: 'Engraving text', maxLength: 200, condition: null,
    });
    expect(productPersonalizationSchema.parse({ ...setting, description: '**Not markdown** <b>nor html</b>' }).description)
      .toBe('**Not markdown** <b>nor html</b>');
  });

  it('refuses empty or overlong texts, a limit outside 1..500 and unknown fields', () => {
    for (const patch of [
      { label: ' ' }, { label: 'x'.repeat(81) }, { inputLabel: '' }, { inputLabel: 'x'.repeat(81) }, { description: 'x'.repeat(1001) },
      { maxLength: 0 }, { maxLength: 501 }, { maxLength: 1.5 }, { condition: '  ' }, { condition: 'x'.repeat(1001) }, { surcharge: 500 },
    ]) {
      expect(productPersonalizationSchema.safeParse({ ...setting, ...patch }).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it('defaults a new product to no personalisation and keeps it optional on updates', () => {
    expect(newProductSchema.parse({ title: 'Printed book', priceCents: 100 }).personalization).toBeNull();
    expect(updateProductInputSchema.parse({ id: 'book' })).not.toHaveProperty('personalization');
    expect(updateProductInputSchema.parse({ id: 'book', personalization: null }).personalization).toBeNull();
  });

  it('keeps the setting out of the product content snapshot', () => {
    const product = productSchema.parse({
      id: 'book', tenantId: 't1', type: 'physical', slug: 'book', title: 'Printed book', description: '', coverUrl: null, priceCents: 100,
      currency: 'PLN', published: true, accessItems: [], legacyId: null, createdAt: now, personalization: setting,
    });
    const snapshot = buildSnapshot('product', product);
    expect(snapshot.ok && snapshot.value.payload).not.toHaveProperty('personalization');
  });

  it('forces the workspace checkout page for a product with a setting', () => {
    expect(requiresWorkspaceCheckout({ deliveryMethod: 'pickup', personalization: setting })).toBe(true);
    expect(requiresWorkspaceCheckout({ deliveryMethod: 'pickup', personalization: null })).toBe(false);
  });
});

describe('checkout personalisation request', () => {
  const products = [{ id: 'book', personalization: setting }, { id: 'poster', personalization: null }, { id: 'card', personalization: { ...setting, condition: null, maxLength: 5 } }];

  it('accepts at most twenty entries on a single checkout and none on a cart checkout', () => {
    const entry = { productId: 'book', text: 'Hi', conditionAccepted: true };
    expect(checkoutSessionInputSchema.safeParse({ productId: 'book', personalizations: Array.from({ length: 20 }, () => entry) }).success).toBe(true);
    expect(checkoutSessionInputSchema.safeParse({ productId: 'book', personalizations: Array.from({ length: 21 }, () => entry) }).success).toBe(false);
    expect(checkoutSessionInputSchema.safeParse({ productId: 'book', personalizations: [{ ...entry, conditionAccepted: 'yes' }] }).success).toBe(false);
    expect(checkoutCartInputSchema.safeParse({ lines: [{ productId: 'book', quantity: 1 }], personalizations: [entry] }).success).toBe(false);
    expect(checkoutSessionInputSchema.parse({ productId: 'book' })).not.toHaveProperty('personalizations');
  });

  it('records the trimmed text with the setting wording, the server time and the acceptance time when a condition exists', () => {
    const resolved = resolveCheckoutPersonalizations([
      { productId: 'book', text: '  For Alex  ', conditionAccepted: true },
      { productId: 'card', text: 'Hey', conditionAccepted: false },
    ], products, now);
    expect(resolved.ok && Object.fromEntries(resolved.value)).toEqual({
      book: { text: 'For Alex', label: 'Add an engraving', description: '', inputLabel: 'Engraving text', condition, maxLength: 200, requestedAt: now, conditionAcceptedAt: now },
      card: { text: 'Hey', label: 'Add an engraving', description: '', inputLabel: 'Engraving text', condition: null, maxLength: 5, requestedAt: now, conditionAcceptedAt: null },
    });
  });

  it.each([
    ['a product outside the selection', [{ productId: 'mug', text: 'Hi', conditionAccepted: true }]],
    ['a duplicate product', [{ productId: 'book', text: 'Hi', conditionAccepted: true }, { productId: 'book', text: 'Again', conditionAccepted: true }]],
    ['a product without a setting', [{ productId: 'poster', text: 'Hi', conditionAccepted: true }]],
    ['a blank text', [{ productId: 'book', text: '   ', conditionAccepted: true }]],
    ['a text over the current limit', [{ productId: 'card', text: 'Sixchr', conditionAccepted: true }]],
    ['an unaccepted condition', [{ productId: 'book', text: 'Hi', conditionAccepted: false }]],
  ])('refuses %s', (_case, requests) => {
    expect(resolveCheckoutPersonalizations(requests, products, now)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('order personalisation', () => {
  const recorded: OrderLinePersonalization = {
    text: 'For Alex', label: 'Add an engraving', description: '', inputLabel: 'Engraving text', condition, maxLength: 10,
    requestedAt: now, conditionAcceptedAt: now,
  };

  it('keeps the first original text and the accepted condition across corrections', () => {
    const first = correctedLinePersonalization(recorded, { text: ' For Sam ', editedAt: '2026-11-19T09:00:00.000Z', editedBy: 'staff-1' });
    expect(first).toEqual({ ok: true, value: { ...recorded, text: 'For Sam', originalText: 'For Alex', editedAt: '2026-11-19T09:00:00.000Z', editedBy: 'staff-1' } });
    if (!first.ok) return;
    const second = correctedLinePersonalization(first.value, { text: 'For Kim', editedAt: '2026-11-20T09:00:00.000Z', editedBy: 'staff-2' });
    expect(second).toMatchObject({ ok: true, value: { text: 'For Kim', originalText: 'For Alex', editedBy: 'staff-2', condition, conditionAcceptedAt: now } });
  });

  it('refuses a correction over the stored limit and a line without personalisation', () => {
    expect(correctedLinePersonalization(recorded, { text: 'x'.repeat(11), editedAt: now, editedBy: 'staff' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(correctedLinePersonalization(undefined, { text: 'Hi', editedAt: now, editedBy: 'staff' })).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('summarises the personalised lines for exports', () => {
    expect(orderPersonalizationSummary([
      { name: 'Printed book', personalization: recorded }, { name: 'Poster' }, { name: 'Card', personalization: { ...recorded, text: 'Hi' } },
    ])).toBe('Printed book: For Alex; Card: Hi');
    expect(orderPersonalizationSummary([{ name: 'Poster' }])).toBe('');
  });
});
