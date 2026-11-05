import { FormControl, FormControlLabel, FormHelperText, FormLabel, OutlinedInput, Stack, Switch, Typography } from '@mui/material';
import { metaCapiCopy } from '#core/domain/index.js';
import { useTranslations } from '../../../i18n/index.js';

export type MetaCapiDraft = {
  analyticsMetaCapiEnabled: boolean;
  analyticsMetaCapiTestEventCode: string;
  analyticsMetaCapiConsentHeading: string;
  analyticsMetaCapiConsentBody: string;
  analyticsMetaCapiConsentAcceptLabel: string;
  analyticsMetaCapiConsentDeclineLabel: string;
};

export const MetaCapiSettingsFields = ({ value, disabled, onChange }: {
  value: MetaCapiDraft;
  disabled: boolean;
  onChange: (value: MetaCapiDraft) => void;
}) => {
  const t = useTranslations();
  const defaults = metaCapiCopy({});
  const fields = [
    { key: 'analyticsMetaCapiTestEventCode', label: t.metaCapi.testCode, maxLength: 100, placeholder: '' },
    { key: 'analyticsMetaCapiConsentHeading', label: t.metaCapi.copyHeading, maxLength: 200, placeholder: defaults.heading },
    { key: 'analyticsMetaCapiConsentBody', label: t.metaCapi.copyBody, maxLength: 4000, placeholder: defaults.body },
    { key: 'analyticsMetaCapiConsentAcceptLabel', label: t.metaCapi.copyAccept, maxLength: 80, placeholder: defaults.acceptLabel },
    { key: 'analyticsMetaCapiConsentDeclineLabel', label: t.metaCapi.copyDecline, maxLength: 80, placeholder: defaults.declineLabel },
  ] as const;
  return (
    <Stack spacing={2}>
      <Typography variant="h3">{t.metaCapi.settingsHeading}</Typography>
      <FormControl>
        <FormControlLabel label={t.metaCapi.enabled} control={<Switch checked={value.analyticsMetaCapiEnabled} disabled={disabled} onChange={(_, checked) => onChange({ ...value, analyticsMetaCapiEnabled: checked })} slotProps={{ input: { 'aria-describedby': 'meta-capi-help' } }} />} />
        <FormHelperText id="meta-capi-help">{t.metaCapi.settingsHelp}</FormHelperText>
      </FormControl>
      <Typography variant="body2" id="meta-capi-copy-help" color="text.secondary">{t.metaCapi.copyHelp}</Typography>
      {fields.map((field) => (
        <FormControl fullWidth key={field.key}>
          <FormLabel htmlFor={field.key}>{field.label}</FormLabel>
          <OutlinedInput
            id={field.key}
            value={value[field.key]}
            disabled={disabled}
            multiline={field.key === 'analyticsMetaCapiConsentBody'}
            minRows={field.key === 'analyticsMetaCapiConsentBody' ? 4 : undefined}
            placeholder={field.placeholder}
            inputProps={{ maxLength: field.maxLength, 'aria-describedby': 'meta-capi-copy-help' }}
            onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
          />
        </FormControl>
      ))}
    </Stack>
  );
};
