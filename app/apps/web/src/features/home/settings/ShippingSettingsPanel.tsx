import { useState } from 'react';
import {
  Alert,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  MenuItem,
  OutlinedInput,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { priceMajorSchema, SHIPPING_RATES_MAX, shippingRatesSchema, type ShippingRate } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { useToastOutcome } from '../../../components/ui/Toast.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';

type RateDraft = {
  id: string;
  label: string;
  price: string;
  vatRatePercent: '5' | '8' | '23';
  carrier: ShippingRate['carrier'];
  pickupPoint: ShippingRate['pickupPoint'];
  estimateMin: string;
  estimateMax: string;
  active: boolean;
};

type ShippingDraft = { rates: RateDraft[]; token: string };

const toDraft = (rate: ShippingRate): RateDraft => ({
  id: rate.id,
  label: rate.label,
  price: (rate.amountCents / 100).toFixed(2),
  vatRatePercent: rate.vatRatePercent === 5 ? '5' : rate.vatRatePercent === 8 ? '8' : '23',
  carrier: rate.carrier,
  pickupPoint: rate.pickupPoint,
  estimateMin: rate.deliveryEstimateDays === undefined ? '' : String(rate.deliveryEstimateDays.min),
  estimateMax: rate.deliveryEstimateDays === undefined ? '' : String(rate.deliveryEstimateDays.max),
  active: rate.active,
});

const emptyRate = (index: number): RateDraft => ({
  id: `rate-${index + 1}`, label: '', price: '0.00', vatRatePercent: '23', carrier: 'inpost', pickupPoint: 'inpost_locker',
  estimateMin: '', estimateMax: '', active: true,
});

const parseRates = (rates: RateDraft[]) => shippingRatesSchema.safeParse(rates.map((rate) => {
  const price = priceMajorSchema.safeParse(rate.price);
  return {
    id: rate.id.trim(),
    label: rate.label,
    amountCents: price.success ? price.data : -1,
    vatRatePercent: Number(rate.vatRatePercent),
    carrier: rate.carrier,
    pickupPoint: rate.pickupPoint,
    active: rate.active,
    ...(rate.estimateMin === '' && rate.estimateMax === '' ? {} : {
      deliveryEstimateDays: { min: Number(rate.estimateMin), max: Number(rate.estimateMax) },
    }),
  };
}));

export const ShippingSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [draft, setDraft] = useState<ShippingDraft | null>(null);
  const [invalid, setInvalid] = useState(false);
  const value = draft ?? {
    rates: (settings.data?.settings.shippingRates ?? []).map(toDraft),
    token: settings.data?.settings.inpostGeowidgetToken ?? '',
  };
  const update = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
      await queryClient.invalidateQueries(actions.publicPaymentConfig);
      setDraft(null);
    },
  });
  const unavailable = !settings.isSuccess || update.isPending;
  const disabled = !canEdit || unavailable;
  useToastOutcome(update.isSuccess, t.common.saved, update.error === null ? null : localizePanelError(update.error, t));
  const setRate = (index: number, patch: Partial<RateDraft>) => {
    setInvalid(false);
    setDraft({ ...value, rates: value.rates.map((rate, position) => position === index ? { ...rate, ...patch } : rate) });
  };

  return (
    <SectionCard
      title={t.shipping.settingsHeading}
      description={t.shipping.settingsIntro}
      data-testid="shipping-settings"
      actions={canEdit ? <Button type="submit" variant="contained" disabled={unavailable}>{t.common.save}</Button> : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        const rates = parseRates(value.rates);
        if (!rates.success) {
          setInvalid(true);
          return;
        }
        update.mutate({ shippingRates: rates.data, inpostGeowidgetToken: value.token.trim() === '' ? null : value.token.trim() });
      }}
    >
      {value.rates.length === 0 ? <Typography color="text.secondary">{t.shipping.noRates}</Typography> : (
        <ResponsiveTable data-testid="shipping-rates">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t.shipping.rateId}</TableCell>
                <TableCell>{t.shipping.rateLabel}</TableCell>
                <TableCell>{t.shipping.ratePrice}</TableCell>
                <TableCell>{t.shipping.rateVat}</TableCell>
                <TableCell>{t.shipping.rateCarrier}</TableCell>
                <TableCell>{t.shipping.ratePickupPoint}</TableCell>
                <TableCell>{t.shipping.rateEstimateMin}</TableCell>
                <TableCell>{t.shipping.rateEstimateMax}</TableCell>
                <TableCell>{t.shipping.rateActive}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {value.rates.map((rate, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <TextField size="small" value={rate.id} disabled={disabled} slotProps={{ htmlInput: { 'aria-label': `${t.shipping.rateId} ${index + 1}`, maxLength: 40 } }}
                      onChange={(event) => setRate(index, { id: event.target.value.toLowerCase() })} />
                  </TableCell>
                  <TableCell>
                    <TextField size="small" value={rate.label} disabled={disabled} slotProps={{ htmlInput: { 'aria-label': `${t.shipping.rateLabel} ${index + 1}`, maxLength: 100 } }}
                      onChange={(event) => setRate(index, { label: event.target.value })} />
                  </TableCell>
                  <TableCell>
                    <TextField size="small" value={rate.price} disabled={disabled} slotProps={{ htmlInput: { 'aria-label': `${t.shipping.ratePrice} ${index + 1}`, inputMode: 'decimal' } }}
                      onChange={(event) => setRate(index, { price: event.target.value })} />
                  </TableCell>
                  <TableCell>
                    <TextField select size="small" value={rate.vatRatePercent} disabled={disabled} slotProps={{ htmlInput: { 'aria-label': `${t.shipping.rateVat} ${index + 1}` } }}
                      onChange={(event) => setRate(index, { vatRatePercent: event.target.value === '5' ? '5' : event.target.value === '8' ? '8' : '23' })}>
                      {['5', '8', '23'].map((rateValue) => <MenuItem key={rateValue} value={rateValue}>{rateValue}%</MenuItem>)}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField select size="small" value={rate.carrier} disabled={disabled} slotProps={{ htmlInput: { 'aria-label': `${t.shipping.rateCarrier} ${index + 1}` } }}
                      onChange={(event) => setRate(index, { carrier: event.target.value === 'other' ? 'other' : 'inpost' })}>
                      <MenuItem value="inpost">{t.shipping.carriers.inpost}</MenuItem>
                      <MenuItem value="other">{t.shipping.carriers.other}</MenuItem>
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField select size="small" value={rate.pickupPoint} disabled={disabled} slotProps={{ htmlInput: { 'aria-label': `${t.shipping.ratePickupPoint} ${index + 1}` } }}
                      onChange={(event) => setRate(index, { pickupPoint: event.target.value === 'inpost_locker' ? 'inpost_locker' : 'none' })}>
                      <MenuItem value="none">{t.shipping.pickupPoints.none}</MenuItem>
                      <MenuItem value="inpost_locker">{t.shipping.pickupPoints.inpost_locker}</MenuItem>
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField size="small" value={rate.estimateMin} disabled={disabled} slotProps={{ htmlInput: { 'aria-label': `${t.shipping.rateEstimateMin} ${index + 1}`, inputMode: 'numeric' } }}
                      onChange={(event) => setRate(index, { estimateMin: event.target.value })} />
                  </TableCell>
                  <TableCell>
                    <TextField size="small" value={rate.estimateMax} disabled={disabled} slotProps={{ htmlInput: { 'aria-label': `${t.shipping.rateEstimateMax} ${index + 1}`, inputMode: 'numeric' } }}
                      onChange={(event) => setRate(index, { estimateMax: event.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Switch checked={rate.active} disabled={disabled} slotProps={{ input: { 'aria-label': `${t.shipping.rateActive} ${index + 1}` } }}
                      onChange={(_event, checked) => setRate(index, { active: checked })} />
                  </TableCell>
                  <TableCell>
                    <Button size="small" color="error" disabled={disabled} aria-label={`${t.shipping.removeRate} ${index + 1}`}
                      onClick={() => {
                        setInvalid(false);
                        setDraft({ ...value, rates: value.rates.filter((_rate, position) => position !== index) });
                      }}>
                      {t.common.remove}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ResponsiveTable>
      )}
      {canEdit ? (
        <Stack direction="row" useFlexGap spacing="0.75rem" sx={{ alignItems: 'center' }}>
          <Button variant="outlined" disabled={disabled || value.rates.length >= SHIPPING_RATES_MAX}
            onClick={() => setDraft({ ...value, rates: [...value.rates, emptyRate(value.rates.length)] })}>
            {t.shipping.addRate}
          </Button>
          {value.rates.length >= SHIPPING_RATES_MAX ? <FormHelperText>{t.shipping.maxRates}</FormHelperText> : null}
        </Stack>
      ) : null}
      {invalid ? <Alert severity="error" role="alert">{t.errors.messageValidation}</Alert> : null}
      <FormControl fullWidth>
        <FormLabel htmlFor="shipping-geowidget-token">{t.shipping.geowidgetToken}</FormLabel>
        <OutlinedInput
          id="shipping-geowidget-token"
          value={value.token}
          disabled={disabled}
          inputProps={{ 'aria-describedby': 'shipping-geowidget-token-hint' }}
          onChange={(event) => setDraft({ ...value, token: event.target.value })}
        />
        <FormHelperText id="shipping-geowidget-token-hint">{t.shipping.geowidgetTokenHint}</FormHelperText>
      </FormControl>
      {settings.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} />
      ) : null}
    </SectionCard>
  );
};
