import { Fragment, useId, useReducer, useRef, useState } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  InputAdornment,
  OutlinedInput,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';

import { normalizeLockerPhone, pickupPointCodeValid, rateNeedsPolishMobile, type PublicShippingRate } from '#core/domain/index.js';

import { CheckIcon, ChevronDownIcon, CircleAlertIcon, MapPinIcon } from '../../components/ui/account-icons.js';
import { useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CheckoutDeliveryCard, CheckoutDeliveryLabel, CheckoutDeliveryPrice, CheckoutInlineToggle, CheckoutLockerChosen, CheckoutLockerChosenCaption, CheckoutLockerName, CheckoutLockerRejection, CheckoutPriceOption, FinePrint, VisuallyHidden } from '../../theme.js';
import { rowAction } from './checkout-keys.js';
import { LockerPicker, pointSummary } from './LockerPicker.js';
import { useHistoryEntry } from './use-history-entry.js';
import type { CheckLocker } from './use-locker-check.js';
import {
  acceptsPoint,
  closedLockerPicker,
  lockerEntry,
  lockerRejection,
  pickedPickupPoint,
  reduceLockerPicker,
  typedLockerCheck,
  type CheckoutEvent,
  type CheckoutState,
  type GeowidgetAccess,
  type PickedPickupPoint,
} from './index.web.js';

export const DeliveryStep = ({ rates, state, dispatch, checkLocker, currency, language, geowidget, disabled, layout = 'list' }: {
  rates: PublicShippingRate[];
  state: CheckoutState;
  dispatch: (event: CheckoutEvent) => void;
  checkLocker: CheckLocker;
  currency: string;
  language: 'pl' | 'en';
  geowidget: GeowidgetAccess;
  disabled: boolean;
  layout?: 'list' | 'cards';
}) => {
  const t = useTranslations();
  const lockerId = useId();
  const phoneId = useId();
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phoneInvalid = state.lockerPhoneValidationFailed || (phoneTouched && normalizeLockerPhone(state.lockerPhone) === null);
  const selected = rates.find((rate) => rate.id === state.shippingRateId) ?? null;
  const usesLocker = selected?.pickupPoint === 'inpost_locker';
  const [codeBlurred, setCodeBlurred] = useState(false);
  const codeInvalid = codeBlurred && state.pickupPointCode.trim() !== '' && !pickupPointCodeValid(state.pickupPointCode);
  const check = typedLockerCheck(state);
  const codeRejected = !codeInvalid && check?.status === 'rejected';
  const picked = pickedPickupPoint(state);
  const pickedRejection = picked === null ? null : lockerRejection(state);
  const [picker, sendPicker] = useReducer(reduceLockerPicker, closedLockerPicker);
  const [codeShown, setCodeShown] = useState(() => state.pickupPointCode !== '' && picked === null);
  const entry = lockerEntry(geowidget, picker);
  const rejectedCheck = check?.status === 'rejected' ? check : null;
  const [seenRejection, setSeenRejection] = useState(rejectedCheck);
  const [openedBy, setOpenedBy] = useState<typeof rejectedCheck>(null);
  if (rejectedCheck !== seenRejection) {
    setSeenRejection(rejectedCheck);
    if (rejectedCheck !== null && entry.kind === 'map' && !codeShown) {
      setCodeShown(true);
      setOpenedBy(rejectedCheck);
    }
  }
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
  const toggleCode = () => {
    setOpenedBy(null);
    setCodeShown((shown) => !shown);
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
  const checkLine = codeInvalid || check === null || check.status === 'unavailable' ? null
    : check.status === 'checking' ? <Typography variant="body2" color="text.secondary">{t.shipping.lockerChecking}</Typography>
      : check.status === 'rejected' ? <CheckoutLockerRejection variant="body2" role={check === openedBy ? 'alert' : undefined}><CircleAlertIcon />{t.shipping.lockerRejected[check.reason]}</CheckoutLockerRejection>
        : (
          <>
            <CheckoutLockerChosenCaption variant="caption" color="text.secondary"><CheckIcon />{t.shipping.lockerCheckFound}</CheckoutLockerChosenCaption>
            <CheckoutLockerName variant="body2">{pointSummary(check)}</CheckoutLockerName>
            {check.address === null ? null : <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{check.address}</Typography>}
          </>
        );
  const codeField = (
    <FormControl fullWidth error={codeInvalid || codeRejected}>
      <FormLabel htmlFor="checkout-pickup-point">{t.shipping.lockerCodeLabel}</FormLabel>
      <OutlinedInput
        id="checkout-pickup-point"
        inputRef={codeInput}
        value={state.pickupPointCode}
        disabled={disabled}
        required
        inputProps={{ maxLength: 12, autoCapitalize: 'characters', 'aria-describedby': checkLine === null ? 'checkout-pickup-point-hint' : 'checkout-pickup-point-check', 'data-testid': 'checkout-pickup-point' }}
        onChange={(event) => dispatch({ type: 'pickupPointCodeChanged', code: event.target.value })}
        onBlur={() => {
          setCodeBlurred(true);
          void checkLocker();
        }}
      />
      {checkLine === null ? (
        <FormHelperText id="checkout-pickup-point-hint" error={codeInvalid} sx={{ mx: 0 }}>{codeInvalid ? t.shipping.lockerCodeInvalid : t.shipping.lockerCodeHint}</FormHelperText>
      ) : null}
      <Box id="checkout-pickup-point-check" role="status" aria-live="polite" data-testid="checkout-pickup-point-check" sx={{ minWidth: 0, mt: checkLine === null ? 0 : '3px' }}>{checkLine}</Box>
    </FormControl>
  );
  const phoneField = selected !== null && rateNeedsPolishMobile(selected) ? (
    <FormControl fullWidth error={phoneInvalid} sx={{ mt: '0.75rem' }}>
      <FormLabel htmlFor={phoneId}>{usesLocker ? t.shipping.lockerPhoneLabel : t.shipping.courierPhoneLabel}</FormLabel>
      <OutlinedInput
        id={phoneId}
        type="tel"
        autoComplete="tel-national"
        value={state.lockerPhone}
        disabled={disabled}
        required
        startAdornment={<InputAdornment position="start">+48</InputAdornment>}
        inputProps={{ maxLength: 40, inputMode: 'tel', 'aria-describedby': `${phoneId}-hint` + (phoneInvalid ? ` ${phoneId}-error` : ''), 'data-testid': 'checkout-locker-phone' }}
        onChange={(event) => dispatch({ type: 'lockerPhoneChanged', phone: event.target.value })}
        onInput={() => setPhoneTouched(true)}
        onBlur={() => setPhoneTouched(true)}
      />
      <FormHelperText id={`${phoneId}-hint`} error={false} sx={{ mx: 0 }}>{usesLocker ? t.shipping.lockerPhoneHint : t.shipping.courierPhoneHint}</FormHelperText>
      {phoneInvalid ? <FormHelperText id={`${phoneId}-error`} role="alert" sx={{ mx: 0 }}>{usesLocker ? t.shipping.lockerPhoneInvalid : t.shipping.inpostPhoneInvalid}</FormHelperText> : null}
    </FormControl>
  ) : null;
  const lockerChoice = picked === null ? (
    <Button ref={opener} variant="contained" size="large" fullWidth disabled={disabled} onClick={openPicker} startIcon={<MapPinIcon />} data-testid="checkout-locker-choose" sx={{ minHeight: '2.75rem' }}>
      {t.shipping.lockerChoose}
    </Button>
  ) : (
    <CheckoutLockerChosen rejected={pickedRejection !== null}>
      <Box id={`${lockerId}-picked`} data-testid="checkout-pickup-point-selected" sx={{ minWidth: 0 }}>
        <CheckoutLockerChosenCaption variant="caption" color="text.secondary">{pickedRejection === null ? <CheckIcon /> : null}{t.shipping.lockerSelected}</CheckoutLockerChosenCaption>
        <CheckoutLockerName variant="body2">{pointSummary(picked)}</CheckoutLockerName>
        {picked.address === null ? null : <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{picked.address}</Typography>}
        {pickedRejection === null ? null : (
          <CheckoutLockerRejection variant="body2" role="alert" data-testid="checkout-pickup-point-selected-rejected"><CircleAlertIcon />{t.shipping.lockerRejected[pickedRejection.reason]}</CheckoutLockerRejection>
        )}
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
  const lockerPicker = usesLocker ? (
    <Box sx={layout === 'cards' ? { pt: '0.25rem', pb: entry.kind === 'map' && !codeShown ? 0 : '0.5rem' } : { mt: '0.2rem', mb: '0.5rem' }} data-testid="checkout-locker-picker" {...rowAction('pick')}>
      {entry.kind === 'map' ? (
        <Stack useFlexGap spacing="0.25rem" sx={{ alignItems: 'flex-start' }}>
          {lockerChoice}
          <CheckoutInlineToggle type="button" aria-expanded={codeShown} aria-controls={`${lockerId}-code`} onClick={toggleCode} data-testid="checkout-locker-know-code">
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
      {phoneField}
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
                {rate.id === selected?.id ? (lockerPicker ?? phoneField) : null}
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
