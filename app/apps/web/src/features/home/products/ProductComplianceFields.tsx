import { Accordion, AccordionDetails, AccordionSummary, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';

import {
  PRODUCT_SAFETY_WARNINGS_MAX_LENGTH,
  VARIANT_FIELD_MAX_LENGTH,
  productComplianceSchema,
  type ProductCompliance,
} from '#core/domain/index.js';

import { ChevronDownIcon } from '../../../components/ui/account-icons.js';
import { useTranslations } from '../../../i18n/index.js';

export interface ComplianceDraft {
  manufacturerName: string;
  manufacturerAddress: string;
  manufacturerEmail: string;
  manufacturerOutsideEu: boolean;
  responsiblePersonName: string;
  responsiblePersonAddress: string;
  responsiblePersonEmail: string;
  modelIdentifier: string;
  batchIdentifier: string;
  safetyWarnings: string;
  instructionsUrl: string;
}

export const complianceDraftFrom = (compliance: ProductCompliance | null | undefined): ComplianceDraft => ({
  manufacturerName: compliance?.manufacturerName ?? '',
  manufacturerAddress: compliance?.manufacturerAddress ?? '',
  manufacturerEmail: compliance?.manufacturerEmail ?? '',
  manufacturerOutsideEu: compliance?.manufacturerOutsideEu ?? false,
  responsiblePersonName: compliance?.responsiblePersonName ?? '',
  responsiblePersonAddress: compliance?.responsiblePersonAddress ?? '',
  responsiblePersonEmail: compliance?.responsiblePersonEmail ?? '',
  modelIdentifier: compliance?.modelIdentifier ?? '',
  batchIdentifier: compliance?.batchIdentifier ?? '',
  safetyWarnings: compliance?.safetyWarnings ?? '',
  instructionsUrl: compliance?.instructionsUrl ?? '',
});

export const complianceFromDraft = (draft: ComplianceDraft): { ok: true; value: ProductCompliance | null } | { ok: false } => {
  const { manufacturerOutsideEu, ...texts } = draft;
  if (!manufacturerOutsideEu && Object.values(texts).every((value) => value.trim() === '')) return { ok: true, value: null };
  const parsed = productComplianceSchema.safeParse({
    manufacturerName: draft.manufacturerName,
    manufacturerAddress: draft.manufacturerAddress,
    manufacturerEmail: draft.manufacturerEmail,
    manufacturerOutsideEu,
    ...(manufacturerOutsideEu ? {
      responsiblePersonName: draft.responsiblePersonName.trim() === '' ? null : draft.responsiblePersonName,
      responsiblePersonAddress: draft.responsiblePersonAddress.trim() === '' ? null : draft.responsiblePersonAddress,
      responsiblePersonEmail: draft.responsiblePersonEmail.trim() === '' ? null : draft.responsiblePersonEmail,
    } : {}),
    modelIdentifier: draft.modelIdentifier,
    batchIdentifier: draft.batchIdentifier.trim() === '' ? null : draft.batchIdentifier,
    safetyWarnings: draft.safetyWarnings,
    instructionsUrl: draft.instructionsUrl.trim() === '' ? null : draft.instructionsUrl,
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
};

export const ProductComplianceFields = ({
  value,
  invalid,
  onChange,
}: {
  value: ComplianceDraft;
  invalid: boolean;
  onChange: (value: ComplianceDraft) => void;
}) => {
  const t = useTranslations();
  const responsiblePersonMissing = value.manufacturerOutsideEu
    && [value.responsiblePersonName, value.responsiblePersonAddress, value.responsiblePersonEmail].some((text) => text.trim() === '');
  const field = (key: Exclude<keyof ComplianceDraft, 'manufacturerOutsideEu'>, label: string, extra: { type?: string; helperText?: string; multiline?: boolean; maxLength: number }) => (
    <TextField
      id={`product-compliance-${key}`}
      label={label}
      value={value[key]}
      type={extra.type ?? 'text'}
      {...(extra.multiline === true ? { multiline: true, minRows: 3 } : {})}
      helperText={extra.helperText}
      onChange={(event) => onChange({ ...value, [key]: event.target.value })}
      slotProps={{ htmlInput: { maxLength: extra.maxLength } }}
    />
  );
  return (
    <Accordion disableGutters elevation={0} defaultExpanded={value.manufacturerName !== ''} data-testid="product-compliance">
      <AccordionSummary expandIcon={<ChevronDownIcon />} sx={{ px: 0 }}>
        <Stack useFlexGap spacing="0.25rem" sx={{ minWidth: 0 }}>
          <Typography component="p" variant="h3">{t.productSafety.heading}</Typography>
          <Typography variant="body2" color="text.secondary">{t.productSafety.hint}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0 }}>
        <Stack useFlexGap spacing="1rem">
          {field('manufacturerName', t.productSafety.manufacturerName, { maxLength: 200 })}
          {field('manufacturerAddress', t.productSafety.manufacturerAddress, { maxLength: 300 })}
          {field('manufacturerEmail', t.productSafety.manufacturerEmail, { type: 'email', maxLength: 254 })}
          <Stack useFlexGap spacing="0.25rem">
            <FormControlLabel
              label={t.productSafety.manufacturerOutsideEu}
              control={<Switch checked={value.manufacturerOutsideEu} onChange={(_event, manufacturerOutsideEu) => onChange({ ...value, manufacturerOutsideEu })} />}
            />
            <Typography variant="body2" color="text.secondary">{t.productSafety.manufacturerOutsideEuHint}</Typography>
          </Stack>
          {value.manufacturerOutsideEu ? (
            <>
              {field('responsiblePersonName', t.productSafety.responsiblePersonName, { maxLength: 200 })}
              {field('responsiblePersonAddress', t.productSafety.responsiblePersonAddress, { maxLength: 300 })}
              {field('responsiblePersonEmail', t.productSafety.responsiblePersonEmail, { type: 'email', maxLength: 254 })}
            </>
          ) : null}
          {field('modelIdentifier', t.productSafety.modelIdentifier, { maxLength: 100 })}
          {field('batchIdentifier', t.productSafety.batchIdentifier, { maxLength: 100 })}
          {field('safetyWarnings', t.productSafety.safetyWarnings, { multiline: true, helperText: t.productSafety.safetyWarningsHint, maxLength: PRODUCT_SAFETY_WARNINGS_MAX_LENGTH })}
          {field('instructionsUrl', t.productSafety.instructionsUrl, { type: 'url', maxLength: 2000 })}
          {invalid ? (
            <Typography color="error" variant="body2" role="alert">
              {responsiblePersonMissing ? t.productSafety.responsiblePersonIncomplete : t.productSafety.incomplete}
            </Typography>
          ) : null}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
};

export const ProductVariantFields = ({
  group,
  label,
  onChange,
}: {
  group: string;
  label: string;
  onChange: (value: { group: string; label: string }) => void;
}) => {
  const t = useTranslations();
  return (
    <Stack useFlexGap spacing="1rem" data-testid="product-variants">
      <Stack useFlexGap spacing="0.25rem">
        <Typography component="p" variant="h3">{t.productVariants.heading}</Typography>
        <Typography variant="body2" color="text.secondary">{t.productVariants.hint}</Typography>
      </Stack>
      <TextField
        id="product-variant-group"
        label={t.productVariants.group}
        value={group}
        helperText={t.productVariants.groupHint}
        onChange={(event) => onChange({ group: event.target.value, label })}
        slotProps={{ htmlInput: { maxLength: VARIANT_FIELD_MAX_LENGTH } }}
      />
      <TextField
        id="product-variant-label"
        label={t.productVariants.label}
        value={label}
        helperText={t.productVariants.labelHint}
        onChange={(event) => onChange({ group, label: event.target.value })}
        slotProps={{ htmlInput: { maxLength: VARIANT_FIELD_MAX_LENGTH } }}
      />
    </Stack>
  );
};
