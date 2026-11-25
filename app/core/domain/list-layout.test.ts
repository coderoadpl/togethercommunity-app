import { describe, expect, it } from 'vitest';

import { listLayoutIdSchema, listLayoutSchema } from './list-layout.js';

const layout = {
  version: 1,
  columns: [{ field: 'createdAt', visible: true, width: 180 }, { field: 'invoice.status', visible: false }],
  sort: { field: 'amountCents', direction: 'asc' },
  filters: { billing: 'requested', search: '' },
};

describe('listLayoutSchema', () => {
  it('accepts a layout with columns, a sort and filters', () => {
    expect(listLayoutSchema.parse(layout)).toEqual(layout);
    expect(listLayoutSchema.parse({ ...layout, sort: null, filters: {} })).toMatchObject({ sort: null, filters: {} });
  });

  it.each([
    ['an unknown version', { ...layout, version: 2 }],
    ['an unknown key', { ...layout, density: 'compact' }],
    ['a column name with spaces', { ...layout, columns: [{ field: 'created at', visible: true }] }],
    ['a column name over 64 characters', { ...layout, columns: [{ field: 'a'.repeat(65), visible: true }] }],
    ['a width under 40', { ...layout, columns: [{ field: 'createdAt', visible: true, width: 39 }] }],
    ['a width over 1600', { ...layout, columns: [{ field: 'createdAt', visible: true, width: 1601 }] }],
    ['a fractional width', { ...layout, columns: [{ field: 'createdAt', visible: true, width: 120.5 }] }],
    ['more than 40 columns', { ...layout, columns: Array.from({ length: 41 }, (_value, index) => ({ field: `c${String(index)}`, visible: true })) }],
    ['a sort direction outside asc and desc', { ...layout, sort: { field: 'createdAt', direction: 'up' } }],
    ['a filter value over 200 characters', { ...layout, filters: { search: 'x'.repeat(201) } }],
    ['an empty filter key', { ...layout, filters: { '': 'x' } }],
    ['more than 30 filters', { ...layout, filters: Object.fromEntries(Array.from({ length: 31 }, (_value, index) => [`f${String(index)}`, 'x'])) }],
  ])('refuses %s', (_name, candidate) => {
    expect(listLayoutSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('listLayoutIdSchema', () => {
  it('knows only the orders list', () => {
    expect(listLayoutIdSchema.safeParse('orders').success).toBe(true);
    expect(listLayoutIdSchema.safeParse('members').success).toBe(false);
  });
});
