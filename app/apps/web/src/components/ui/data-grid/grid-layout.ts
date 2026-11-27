export const GRID_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface GridLayoutColumn { field: string; visible: boolean; width?: number | undefined }

export interface GridLayout {
  version: 1;
  columns: GridLayoutColumn[];
  sort: { field: string; direction: 'asc' | 'desc' } | null;
  filters: Record<string, string>;
}

export interface GridLayoutSchema {
  columns: readonly GridLayoutColumn[];
  sortFields: readonly string[];
  filters: Readonly<Record<string, (value: string) => boolean>>;
}

export const defaultGridLayout = (schema: GridLayoutSchema): GridLayout => ({
  version: 1,
  columns: schema.columns.map((column) => ({ ...column })),
  sort: null,
  filters: {},
});

export const validGridFilters = (filters: Readonly<Record<string, string>>, schema: GridLayoutSchema): Record<string, string> =>
  Object.fromEntries(Object.entries(filters).filter(([key, value]) =>
    Object.hasOwn(schema.filters, key) && value !== '' && schema.filters[key]?.(value) === true));

export const reconcileGridLayout = (saved: GridLayout | null, schema: GridLayoutSchema): GridLayout => {
  if (saved === null) return defaultGridLayout(schema);
  const known = new Set(schema.columns.map((column) => column.field));
  const placed = new Set<string>();
  const columns: GridLayoutColumn[] = [];
  for (const column of saved.columns) {
    if (!known.has(column.field) || placed.has(column.field)) continue;
    placed.add(column.field);
    columns.push(column);
  }
  schema.columns.forEach((column, index) => {
    if (placed.has(column.field)) return;
    const before = schema.columns.slice(0, index).findLast((candidate) => placed.has(candidate.field));
    const at = before === undefined ? 0 : columns.findIndex((candidate) => candidate.field === before.field) + 1;
    columns.splice(at, 0, { ...column });
    placed.add(column.field);
  });
  const sort = saved.sort !== null && schema.sortFields.includes(saved.sort.field) ? saved.sort : null;
  return { version: 1, columns, sort, filters: validGridFilters(saved.filters, schema) };
};

export const moveGridColumn = (layout: GridLayout, field: string, offset: -1 | 1): GridLayout => {
  const from = layout.columns.findIndex((column) => column.field === field);
  const to = from + offset;
  const moving = layout.columns[from];
  if (from < 0 || to < 0 || to >= layout.columns.length || moving === undefined) return layout;
  const columns = layout.columns.filter((column) => column.field !== field);
  columns.splice(to, 0, moving);
  return { ...layout, columns };
};

export const setGridColumnVisibility = (layout: GridLayout, visibility: Readonly<Record<string, boolean>>): GridLayout => ({
  ...layout,
  columns: layout.columns.map((column) => ({ ...column, visible: visibility[column.field] ?? column.visible })),
});

export const setGridColumnWidth = (layout: GridLayout, field: string, width: number): GridLayout => ({
  ...layout,
  columns: layout.columns.map((column) => column.field === field
    ? { ...column, width: Math.min(1600, Math.max(40, Math.round(width))) }
    : column),
});

export const sameGridLayout = (left: GridLayout, right: GridLayout): boolean => JSON.stringify(left) === JSON.stringify(right);
