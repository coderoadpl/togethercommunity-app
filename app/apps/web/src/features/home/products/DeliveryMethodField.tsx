import { MenuItem, TextField } from '@mui/material';

import { DELIVERY_METHODS, deliveryMethodSchema, type DeliveryMethod } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';

export const DeliveryMethodField = ({ value, onChange }: { value: DeliveryMethod; onChange: (value: DeliveryMethod) => void }) => {
  const t = useTranslations();
  return (
    <TextField
      select
      id="product-delivery-method"
      label={t.shipping.deliveryMethodLabel}
      value={value}
      helperText={t.shipping.deliveryMethodHint}
      onChange={(event) => onChange(deliveryMethodSchema.parse(event.target.value))}
    >
      {DELIVERY_METHODS.map((method) => <MenuItem key={method} value={method}>{t.shipping.deliveryMethods[method]}</MenuItem>)}
    </TextField>
  );
};
