import { Fragment, useState } from 'react';
import {
  Box,
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

import { useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CheckoutDeliveryCard, CheckoutDeliveryLabel, CheckoutDeliveryPrice, CheckoutPriceOption, FinePrint, VisuallyHidden } from '../../theme.js';
import { rowAction } from './checkout-keys.js';
import { InpostGeowidget } from './InpostGeowidget.js';
import type { CheckoutEvent, CheckoutState, GeowidgetAccess } from './index.web.js';

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
  const selected = rates.find((rate) => rate.id === state.shippingRateId) ?? null;
  const [codeBlurred, setCodeBlurred] = useState(false);
  const codeInvalid = codeBlurred && state.pickupPointCode.trim() !== '' && !pickupPointCodeValid(state.pickupPointCode);
  const lockerHint = layout === 'list' || geowidget.status === 'map' ? t.shipping.lockerCodeMapHint : t.shipping.lockerCodeHint;
  const lockerPicker = selected !== null && selected.pickupPoint === 'inpost_locker' ? (
    <Box sx={layout === 'cards' ? { pt: '0.25rem', pb: '0.5rem' } : { mt: '0.5rem' }} data-testid="checkout-locker-picker" {...rowAction('pick')}>
      <Typography role="status" variant="body2" sx={{ mb: state.pickupPoint === null ? 0 : '0.75rem' }}>
        {state.pickupPoint === null ? null : (
          <span data-testid="checkout-pickup-point-selected">
            {[`${t.shipping.lockerSelected}: ${state.pickupPoint.code}`, state.pickupPoint.name, state.pickupPoint.address].filter((value) => value !== null).join(' · ')}
          </span>
        )}
      </Typography>
      <Stack useFlexGap spacing="0.75rem">
        {geowidget.status === 'map' ? <InpostGeowidget token={geowidget.token} language={language} dispatch={dispatch} /> : null}
        {geowidget.status === 'withheld_for_staff' ? (
          <Typography variant="body2" color="text.secondary" data-testid="checkout-locker-map-staff-hint">{t.shipping.lockerMapStaffHint}</Typography>
        ) : null}
        <FormControl fullWidth error={codeInvalid}>
          <FormLabel htmlFor="checkout-pickup-point">{t.shipping.lockerCodeLabel}</FormLabel>
          <OutlinedInput
            id="checkout-pickup-point"
            value={state.pickupPointCode}
            disabled={disabled}
            required
            inputProps={{ maxLength: 12, autoCapitalize: 'characters', 'aria-describedby': 'checkout-pickup-point-hint', 'data-testid': 'checkout-pickup-point' }}
            onChange={(event) => dispatch({ type: 'pickupPointCodeChanged', code: event.target.value })}
            onBlur={() => setCodeBlurred(true)}
          />
          <FormHelperText id="checkout-pickup-point-hint" sx={{ mx: 0 }}>{codeInvalid ? t.shipping.lockerCodeInvalid : lockerHint}</FormHelperText>
        </FormControl>
      </Stack>
    </Box>
  ) : null;
  return (
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
          {rates.map((rate) => layout === 'cards' ? (
            <Fragment key={rate.id}>
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
              {rate.id === selected?.id ? lockerPicker : null}
            </Fragment>
          ) : (
            <CheckoutPriceOption key={rate.id} variant="outlined" selected={rate.id === state.shippingRateId} sx={{ px: '0.75rem', my: '0.3rem' }}>
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
          ))}
        </RadioGroup>
      )}
      {layout === 'list' ? lockerPicker : null}
      {layout === 'list' && selected === null && rates.length > 0 ? <FormHelperText>{t.shipping.chooseDelivery}</FormHelperText> : null}
    </FormControl>
  );
};
