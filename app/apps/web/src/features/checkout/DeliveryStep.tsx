import {
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
import { CheckoutPriceOption, FinePrint } from '../../theme.js';
import { InpostGeowidget } from './InpostGeowidget.js';
import type { CheckoutEvent, CheckoutState, GeowidgetAccess } from './index.web.js';

export const DeliveryStep = ({ rates, state, dispatch, currency, language, geowidget, disabled }: {
  rates: PublicShippingRate[];
  state: CheckoutState;
  dispatch: (event: CheckoutEvent) => void;
  currency: string;
  language: 'pl' | 'en';
  geowidget: GeowidgetAccess;
  disabled: boolean;
}) => {
  const t = useTranslations();
  const selected = rates.find((rate) => rate.id === state.shippingRateId) ?? null;
  const codeInvalid = state.pickupPointCode.trim() !== '' && !pickupPointCodeValid(state.pickupPointCode);
  return (
    <FormControl component="fieldset" data-testid="checkout-delivery">
      <FormLabel component="legend" id="checkout-delivery-label">{t.shipping.deliveryHeading}</FormLabel>
      {rates.length === 0 ? (
        <Typography role="alert" color="error">{t.shipping.noDeliveryOptions}</Typography>
      ) : (
        <RadioGroup
          aria-labelledby="checkout-delivery-label"
          value={state.shippingRateId ?? ''}
          onChange={(event) => dispatch({ type: 'shippingRateSelected', rateId: event.target.value })}
        >
          {rates.map((rate) => (
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
      {selected !== null && selected.pickupPoint === 'inpost_locker' ? (
        <Stack useFlexGap spacing="0.75rem" sx={{ mt: '0.5rem' }}>
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
            />
            <FormHelperText id="checkout-pickup-point-hint">{codeInvalid ? t.shipping.lockerCodeInvalid : t.shipping.lockerCodeHint}</FormHelperText>
          </FormControl>
          {state.pickupPoint === null ? null : (
            <Typography variant="body2" data-testid="checkout-pickup-point-selected">
              {[`${t.shipping.lockerSelected}: ${state.pickupPoint.code}`, state.pickupPoint.name, state.pickupPoint.address].filter((value) => value !== null).join(' · ')}
            </Typography>
          )}
        </Stack>
      ) : null}
      {selected === null && rates.length > 0 ? <FormHelperText>{t.shipping.chooseDelivery}</FormHelperText> : null}
    </FormControl>
  );
};
