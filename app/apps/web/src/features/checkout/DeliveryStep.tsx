import { Fragment, useId, useReducer, useRef, useState } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  OutlinedInput,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';

import { pickupPointCodeValid, type PublicShippingRate } from '#core/domain/index.js';

import { CheckIcon, ChevronDownIcon, MapPinIcon } from '../../components/ui/account-icons.js';
import { useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CheckoutDeliveryCard, CheckoutDeliveryLabel, CheckoutDeliveryPrice, CheckoutInlineToggle, CheckoutLockerChosen, CheckoutLockerChosenCaption, CheckoutLockerName, CheckoutPriceOption, FinePrint, VisuallyHidden } from '../../theme.js';
import { rowAction } from './checkout-keys.js';
import { LockerPicker, pointSummary } from './LockerPicker.js';
import { useHistoryEntry } from './use-history-entry.js';
import {
  acceptsPoint,
  closedLockerPicker,
  lockerEntry,
  pickedPickupPoint,
  reduceLockerPicker,
  type CheckoutEvent,
  type CheckoutState,
  type GeowidgetAccess,
  type PickedPickupPoint,
} from './index.web.js';

export const DeliveryStep = ({ rates, state, dispatch, currency, language, geowidget, disabled, layout = 'list' }: {
  rates: PublicShippingRate[];
  state: CheckoutState;
  dispatch: (event: CheckoutEvent) => void;
  currency: string;
  language: 'pl' | 'en';
  geowidget: GeowidgetAccess;
  disabled: boolean;
  layout?: 'list' | 'cards';
}) => {
  const t = useTranslations();
  const lockerId = useId();
  const selected = rates.find((rate) => rate.id === state.shippingRateId) ?? null;
  const [codeBlurred, setCodeBlurred] = useState(false);
  const codeInvalid = codeBlurred && state.pickupPointCode.trim() !== '' && !pickupPointCodeValid(state.pickupPointCode);
  const picked = pickedPickupPoint(state);
  const [picker, sendPicker] = useReducer(reduceLockerPicker, closedLockerPicker);
  const [codeShown, setCodeShown] = useState(() => state.pickupPointCode !== '' && picked === null);
  const entry = lockerEntry(geowidget, picker);
  const pickerHistory = useHistoryEntry(() => sendPicker({ type: 'pickerCancelled' }));
  const opener = useRef<HTMLButtonElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const committed = useRef<string | null>(null);
  const codeAfterExit = useRef(false);
  const [announcedCode, setAnnouncedCode] = useState<string | null>(null);
  const openPicker = () => {
    committed.current = null;
    codeAfterExit.current = false;
    setAnnouncedCode(null);
    pickerHistory.enter();
    sendPicker({ type: 'pickerOpened' });
  };
  const cancelPicker = () => {
    pickerHistory.leave();
    sendPicker({ type: 'pickerCancelled' });
  };
  const typeCode = () => {
    codeAfterExit.current = true;
    setCodeShown(true);
    cancelPicker();
  };
  const commitPoint = (point: PickedPickupPoint) => {
    if (!acceptsPoint(picker)) return;
    committed.current = point.code;
    dispatch({ type: 'pickupPointSelected', point });
    setCodeShown(false);
    pickerHistory.leave();
    sendPicker({ type: 'pointSelected' });
  };
  const pickerExited = () => {
    const code = codeInput.current;
    if (codeAfterExit.current) {
      code?.focus();
      if (code !== null && code.value !== '') code.select();
    } else {
      (opener.current ?? code)?.focus();
    }
    codeAfterExit.current = false;
    setAnnouncedCode(committed.current);
    committed.current = null;
  };
  const announcement = picked !== null && picked.code === announcedCode ? t.shipping.lockerChosenAnnouncement(picked) : '';
  const codeReason = entry.kind === 'map' ? null : {
    no_map: null,
    withheld_for_staff: { text: t.shipping.lockerMapStaffHint, testId: 'checkout-locker-map-staff-hint' },
    map_failed: { text: t.shipping.lockerMapFailed, testId: 'checkout-locker-map-failed' },
  }[entry.reason];
  const codeField = (
    <FormControl fullWidth error={codeInvalid}>
      <FormLabel htmlFor="checkout-pickup-point">{t.shipping.lockerCodeLabel}</FormLabel>
      <OutlinedInput
        id="checkout-pickup-point"
        inputRef={codeInput}
        value={state.pickupPointCode}
        disabled={disabled}
        required
        inputProps={{ maxLength: 12, autoCapitalize: 'characters', 'aria-describedby': 'checkout-pickup-point-hint', 'data-testid': 'checkout-pickup-point' }}
        onChange={(event) => dispatch({ type: 'pickupPointCodeChanged', code: event.target.value })}
        onBlur={() => setCodeBlurred(true)}
      />
      <FormHelperText id="checkout-pickup-point-hint" sx={{ mx: 0 }}>{codeInvalid ? t.shipping.lockerCodeInvalid : t.shipping.lockerCodeHint}</FormHelperText>
    </FormControl>
  );
  const lockerChoice = picked === null ? (
    <Button ref={opener} variant="contained" size="large" fullWidth disabled={disabled} onClick={openPicker} startIcon={<MapPinIcon />} data-testid="checkout-locker-choose" sx={{ minHeight: '2.75rem' }}>
      {t.shipping.lockerChoose}
    </Button>
  ) : (
    <CheckoutLockerChosen>
      <Box id={`${lockerId}-picked`} data-testid="checkout-pickup-point-selected" sx={{ minWidth: 0 }}>
        <CheckoutLockerChosenCaption variant="caption" color="text.secondary"><CheckIcon />{t.shipping.lockerSelected}</CheckoutLockerChosenCaption>
        <CheckoutLockerName variant="body2">{pointSummary(picked)}</CheckoutLockerName>
        {picked.address === null ? null : <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{picked.address}</Typography>}
      </Box>
      <Button
        ref={opener}
        variant="text"
        disableFocusRipple
        disabled={disabled}
        onClick={openPicker}
        aria-label={t.shipping.lockerChangeLabel}
        aria-describedby={`${lockerId}-picked`}
        data-testid="checkout-locker-change"
        sx={{ flex: 'none', minHeight: '2.75rem' }}
      >
        {t.shipping.lockerChange}
      </Button>
    </CheckoutLockerChosen>
  );
  const lockerPicker = selected !== null && selected.pickupPoint === 'inpost_locker' ? (
    <Box sx={layout === 'cards' ? { pt: '0.25rem', pb: entry.kind === 'map' && !codeShown ? 0 : '0.5rem' } : { mt: '0.2rem', mb: '0.5rem' }} data-testid="checkout-locker-picker" {...rowAction('pick')}>
      {entry.kind === 'map' ? (
        <Stack useFlexGap spacing="0.25rem" sx={{ alignItems: 'flex-start' }}>
          {lockerChoice}
          <CheckoutInlineToggle type="button" aria-expanded={codeShown} aria-controls={`${lockerId}-code`} onClick={() => setCodeShown((shown) => !shown)} data-testid="checkout-locker-know-code">
            {t.shipping.lockerKnowCode}
            <ChevronDownIcon />
          </CheckoutInlineToggle>
          <Box id={`${lockerId}-code`} hidden={!codeShown} sx={{ alignSelf: 'stretch' }}>{codeShown ? codeField : null}</Box>
          <VisuallyHidden role="status" aria-live="polite" data-testid="checkout-locker-announcement">{announcement}</VisuallyHidden>
        </Stack>
      ) : (
        <Stack useFlexGap spacing="0.75rem">
          {codeReason === null ? null : (
            <Typography variant="body2" color="text.secondary" data-testid={codeReason.testId}>{codeReason.text}</Typography>
          )}
          {codeField}
        </Stack>
      )}
    </Box>
  ) : null;
  const lockerDialog = geowidget.status === 'map' ? (
    <LockerPicker
      open={picker.picker.status === 'open'}
      token={geowidget.token}
      language={language}
      shownCode={picked?.code ?? null}
      mapFailed={picker.picker.status === 'open' && picker.picker.map === 'failed'}
      onPoint={commitPoint}
      onMapFailed={() => sendPicker({ type: 'mapFailed' })}
      onMapRetry={() => sendPicker({ type: 'mapRetryRequested' })}
      onTypeCode={typeCode}
      onCancel={cancelPicker}
      onExited={pickerExited}
    />
  ) : null;
  return (
    <>
      <FormControl data-testid="checkout-delivery">
        <FormLabel component="p" id="checkout-delivery-label">{t.shipping.deliveryHeading}</FormLabel>
        {rates.length === 0 ? (
          <Typography role="alert" color="error">{t.shipping.noDeliveryOptions}</Typography>
        ) : (
          <RadioGroup
            aria-labelledby="checkout-delivery-label"
            sx={layout === 'cards' ? { gap: '0.5rem', mt: '0.25rem' } : undefined}
            value={state.shippingRateId ?? ''}
            onChange={(event) => dispatch({ type: 'shippingRateSelected', rateId: event.target.value })}
          >
            {rates.map((rate) => (
              <Fragment key={rate.id}>
                {layout === 'cards' ? (
                  <CheckoutDeliveryCard variant="outlined" selected={rate.id === state.shippingRateId} data-testid={`checkout-delivery-option-${rate.id}`}>
                    <FormControlLabel
                      value={rate.id}
                      disabled={disabled}
                      control={<Radio />}
                      data-testid={`checkout-delivery-${rate.id}`}
                      disableTypography
                      label={(
                        <CheckoutDeliveryLabel>
                          <Typography component="span" sx={{ gridArea: 'name', overflowWrap: 'anywhere' }}>{rate.label}</Typography>
                          {' '}<VisuallyHidden>—</VisuallyHidden>{' '}
                          <CheckoutDeliveryPrice data-testid={`checkout-delivery-price-${rate.id}`}>{formatPrice(rate.amountCents, currency, language)}</CheckoutDeliveryPrice>
                          {rate.deliveryEstimateDays === undefined ? null : (
                            <FinePrint component="span" variant="caption" color="text.secondary" sx={{ gridArea: 'estimate' }}>
                              <VisuallyHidden>,</VisuallyHidden>{' '}
                              {t.shipping.deliveryEstimate(rate.deliveryEstimateDays)}
                            </FinePrint>
                          )}
                        </CheckoutDeliveryLabel>
                      )}
                    />
                  </CheckoutDeliveryCard>
                ) : (
                  <CheckoutPriceOption variant="outlined" selected={rate.id === state.shippingRateId} sx={{ px: '0.75rem', my: '0.3rem' }} data-testid={`checkout-delivery-option-${rate.id}`}>
                    <FormControlLabel
                      value={rate.id}
                      disabled={disabled}
                      control={<Radio />}
                      data-testid={`checkout-delivery-${rate.id}`}
                      label={(
                        <Stack useFlexGap spacing="0.1rem">
                          <Typography>{`${rate.label} — ${formatPrice(rate.amountCents, currency, language)}`}</Typography>
                          {rate.deliveryEstimateDays === undefined ? null : (
                            <FinePrint component="span" variant="caption">{t.shipping.deliveryEstimate(rate.deliveryEstimateDays)}</FinePrint>
                          )}
                        </Stack>
                      )}
                    />
                  </CheckoutPriceOption>
                )}
                {rate.id === selected?.id ? lockerPicker : null}
              </Fragment>
            ))}
          </RadioGroup>
        )}
        {layout === 'list' && selected === null && rates.length > 0 ? <FormHelperText>{t.shipping.chooseDelivery}</FormHelperText> : null}
      </FormControl>
      {lockerDialog}
    </>
  );
};
