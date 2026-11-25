import { useState, type ReactNode } from 'react';
import { Button, Chip, Popover, Stack, Typography } from '@mui/material';
import { GridFilterListIcon, GridViewColumnIcon } from '@mui/x-data-grid';

import { useTranslations } from '../../../i18n/index.js';
import { StudioGridChipRow, StudioGridCount } from '../../../theme.js';

export interface GridFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface GridFilterBarProps {
  count: string | null;
  chips: readonly GridFilterChip[];
  onClearAll: () => void;
  quickActions?: ReactNode;
  renderAllFilters: () => ReactNode;
  onOpenColumns?: () => void;
}

export const GridFilterBar = ({ count, chips, onClearAll, quickActions, renderAllFilters, onOpenColumns }: GridFilterBarProps) => {
  const t = useTranslations();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <Stack useFlexGap spacing="0.5rem" sx={{ mb: '0.75rem' }} data-testid="studio-grid-filter-bar">
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
        <StudioGridCount variant="body2" role="status" aria-live="polite" data-testid="studio-grid-count">{count ?? ''}</StudioGridCount>
        {quickActions}
        <Button size="small" variant="outlined" startIcon={<GridFilterListIcon />} aria-haspopup="dialog" aria-expanded={anchor !== null}
          onClick={(event) => setAnchor(event.currentTarget)}>
          {t.dataGrid.addFilter}
        </Button>
        {onOpenColumns === undefined ? null : (
          <Button size="small" variant="outlined" startIcon={<GridViewColumnIcon />} aria-haspopup="dialog" onClick={onOpenColumns}>
            {t.dataGrid.columns}
          </Button>
        )}
      </Stack>
      {chips.length === 0 ? null : (
        <StudioGridChipRow role="group" aria-label={t.dataGrid.activeFilters} data-testid="studio-grid-chips">
          {chips.map((chip) => (
            <Chip
              key={chip.key}
              size="small"
              label={chip.label}
              aria-label={t.dataGrid.removeFilter({ filter: chip.label })}
              onClick={chip.onRemove}
              onDelete={chip.onRemove}
            />
          ))}
          <Button size="small" onClick={onClearAll}>{t.dataGrid.clearAll}</Button>
        </StudioGridChipRow>
      )}
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { role: 'dialog', 'aria-label': t.dataGrid.addFilter } }}
      >
        <Stack useFlexGap spacing="0.75rem" sx={{ p: '1rem', minWidth: '16rem', maxWidth: '22rem' }}>
          <Typography variant="subtitle2" component="h2">{t.dataGrid.addFilter}</Typography>
          {renderAllFilters()}
        </Stack>
      </Popover>
    </Stack>
  );
};
