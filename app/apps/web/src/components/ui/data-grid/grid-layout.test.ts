import { describe, expect, it } from 'vitest';

import { defaultGridLayout, moveGridColumn, reconcileGridLayout, setGridColumnVisibility, setGridColumnWidth, type GridLayoutSchema } from './grid-layout.js';

const schema: GridLayoutSchema = {
  columns: [
    { field: 'date', visible: true },
    { field: 'member', visible: true },
    { field: 'amount', visible: true },
    { field: 'invoice', visible: true },
    { field: 'billing', visible: false },
  ],
  sortFields: ['date', 'amount'],
  filters: { status: (value) => value === 'paid' || value === 'failed', billing: (value) => value === 'requested' },
};

describe('grid layout', () => {
  it('starts from the declared columns with no sort and no filters', () => {
    expect(defaultGridLayout(schema)).toEqual({ version: 1, columns: schema.columns, sort: null, filters: {} });
  });

  it('keeps the saved order, visibility and widths of known columns', () => {
    const saved = { version: 1 as const, columns: [
      { field: 'amount', visible: true, width: 140 }, { field: 'date', visible: false }, { field: 'member', visible: true },
      { field: 'invoice', visible: true }, { field: 'billing', visible: true },
    ], sort: { field: 'amount', direction: 'asc' as const }, filters: { status: 'paid' } };
    expect(reconcileGridLayout(saved, schema)).toEqual(saved);
  });

  it('drops an unknown column and appends a new column after its default neighbour', () => {
    const saved = { version: 1 as const, columns: [
      { field: 'amount', visible: true }, { field: 'legacy', visible: true }, { field: 'date', visible: true },
      { field: 'member', visible: false }, { field: 'invoice', visible: true },
    ], sort: null, filters: {} };
    expect(reconcileGridLayout(saved, schema).columns.map((column) => [column.field, column.visible])).toEqual([
      ['amount', true], ['date', true], ['member', false], ['invoice', true], ['billing', false],
    ]);
  });

  it('places a new first column at the start', () => {
    const saved = { version: 1 as const, columns: [{ field: 'member', visible: true }], sort: null, filters: {} };
    expect(reconcileGridLayout(saved, schema).columns.map((column) => column.field)).toEqual(['date', 'member', 'amount', 'invoice', 'billing']);
  });

  it('drops unknown filter keys, invalid filter values and a sort on a column that cannot sort', () => {
    const saved = { version: 1 as const, columns: [], sort: { field: 'member', direction: 'desc' as const }, filters: { status: 'archived', billing: 'requested', legacy: 'x' } };
    const reconciled = reconcileGridLayout(saved, schema);
    expect(reconciled.filters).toEqual({ billing: 'requested' });
    expect(reconciled.sort).toBeNull();
  });

  it('falls back to the default layout when nothing is saved', () => {
    expect(reconcileGridLayout(null, schema)).toEqual(defaultGridLayout(schema));
  });

  it('moves a column one place and ignores a move past either end', () => {
    const layout = defaultGridLayout(schema);
    expect(moveGridColumn(layout, 'member', -1).columns.map((column) => column.field)).toEqual(['member', 'date', 'amount', 'invoice', 'billing']);
    expect(moveGridColumn(layout, 'member', 1).columns.map((column) => column.field)).toEqual(['date', 'amount', 'member', 'invoice', 'billing']);
    expect(moveGridColumn(layout, 'date', -1)).toBe(layout);
    expect(moveGridColumn(layout, 'billing', 1)).toBe(layout);
  });

  it('changes visibility and clamps a dragged width to the stored range', () => {
    const layout = setGridColumnVisibility(defaultGridLayout(schema), { billing: true, date: false });
    expect(layout.columns.filter((column) => column.visible).map((column) => column.field)).toEqual(['member', 'amount', 'invoice', 'billing']);
    expect(setGridColumnWidth(layout, 'member', 12.4).columns[1]).toEqual({ field: 'member', visible: true, width: 40 });
    expect(setGridColumnWidth(layout, 'member', 9000).columns[1]).toEqual({ field: 'member', visible: true, width: 1600 });
  });
});
