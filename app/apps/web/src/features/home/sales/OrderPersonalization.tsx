import { Alert, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { SALES_LINK_TIME_ZONE, type OrderLinePersonalization } from '#core/domain/index.js';

import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { PreLineText } from '../../../theme.js';

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing={{ xs: '0.1rem', sm: '0.5rem' }} sx={{ justifyContent: 'space-between' }}>
    <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>{label}</Typography>
    <PreLineText variant="body2" component="div">{children}</PreLineText>
  </Stack>
);

export const OrderPersonalization = ({ personalization, testId, canCorrect, pending, error, onCorrect }: {
  personalization: OrderLinePersonalization;
  testId: string;
  canCorrect: boolean;
  pending: boolean;
  error: string | null;
  onCorrect: (text: string, done: () => void) => void;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [draft, setDraft] = useState<string | null>(null);
  const at = (value: string) => formatDateTime(value, language, SALES_LINK_TIME_ZONE);
  const trimmed = draft?.trim() ?? '';
  return (
    <Paper variant="outlined" sx={{ p: '0.75rem' }} data-testid={testId}>
      <Stack useFlexGap spacing="0.5rem">
        <Stack useFlexGap spacing="0.1rem">
          <Typography component="p" variant="overline" color="text.secondary">{t.personalization.heading}</Typography>
          <Typography component="p" variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{personalization.label}</Typography>
        </Stack>
        <PreLineText variant="subtitle1" component="p" data-testid={`${testId}-text`}>{personalization.text}</PreLineText>
        {personalization.originalText === undefined ? null : <Row label={t.personalization.originalText}>{personalization.originalText}</Row>}
        {personalization.editedAt === undefined ? null : <Row label={t.personalization.correctedAt}>{at(personalization.editedAt)}</Row>}
        {personalization.editedBy === undefined ? null : <Row label={t.personalization.correctedBy}>{personalization.editedBy}</Row>}
        {personalization.condition === null ? null : (
          <>
            <Row label={t.personalization.acceptedCondition}>{personalization.condition}</Row>
            <Row label={t.personalization.acceptedAt}>{personalization.conditionAcceptedAt === null ? '—' : at(personalization.conditionAcceptedAt)}</Row>
          </>
        )}
        {!canCorrect ? null : draft === null ? (
          <Stack direction="row">
            <Button size="small" onClick={() => setDraft(personalization.text)}>{t.personalization.correct}</Button>
          </Stack>
        ) : (
          <Stack useFlexGap spacing="0.5rem">
            <TextField
              id={`${testId}-input`}
              label={personalization.inputLabel}
              value={draft}
              multiline
              minRows={2}
              disabled={pending}
              onChange={(event) => setDraft(event.target.value)}
              helperText={t.personalization.characterCount({ count: draft.length, max: personalization.maxLength })}
              slotProps={{ htmlInput: { maxLength: personalization.maxLength } }}
            />
            <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                size="small"
                disabled={pending || trimmed === '' || trimmed === personalization.text}
                onClick={() => onCorrect(trimmed, () => setDraft(null))}
              >
                {pending ? t.personalization.savingCorrection : t.personalization.saveCorrection}
              </Button>
              <Button size="small" disabled={pending} onClick={() => setDraft(null)}>{t.common.cancel}</Button>
            </Stack>
          </Stack>
        )}
        {error === null ? null : <Alert severity="error">{error}</Alert>}
      </Stack>
    </Paper>
  );
};
