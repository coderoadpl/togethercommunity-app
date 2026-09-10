import { useId, type ReactNode } from 'react';
import { Box, Button, Dialog, DialogContent, DialogTitle, Stack, useMediaQuery, useTheme } from '@mui/material';
import { useTranslations } from '../../i18n/index.js';

export const AccountDialog = ({ open, title, pending = false, onClose, children }: {
  open: boolean; title: ReactNode; pending?: boolean; onClose(): void; children: ReactNode;
}) => {
  const titleId = useId();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const t = useTranslations();
  return <Dialog open={open} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby={titleId} onClose={() => { if (!pending) onClose(); }}>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}><Box component="span" id={titleId}>{title}</Box><Button disabled={pending} onClick={onClose}>{t.common.close}</Button></DialogTitle>
    <DialogContent><Stack spacing="1rem" sx={{ pt: '0.5rem' }}>{open ? children : null}</Stack></DialogContent>
  </Dialog>;
};
