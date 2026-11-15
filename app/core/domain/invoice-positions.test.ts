import { describe, expect, it } from 'vitest';

import { invoicePositionQuantity, type InvoicePosition } from './fa3.js';
import { lineInvoicePositions, linesNeedInvoicePositions } from './invoice-positions.js';
import { splitProductGross } from './product-vat.js';
import type { InvoiceVatTreatment } from './tenant.js';

const rate23: InvoiceVatTreatment = { kind: 'rate', percent: 23 };

const vatTreatments: InvoiceVatTreatment[] = [
  { kind: 'rate', percent: 5 },
  { kind: 'rate', percent: 8 },
  rate23,
  { kind: 'exempt', basisKind: 'art_113_1', basis: 'art. 113 ust. 1' },
];

const sum = (positions: InvoicePosition[], key: 'grossCents' | 'netCents' | 'vatCents'): number =>
  positions.reduce((total, position) => total + position[key], 0);

const pseudoRandom = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 48_271) % 2_147_483_647;
    return state;
  };
};

describe('line invoice positions', () => {
  it('keeps a quantity-one line as one position without a quantity field', () => {
    expect(lineInvoicePositions({ name: 'Course', quantity: 1, grossCents: 4900, vat: rate23 })).toStrictEqual([
      { name: 'Course', grossCents: 4900, netCents: 3984, vatCents: 916, vat: rate23 },
    ]);
  });

  it('keeps an evenly divisible line as one position with the quantity', () => {
    expect(lineInvoicePositions({ name: 'Poster', quantity: 3, grossCents: 9000, vat: rate23 })).toStrictEqual([
      { name: 'Poster', quantity: 3, grossCents: 9000, netCents: 7317, vatCents: 1683, vat: rate23 },
    ]);
  });

  it('splits a discounted gross of 10001 at quantity 3 into two positions summing to the line', () => {
    const positions = lineInvoicePositions({ name: 'Poster', quantity: 3, grossCents: 10001, vat: rate23 });
    expect(positions).toStrictEqual([
      { name: 'Poster', quantity: 2, grossCents: 6666, netCents: 5420, vatCents: 1246, vat: rate23 },
      { name: 'Poster', grossCents: 3335, netCents: 2711, vatCents: 624, vat: rate23 },
    ]);
    expect(sum(positions, 'grossCents')).toBe(10001);
  });

  it('splits an uneven quantity-two line into two single units', () => {
    expect(lineInvoicePositions({ name: 'Poster', quantity: 2, grossCents: 1001, vat: rate23 })).toStrictEqual([
      { name: 'Poster', grossCents: 500, netCents: 407, vatCents: 93, vat: rate23 },
      { name: 'Poster', grossCents: 501, netCents: 407, vatCents: 94, vat: rate23 },
    ]);
  });

  it('adds up to the allocated line with whole-grosz unit prices for many amounts, quantities and rates', () => {
    const next = pseudoRandom(20_261_115);
    const cases = [
      ...[0, 1, 2, 98, 99, 100, 101, 199].flatMap((grossCents) => [1, 2, 3, 7, 10, 99].map((quantity) => ({ grossCents, quantity }))),
      ...Array.from({ length: 2_000 }, () => ({ grossCents: next() % 2_000_000, quantity: 1 + next() % 99 })),
    ];
    for (const vat of vatTreatments) {
      for (const { grossCents, quantity } of cases) {
        const positions = lineInvoicePositions({ name: 'Item', quantity, grossCents, vat });
        const line = splitProductGross(grossCents, vat.kind === 'exempt' ? 'exempt' : vat.percent);
        const label = `${String(grossCents)} x ${String(quantity)} at ${vat.kind === 'exempt' ? 'zw' : String(vat.percent)}`;
        expect(positions.length, label).toBeLessThanOrEqual(2);
        expect(positions.reduce((total, position) => total + invoicePositionQuantity(position), 0), label).toBe(quantity);
        expect(sum(positions, 'grossCents'), label).toBe(line.grossCents);
        expect(sum(positions, 'netCents'), label).toBe(line.netCents);
        expect(sum(positions, 'vatCents'), label).toBe(line.vatCents);
        for (const position of positions) {
          const units = invoicePositionQuantity(position);
          expect(Number.isInteger(position.grossCents / units), label).toBe(true);
          expect(position.netCents + position.vatCents, label).toBe(position.grossCents);
          expect(position.netCents, label).toBeGreaterThanOrEqual(0);
          expect(position.vatCents, label).toBeGreaterThanOrEqual(0);
          const exact = splitProductGross(position.grossCents, vat.kind === 'exempt' ? 'exempt' : vat.percent);
          expect(Math.abs(position.netCents - exact.netCents), label).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('invoice positions requirement', () => {
  it('requires positions for several lines or a line above quantity one', () => {
    expect(linesNeedInvoicePositions([{}])).toBe(false);
    expect(linesNeedInvoicePositions([{ quantity: 1 }])).toBe(false);
    expect(linesNeedInvoicePositions([{ quantity: 2 }])).toBe(true);
    expect(linesNeedInvoicePositions([{}, {}])).toBe(true);
  });
});
