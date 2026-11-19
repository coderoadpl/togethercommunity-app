import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';

import { productPersonalizationSchema, type ProductPersonalization } from '#core/domain/index.js';

import { ChevronDownIcon } from '../../../components/ui/account-icons.js';
import { useTranslations } from '../../../i18n/index.js';

export interface PersonalizationDraft {
  enabled: boolean;
  label: string;
  description: string;
  inputLabel: string;
  maxLength: string;
  conditionRequired: boolean;
  condition: string;
}

export const personalizationDraftFrom = (personalization: ProductPersonalization | null | undefined): PersonalizationDraft => ({
  enabled: personalization != null,
  label: personalization?.label ?? '',
  description: personalization?.description ?? '',
  inputLabel: personalization?.inputLabel ?? '',
  maxLength: String(personalization?.maxLength ?? 200),
  conditionRequired: personalization?.condition != null,
  condition: personalization?.condition ?? '',
});

export const personalizationFromDraft = (draft: PersonalizationDraft): { ok: true; value: ProductPersonalization | null } | { ok: false } => {
  if (!draft.enabled) return { ok: true, value: null };
  if (!/^\d+$/u.test(draft.maxLength.trim())) return { ok: false };
  const parsed = productPersonalizationSchema.safeParse({
    label: draft.label,
    description: draft.description,
    inputLabel: draft.inputLabel,
    maxLength: Number(draft.maxLength.trim()),
    condition: draft.conditionRequired ? draft.condition : null,
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
};

export const ProductPersonalizationFields = ({
  value,
  invalid,
  onChange,
}: {
  value: PersonalizationDraft;
  invalid: boolean;
  onChange: (value: PersonalizationDraft) => void;
}) => {
  const t = useTranslations();
  const [initiallyExpanded] = useState(value.enabled);
  const text = (key: 'label' | 'description' | 'inputLabel' | 'condition', label: string, extra: { helperText?: string; multiline?: boolean; maxLength: number }) => (
    <TextField
      id={`product-personalization-${key}`}
      label={label}
      value={value[key]}
      {...(extra.multiline === true ? { multiline: true, minRows: 2 } : {})}
      helperText={extra.helperText}
      onChange={(event) => onChange({ ...value, [key]: event.target.value })}
      slotProps={{ htmlInput: { maxLength: extra.maxLength } }}
    />
  );
  return (
    <Accordion disableGutters elevation={0} defaultExpanded={initiallyExpanded} data-testid="product-personalization">
      <AccordionSummary expandIcon={<ChevronDownIcon />} sx={{ px: 0 }}>
        <Stack useFlexGap spacing="0.25rem" sx={{ minWidth: 0 }}>
          <Typography component="p" variant="h3">{t.personalization.heading}</Typography>
          <Typography variant="body2" color="text.secondary">{t.personalization.hint}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0 }}>
        <Stack useFlexGap spacing="1rem">
          <FormControlLabel
            label={t.personalization.enable}
            control={<Switch checked={value.enabled} onChange={(_event, enabled) => onChange({ ...value, enabled })} />}
          />
          {value.enabled ? (
            <>
              {text('label', t.personalization.label, { helperText: t.personalization.labelHint, maxLength: 80 })}
              {text('description', t.personalization.description, { helperText: t.personalization.descriptionHint, multiline: true, maxLength: 1000 })}
              {text('inputLabel', t.personalization.inputLabel, { maxLength: 80 })}
              <TextField
                id="product-personalization-maxLength"
                label={t.personalization.maxLength}
                value={value.maxLength}
                type="number"
                helperText={t.personalization.maxLengthHint}
                onChange={(event) => onChange({ ...value, maxLength: event.target.value })}
                slotProps={{ htmlInput: { min: 1, max: 500, step: 1, inputMode: 'numeric' } }}
              />
              <FormControlLabel
                label={t.personalization.requireCondition}
                control={<Switch checked={value.conditionRequired} onChange={(_event, conditionRequired) => onChange({ ...value, conditionRequired })} />}
              />
              {value.conditionRequired ? text('condition', t.personalization.condition, { helperText: t.personalization.conditionHint, multiline: true, maxLength: 1000 }) : null}
            </>
          ) : null}
          {invalid ? <Typography color="error" variant="body2" role="alert">{t.personalization.incomplete}</Typography> : null}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
};
