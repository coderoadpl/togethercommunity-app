import { useId, useRef } from 'react';
import { Box, Button, CircularProgress, Dialog, IconButton, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { AccountGlyph } from '../../theme.js';
import type { PickedPickupPoint } from './core/events.js';
import { InpostGeowidget } from './InpostGeowidget.js';

const CloseGlyph = () => (
  <AccountGlyph aria-hidden="true" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </AccountGlyph>
);

const SHORT_SCREEN = '(max-height: 599.95px)';

export const pointSummary = (point: PickedPickupPoint) => [point.code, point.name].filter((value) => value !== null).join(' · ');

export const LockerPicker = ({ open, token, language, candidate, mapFailed, onPoint, onMapFailed, onConfirm, onCancel, onExited }: {
  open: boolean;
  token: string;
  language: 'pl' | 'en';
  candidate: PickedPickupPoint | null;
  mapFailed: boolean;
  onPoint: (point: PickedPickupPoint) => void;
  onMapFailed: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onExited: () => void;
}) => {
  const t = useTranslations();
  const theme = useTheme();
  const fullScreen = useMediaQuery(`${theme.breakpoints.down('md')}, ${SHORT_SCREEN}`);
  const id = useId();
  const titleId = `${id}-title`;
  const statusId = `${id}-status`;
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      fullScreen={fullScreen}
      maxWidth={false}
      disableRestoreFocus
      aria-labelledby={titleId}
      data-testid="checkout-locker-dialog"
      slotProps={{
        transition: { onEnter: () => heading.current?.focus(), onExited },
        paper: {
          sx: {
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            ...(fullScreen
              ? { height: '100dvh', maxHeight: '100dvh' }
              : { width: 'min(64rem, calc(100% - 4rem))', height: 'min(48rem, calc(100dvh - 4rem))', maxWidth: 'none', maxHeight: 'none', m: '2rem' }),
          },
        },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        useFlexGap
        spacing="0.5rem"
        sx={{
          flex: 'none',
          pt: fullScreen ? 'max(0.5rem, env(safe-area-inset-top))' : '0.75rem',
          pb: '0.5rem',
          pl: 'max(1rem, env(safe-area-inset-left))',
          pr: 'max(0.5rem, env(safe-area-inset-right))',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography component="h2" variant="h6" id={titleId} ref={heading} tabIndex={-1} sx={{ outline: 'none' }}>{t.shipping.lockerChoose}</Typography>
        <IconButton aria-label={t.common.close} onClick={onCancel} data-testid="checkout-locker-dialog-close" sx={{ width: '2.75rem', height: '2.75rem' }}>
          <CloseGlyph />
        </IconButton>
      </Stack>
      <Box sx={{ position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden', bgcolor: 'action.hover' }} data-testid="checkout-locker-map-area">
        {mapFailed ? (
          <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, p: '1rem' }}>
            <Button variant="outlined" onClick={onCancel} data-testid="checkout-locker-type-code">{t.shipping.lockerTypeCode}</Button>
          </Stack>
        ) : (
          <>
            <Stack alignItems="center" justifyContent="center" useFlexGap spacing="0.75rem" sx={{ position: 'absolute', inset: 0, color: 'text.secondary' }} aria-hidden="true">
              <CircularProgress size="2rem" color="inherit" />
              <Typography variant="body2">{t.shipping.lockerMapLoading}</Typography>
            </Stack>
            <InpostGeowidget token={token} language={language} onPoint={onPoint} onEscape={onCancel} onFailed={onMapFailed} />
          </>
        )}
      </Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        useFlexGap
        spacing="0.75rem"
        sx={{
          flex: 'none',
          pt: '0.75rem',
          pb: fullScreen ? 'max(0.75rem, env(safe-area-inset-bottom))' : '0.75rem',
          pl: 'max(1rem, env(safe-area-inset-left))',
          pr: 'max(1rem, env(safe-area-inset-right))',
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Box id={statusId} role="status" aria-live="polite" data-testid="checkout-locker-dialog-status" sx={{ flex: '1 1 auto', minWidth: 0 }}>
          {mapFailed ? (
            <Typography variant="body2">{t.shipping.lockerMapFailed}</Typography>
          ) : candidate === null ? (
            <Typography variant="body2" color="text.secondary">{t.shipping.lockerPickerPrompt}</Typography>
          ) : (
            <>
              <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{pointSummary(candidate)}</Typography>
              {candidate.address === null ? null : <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{candidate.address}</Typography>}
            </>
          )}
        </Box>
        <Button
          variant="contained"
          size="large"
          disabled={candidate === null}
          aria-describedby={statusId}
          onClick={onConfirm}
          data-testid="checkout-locker-confirm"
          sx={{ flex: 'none', minHeight: '2.75rem' }}
        >
          {t.shipping.lockerConfirm}
        </Button>
      </Stack>
    </Dialog>
  );
};
