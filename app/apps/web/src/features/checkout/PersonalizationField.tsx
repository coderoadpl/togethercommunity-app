import { useState } from 'react';
import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';

import type { CheckoutPersonalizationRequest, PublicProductPersonalization } from '#core/domain/index.js';

import { useTranslations } from '../../i18n/index.js';
import { FinePrint, PreLineText } from '../../theme.js';

export type PersonalizableLine = { productId: string; name: string; personalization: PublicProductPersonalization | null };

export type PersonalizationEntry = { ticked: boolean; text: string; conditionAccepted: boolean };

export type PersonalizationBlockReason = 'text' | 'condition';

const UNTICKED: PersonalizationEntry = { ticked: false, text: '', conditionAccepted: false };

const blockReason = (setting: PublicProductPersonalization, entry: PersonalizationEntry): PersonalizationBlockReason | null => {
  if (!entry.ticked) return null;
  if (entry.text.trim() === '') return 'text';
  return setting.condition !== null && !entry.conditionAccepted ? 'condition' : null;
};

export const personalizationState = (
  lines: readonly PersonalizableLine[],
  entries: Readonly<Record<string, PersonalizationEntry>>,
  update: (productId: string, patch: Partial<PersonalizationEntry>) => void,
) => {
  const rows = lines.flatMap((line) => {
    if (line.personalization === null) return [];
    const entry = entries[line.productId] ?? UNTICKED;
    return [{ productId: line.productId, name: line.name, setting: line.personalization, entry, reason: blockReason(line.personalization, entry) }];
  });
  const personalizations: CheckoutPersonalizationRequest[] = rows.flatMap((row) => row.entry.ticked ? [{
    productId: row.productId,
    text: row.entry.text.trim(),
    conditionAccepted: row.setting.condition !== null && row.entry.conditionAccepted,
  }] : []);
  const request: { personalizations?: CheckoutPersonalizationRequest[] } = personalizations.length === 0 ? {} : { personalizations };
  const reason = rows.find((row) => row.reason !== null)?.reason ?? null;
  return { rows, showLineName: lines.length > 1, blocked: reason !== null, reason, request, update };
};

type PersonalizationState = ReturnType<typeof personalizationState>;

export const usePersonalizations = (lines: readonly PersonalizableLine[]): PersonalizationState => {
  const [entries, setEntries] = useState<Record<string, PersonalizationEntry>>({});
  return personalizationState(lines, entries, (productId, patch) => setEntries((current) => ({
    ...current,
    [productId]: { ...(current[productId] ?? UNTICKED), ...patch },
  })));
};

const PersonalizationRow = ({ row, showLineName, disabled, update }: {
  row: PersonalizationState['rows'][number];
  showLineName: boolean;
  disabled: boolean;
  update: PersonalizationState['update'];
}) => {
  const t = useTranslations();
  const { productId, setting, entry, reason } = row;
  const [blurred, setBlurred] = useState({ text: false, condition: false });
  const textError = reason === 'text' && blurred.text;
  const conditionError = reason === 'condition' && blurred.condition;
  const inputId = `checkout-personalization-${productId}-text`;
  const hintId = `${inputId}-hint`;
  const conditionHintId = `checkout-personalization-${productId}-condition-hint`;
  return (
    <Stack useFlexGap spacing="0.5rem" data-testid={`checkout-personalization-${productId}`}>
      <FormControlLabel
        sx={{ alignItems: 'flex-start' }}
        control={(
          <Checkbox
            checked={entry.ticked}
            disabled={disabled}
            onChange={(event) => {
              setBlurred({ text: false, condition: false });
              update(productId, { ticked: event.target.checked });
            }}
          />
        )}
        label={(
          <Stack useFlexGap spacing="0.2rem" sx={{ pt: '0.5rem', minWidth: 0 }}>
            <Typography sx={{ overflowWrap: 'anywhere' }}>{setting.label}</Typography>
            {showLineName ? <FinePrint component="span" variant="caption">{t.personalization.forLine({ name: row.name })}</FinePrint> : null}
            {setting.description === '' ? null : (
              <PreLineText component="span" variant="caption" color="text.secondary">{setting.description}</PreLineText>
            )}
          </Stack>
        )}
      />
      {entry.ticked ? (
        <Stack useFlexGap spacing="0.5rem" sx={{ pl: { xs: 0, sm: '2rem' } }}>
          <FormControl fullWidth error={textError}>
            <FormLabel htmlFor={inputId}>{setting.inputLabel}</FormLabel>
            <OutlinedInput
              id={inputId}
              multiline
              minRows={2}
              sx={{ p: 0 }}
              value={entry.text}
              disabled={disabled}
              onChange={(event) => update(productId, { text: event.target.value })}
              onBlur={() => setBlurred((current) => ({ ...current, text: true }))}
              inputProps={{ maxLength: setting.maxLength, 'aria-describedby': hintId }}
            />
            <FormHelperText id={hintId} component="div" sx={{ mx: 0 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span>{textError ? t.personalization.textRequired : null}</span>
                <span>{t.personalization.characterCount({ count: entry.text.length, max: setting.maxLength })}</span>
              </Box>
            </FormHelperText>
          </FormControl>
          {setting.condition === null ? null : (
            <FormControl error={conditionError}>
              <FormControlLabel
                sx={{ alignItems: 'flex-start' }}
                control={(
                  <Checkbox
                    checked={entry.conditionAccepted}
                    disabled={disabled}
                    slotProps={{ input: conditionError ? { 'aria-describedby': conditionHintId } : {} }}
                    onChange={(event) => update(productId, { conditionAccepted: event.target.checked })}
                    onBlur={() => setBlurred((current) => ({ ...current, condition: true }))}
                  />
                )}
                label={<PreLineText component="span" sx={{ display: 'block', pt: '0.5rem' }}>{setting.condition}</PreLineText>}
              />
              {conditionError ? <FormHelperText id={conditionHintId} sx={{ mx: 0 }}>{t.personalization.conditionRequired}</FormHelperText> : null}
            </FormControl>
          )}
        </Stack>
      ) : null}
    </Stack>
  );
};

export const PersonalizationField = ({ state, disabled = false }: { state: PersonalizationState; disabled?: boolean }) =>
  state.rows.length === 0 ? null : (
    <Stack useFlexGap spacing="0.75rem" data-testid="checkout-personalization">
      {state.rows.map((row) => (
        <PersonalizationRow key={row.productId} row={row} showLineName={state.showLineName} disabled={disabled} update={state.update} />
      ))}
    </Stack>
  );
