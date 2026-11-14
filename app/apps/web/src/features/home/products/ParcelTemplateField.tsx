import { MenuItem, TextField } from '@mui/material';

import { PARCEL_TEMPLATES, parcelTemplateSchema, type ParcelTemplate } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';

export const ParcelTemplateField = ({ value, onChange }: { value: ParcelTemplate; onChange: (value: ParcelTemplate) => void }) => {
  const t = useTranslations();
  return (
    <TextField
      select
      id="product-parcel-template"
      label={t.shipx.parcelTemplateLabel}
      value={value}
      helperText={t.shipx.parcelTemplateHint}
      onChange={(event) => onChange(parcelTemplateSchema.parse(event.target.value))}
      slotProps={{ htmlInput: { 'data-testid': 'product-parcel-template' } }}
    >
      {PARCEL_TEMPLATES.map((template) => <MenuItem key={template} value={template}>{t.shipx.parcelTemplates[template]}</MenuItem>)}
    </TextField>
  );
};
