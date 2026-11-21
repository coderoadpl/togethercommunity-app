import { useId, useRef } from 'react';
import { Box, Button, CircularProgress, Dialog, IconButton, Typography, useMediaQuery, useTheme } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { AccountGlyph, CheckoutLockerMapArea, CheckoutLockerMapCover, CheckoutLockerPickerBar, CheckoutLockerPickerHeading } from '../../theme.js';
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

export const LockerPicker = ({ open, token, language, shownCode, mapFailed, onPoint, onMapFailed, onCancel, onExited }: {
  open: boolean;
  token: string;
  language: 'pl' | 'en';
  shownCode: string | null;
  mapFailed: boolean;
  onPoint: (point: PickedPickupPoint) => void;
  onMapFailed: () => void;
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
      aria-describedby={statusId}
      data-testid="checkout-locker-dialog"
      slotProps={{
        transition: { onEnter: () => heading.current?.focus(), onExited },
        paper: {
          sx: {
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            ...(fullScreen
              ? { height: '100dvh', maxHeight: '100dvh', pb: 'env(safe-area-inset-bottom)' }
              : { width: 'min(64rem, calc(100% - 4rem))', height: 'min(48rem, calc(100dvh - 4rem))', maxWidth: 'none', maxHeight: 'none', m: '2rem' }),
          },
        },
      }}
    >
      <CheckoutLockerPickerBar
        direction="row"
        useFlexGap
        spacing="0.5rem"
        sx={{
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          pt: fullScreen ? 'max(0.5rem, env(safe-area-inset-top))' : '0.75rem',
          pb: '0.5rem',
          pl: 'max(1rem, env(safe-area-inset-left))',
          pr: 'max(0.5rem, env(safe-area-inset-right))',
        }}
      >
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <CheckoutLockerPickerHeading component="h2" variant="h6" id={titleId} ref={heading} tabIndex={-1}>{t.shipping.lockerChoose}</CheckoutLockerPickerHeading>
          <Typography id={statusId} role="status" aria-live="polite" variant="body2" color="text.secondary" data-testid="checkout-locker-dialog-status">
            {mapFailed ? t.shipping.lockerMapFailed : t.shipping.lockerPickerPrompt}
          </Typography>
        </Box>
        <IconButton aria-label={t.common.close} onClick={onCancel} data-testid="checkout-locker-dialog-close" sx={{ width: '2.75rem', height: '2.75rem' }}>
          <CloseGlyph />
        </IconButton>
      </CheckoutLockerPickerBar>
      <CheckoutLockerMapArea data-testid="checkout-locker-map-area">
        {mapFailed ? (
          <CheckoutLockerMapCover>
            <Button variant="outlined" onClick={onCancel} data-testid="checkout-locker-type-code">{t.shipping.lockerTypeCode}</Button>
          </CheckoutLockerMapCover>
        ) : (
          <>
            <CheckoutLockerMapCover aria-hidden="true">
              <CircularProgress size="2rem" color="inherit" />
              <Typography variant="body2">{t.shipping.lockerMapLoading}</Typography>
            </CheckoutLockerMapCover>
            <InpostGeowidget token={token} language={language} shownCode={shownCode} onPoint={onPoint} onEscape={onCancel} onFailed={onMapFailed} />
          </>
        )}
      </CheckoutLockerMapArea>
    </Dialog>
  );
};
