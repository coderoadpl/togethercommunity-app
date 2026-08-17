import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button, Stack, TextField, Typography } from '@mui/material';

import { DM_BODY_MAX_LENGTH } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';

export const MessageComposer = ({
  busy,
  disabled = false,
  onSend,
}: {
  busy: boolean;
  disabled?: boolean;
  onSend: (body: string, reset: () => void) => void;
}) => {
  const t = useTranslations();
  const [body, setBody] = useState('');

  const submit = () => {
    const trimmed = body.trim();
    if (trimmed.length === 0 || disabled) return;
    onSend(trimmed, () => setBody(''));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  return (
    <Stack
      component="form"
      useFlexGap
      spacing="0.5rem"
      data-testid="message-composer"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit();
      }}
    >
      <TextField
        label={t.messages.composerLabel}
        placeholder={t.messages.composerPlaceholder}
        multiline
        minRows={2}
        value={body}
        disabled={disabled}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        slotProps={{
          htmlInput: { 'data-testid': 'message-composer-input', maxLength: DM_BODY_MAX_LENGTH },
        }}
      />
      <Stack direction="row" useFlexGap sx={{ columnGap: '0.75rem', alignItems: 'center' }}>
        <Button
          type="submit"
          variant="contained"
          disabled={disabled || busy || body.trim().length === 0}
          data-testid="message-composer-submit"
        >
          {busy ? t.messages.sending : t.messages.send}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {t.messages.composerHint}
        </Typography>
      </Stack>
    </Stack>
  );
};
