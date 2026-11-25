import { useId } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, SvgIcon, Typography } from '@mui/material';

import { useTranslations } from '../../../i18n/index.js';
import { StudioGridColumnList, StudioGridColumnRow } from '../../../theme.js';
import { moveGridColumn, setGridColumnVisibility, type GridLayout } from './grid-layout.js';

interface GridColumnsDialogProps {
  open: boolean;
  onClose: () => void;
  labels: Readonly<Record<string, string>>;
  layout: GridLayout;
  onChange: (layout: GridLayout) => void;
  onReset: () => void;
}

export const GridColumnsDialog = ({ open, onClose, labels, layout, onChange, onReset }: GridColumnsDialogProps) => {
  const t = useTranslations();
  const columns = layout.columns.filter((column) => labels[column.field] !== undefined);
  const visibleCount = columns.filter((column) => column.visible).length;
  const prefix = useId();
  const buttonId = (field: string, direction: 'up' | 'down') => `${prefix}-${field}-${direction}`;
  const move = (field: string, direction: 'up' | 'down') => {
    onChange(moveGridColumn(layout, field, direction === 'up' ? -1 : 1));
    requestAnimationFrame(() => {
      const same = document.getElementById(buttonId(field, direction));
      const other = document.getElementById(buttonId(field, direction === 'up' ? 'down' : 'up'));
      const target = same instanceof HTMLButtonElement && same.disabled ? other : same;
      target?.focus();
    });
  };
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="studio-grid-columns-title" fullWidth maxWidth="xs">
      <DialogTitle id="studio-grid-columns-title">{t.dataGrid.columnsDialogTitle}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: '0.75rem' }}>{t.dataGrid.columnsDialogHint}</Typography>
        <StudioGridColumnList data-testid="studio-grid-columns">
          {columns.map((column, index) => {
            const label = labels[column.field] ?? column.field;
            return (
              <StudioGridColumnRow key={column.field}>
                <FormControlLabel
                  sx={{ flex: '1 1 auto', minWidth: 0, mr: 0 }}
                  control={(
                    <Checkbox
                      checked={column.visible}
                      disabled={column.visible && visibleCount === 1}
                      onChange={(event) => onChange(setGridColumnVisibility(layout, { [column.field]: event.target.checked }))}
                    />
                  )}
                  label={label}
                />
                <IconButton id={buttonId(column.field, 'up')} size="small" aria-label={t.dataGrid.moveUp({ column: label })} disabled={index === 0}
                  onClick={() => move(column.field, 'up')}>
                  <SvgIcon fontSize="small"><path d="m4 12 1.41 1.41L11 7.83V20h2V7.83l5.59 5.58L20 12l-8-8z" /></SvgIcon>
                </IconButton>
                <IconButton id={buttonId(column.field, 'down')} size="small" aria-label={t.dataGrid.moveDown({ column: label })} disabled={index === columns.length - 1}
                  onClick={() => move(column.field, 'down')}>
                  <SvgIcon fontSize="small"><path d="m20 12-1.41-1.41L13 16.17V4h-2v12.17l-5.59-5.58L4 12l8 8z" /></SvgIcon>
                </IconButton>
              </StudioGridColumnRow>
            );
          })}
        </StudioGridColumnList>
      </DialogContent>
      <DialogActions>
        <Button onClick={onReset}>{t.dataGrid.resetLayout}</Button>
        <Button variant="contained" onClick={onClose}>{t.dataGrid.done}</Button>
      </DialogActions>
    </Dialog>
  );
};
