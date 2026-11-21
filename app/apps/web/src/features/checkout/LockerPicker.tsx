import { useId, useRef } from 'react';
import { Box, Button, CircularProgress, IconButton, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import {
  AccountGlyph,
  CheckoutLockerDialog,
  CheckoutLockerMapArea,
  CheckoutLockerMapCover,
  CheckoutLockerPickerBar,
  CheckoutLockerPickerHeading,
} from '../../theme.js';
import { InpostGeowidget } from './InpostGeowidget.js';
import type { PickedPickupPoint } from './index.web.js';

const CloseGlyph = () => (
  <AccountGlyph aria-hidden="true" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </AccountGlyph>
);

const BackGlyph = () => (
  <AccountGlyph aria-hidden="true" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </AccountGlyph>
);

const KeyboardGlyph = () => (
  <AccountGlyph aria-hidden="true" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
  </AccountGlyph>
);

const SHORT_SCREEN = '(max-height: 599.95px)';

export const pointSummary = (point: PickedPickupPoint) => [point.code, point.name].filter((value) => value !== null).join(' · ');

export const LockerPicker = ({ open, token, language, shownCode, mapFailed, onPoint, onMapFailed, onMapRetry, onTypeCode, onCancel, onExited }: {
  open: boolean;
  token: string;
  language: 'pl' | 'en';
  shownCode: string | null;
  mapFailed: boolean;
  onPoint: (point: PickedPickupPoint) => void;
  onMapFailed: () => void;
  onMapRetry: () => void;
  onTypeCode: () => void;
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
  const retryMap = () => {
    heading.current?.focus();
    onMapRetry();
  };
  return (
    <CheckoutLockerDialog
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
        fullScreen={fullScreen}
        sx={{
          pt: fullScreen ? 'max(0.25rem, env(safe-area-inset-top))' : '0.75rem',
          pb: '0.5rem',
          pl: 'max(1rem, env(safe-area-inset-left))',
          pr: fullScreen ? 'max(1rem, env(safe-area-inset-right))' : 'max(0.5rem, env(safe-area-inset-right))',
        }}
      >
        {fullScreen ? (
          <Button
            variant="text"
            onClick={onCancel}
            startIcon={<BackGlyph />}
            data-testid="checkout-locker-dialog-back"
            sx={{ gridArea: 'back', justifySelf: 'start', minHeight: '2.75rem', px: '0.5rem', ml: '-0.5rem' }}
          >
            {t.shipping.lockerPickerBack}
          </Button>
        ) : null}
        <Box sx={{ gridArea: 'text', minWidth: 0 }}>
          <CheckoutLockerPickerHeading component="h2" variant="h6" id={titleId} ref={heading} tabIndex={-1}>{t.shipping.lockerChoose}</CheckoutLockerPickerHeading>
          <Typography id={statusId} role="status" aria-live="polite" variant="body2" color="text.secondary" data-testid="checkout-locker-dialog-status">
            {mapFailed ? t.shipping.lockerPickerMapFailed : t.shipping.lockerPickerPrompt}
          </Typography>
        </Box>
        <Button
          variant="text"
          onClick={onTypeCode}
          startIcon={<KeyboardGlyph />}
          data-testid="checkout-locker-dialog-know-code"
          sx={{ gridArea: 'code', justifySelf: 'end', minHeight: '2.75rem', px: '0.5rem', mr: '-0.5rem' }}
        >
          {t.shipping.lockerKnowCode}
        </Button>
        {fullScreen ? null : (
          <IconButton aria-label={t.common.close} onClick={onCancel} data-testid="checkout-locker-dialog-close" sx={{ gridArea: 'close', width: '2.75rem', height: '2.75rem' }}>
            <CloseGlyph />
          </IconButton>
        )}
      </CheckoutLockerPickerBar>
      <CheckoutLockerMapArea data-testid="checkout-locker-map-area">
        {mapFailed ? (
          <CheckoutLockerMapCover>
            <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <Button variant="contained" onClick={retryMap} data-testid="checkout-locker-map-retry">{t.common.retry}</Button>
              <Button variant="outlined" onClick={onTypeCode} data-testid="checkout-locker-type-code">{t.shipping.lockerTypeCode}</Button>
            </Stack>
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
    </CheckoutLockerDialog>
  );
};
