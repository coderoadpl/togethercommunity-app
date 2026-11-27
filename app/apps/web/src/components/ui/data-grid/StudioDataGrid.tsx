import { createContext, useContext, useState, type ReactNode } from 'react';
import { ListItemIcon, ListItemText, MenuItem, Popover, Stack, Typography } from '@mui/material';
import {
  DataGrid,
  GridColumnMenu,
  GridColumnMenuHideItem,
  GridFilterListIcon,
  GridViewColumnIcon,
  useGridApiRef,
  type GridColDef,
  type GridColumnMenuItemProps,
  type GridColumnMenuProps,
  type GridPaginationModel,
  type GridSortModel,
  type GridValidRowModel,
} from '@mui/x-data-grid';
import { enUS, plPL } from '@mui/x-data-grid/locales';

import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { STUDIO_GRID_HEADER_HEIGHT, StudioDataGridFrame } from '../../../theme.js';
import { GRID_PAGE_SIZE_OPTIONS, setGridColumnVisibility, setGridColumnWidth, type GridLayout } from './grid-layout.js';

declare module '@mui/x-data-grid' {
  interface RowPropsOverrides { 'data-testid'?: string }
}

export type StudioGridLeadingColumn<R extends GridValidRowModel> = GridColDef<R>;

export type StudioGridColumn<R extends GridValidRowModel> = GridColDef<R> & { filterKeys?: readonly string[] };

interface StudioGridMenuContext {
  hasFilter: (field: string) => boolean;
  openFilter: (field: string) => void;
  openColumns: () => void;
}

const StudioGridContext = createContext<StudioGridMenuContext>({ hasFilter: () => false, openFilter: () => undefined, openColumns: () => undefined });

const StudioFilterMenuItem = ({ colDef, onClick }: GridColumnMenuItemProps) => {
  const t = useTranslations();
  const menu = useContext(StudioGridContext);
  if (!menu.hasFilter(colDef.field)) return null;
  return (
    <MenuItem onClick={(event) => { onClick(event); menu.openFilter(colDef.field); }}>
      <ListItemIcon><GridFilterListIcon fontSize="small" /></ListItemIcon>
      <ListItemText>{t.dataGrid.filter}</ListItemText>
    </MenuItem>
  );
};

const StudioColumnsMenuItem = (props: GridColumnMenuItemProps) => {
  const t = useTranslations();
  const menu = useContext(StudioGridContext);
  return (
    <>
      <GridColumnMenuHideItem {...props} />
      <MenuItem onClick={(event) => { props.onClick(event); menu.openColumns(); }}>
        <ListItemIcon><GridViewColumnIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{t.dataGrid.columns}</ListItemText>
      </MenuItem>
    </>
  );
};

const StudioColumnMenu = (props: GridColumnMenuProps) => (
  <GridColumnMenu
    {...props}
    slots={{ columnMenuFilterItem: null, columnMenuColumnsItem: StudioColumnsMenuItem, columnMenuUserItem: StudioFilterMenuItem }}
    slotProps={{ columnMenuUserItem: { displayOrder: 15 } }}
  />
);

const ROW_HEIGHT = () => 'auto' as const;

export interface StudioDataGridProps<R extends GridValidRowModel> {
  label: string;
  rows: readonly R[];
  getRowId: (row: R) => string;
  leadingColumns?: readonly StudioGridLeadingColumn<R>[];
  columns: readonly StudioGridColumn<R>[];
  layout: GridLayout;
  onLayoutChange: (layout: GridLayout) => void;
  rowCount: number;
  paginationModel: GridPaginationModel;
  onPaginationModelChange: (model: GridPaginationModel) => void;
  loading?: boolean;
  onOpenColumns: () => void;
  renderFilters: (keys: readonly string[]) => ReactNode;
  rowTestId?: string;
  'data-testid'?: string;
}

export const StudioDataGrid = <R extends GridValidRowModel>({
  label, rows, getRowId, leadingColumns = [], columns, layout, onLayoutChange, rowCount, paginationModel,
  onPaginationModelChange, loading = false, onOpenColumns, renderFilters, rowTestId, 'data-testid': testId,
}: StudioDataGridProps<R>) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const apiRef = useGridApiRef();
  const [filterField, setFilterField] = useState<string | null>(null);
  const byField = new Map(columns.map((column) => [column.field, column]));
  const ordered = layout.columns.flatMap((entry) => {
    const column = byField.get(entry.field);
    if (column === undefined) return [];
    return [entry.width === undefined ? column : { ...column, width: entry.width, flex: 0 }];
  });
  const visibility = Object.fromEntries(layout.columns.map((column) => [column.field, column.visible]));
  const sortModel: GridSortModel = layout.sort === null ? [] : [{ field: layout.sort.field, sort: layout.sort.direction }];
  const filterColumn = filterField === null ? undefined : byField.get(filterField);
  const { components: { MuiDataGrid: { defaultProps: { localeText } } } } = language === 'pl' ? plPL : enUS;
  const closeFilter = () => {
    const field = filterField;
    setFilterField(null);
    if (field !== null) requestAnimationFrame(() => apiRef.current?.setColumnHeaderFocus(field));
  };
  const menu: StudioGridMenuContext = {
    hasFilter: (field) => (byField.get(field)?.filterKeys?.length ?? 0) > 0,
    openFilter: setFilterField,
    openColumns: onOpenColumns,
  };

  return (
    <StudioGridContext value={menu}>
      <StudioDataGridFrame data-testid={testId}>
      <DataGrid
        apiRef={apiRef}
        aria-label={label}
        rows={rows}
        getRowId={getRowId}
        columns={[...leadingColumns, ...ordered]}
        columnVisibilityModel={visibility}
        onColumnVisibilityModelChange={(model) => onLayoutChange(setGridColumnVisibility(layout, model))}
        onColumnWidthChange={(params) => onLayoutChange(setGridColumnWidth(layout, params.colDef.field, params.width))}
        sortingMode="server"
        sortModel={sortModel}
        onSortModelChange={(model) => {
          const [first] = model;
          onLayoutChange({ ...layout, sort: first?.sort == null ? null : { field: first.field, direction: first.sort } });
        }}
        paginationMode="server"
        rowCount={rowCount}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        pageSizeOptions={GRID_PAGE_SIZE_OPTIONS}
        columnHeaderHeight={STUDIO_GRID_HEADER_HEIGHT}
        loading={loading}
        disableColumnFilter
        disableRowSelectionOnClick
        disableVirtualization
        autoHeight
        getRowHeight={ROW_HEIGHT}
        localeText={localeText}
        slots={{ columnMenu: StudioColumnMenu }}
        {...(rowTestId === undefined ? {} : { slotProps: { row: { 'data-testid': rowTestId } } })}
      />
      </StudioDataGridFrame>
      <Popover
        open={filterColumn !== undefined}
        anchorEl={() => (filterField === null ? null : apiRef.current?.getColumnHeaderElement(filterField)) ?? document.body}
        onClose={closeFilter}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        disableRestoreFocus
        slotProps={{ paper: { role: 'dialog', 'aria-label': t.dataGrid.filterTitle({ column: filterColumn?.headerName ?? '' }) } }}
      >
        {filterColumn === undefined ? null : (
          <Stack useFlexGap spacing="0.75rem" sx={{ p: '1rem', minWidth: '16rem' }}>
            <Typography variant="subtitle2" component="h2">{t.dataGrid.filterTitle({ column: filterColumn.headerName ?? filterColumn.field })}</Typography>
            {renderFilters(filterColumn.filterKeys ?? [])}
          </Stack>
        )}
      </Popover>
    </StudioGridContext>
  );
};
