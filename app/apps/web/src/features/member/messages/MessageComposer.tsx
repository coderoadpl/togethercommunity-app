import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button, Stack, Typography } from '@mui/material';

import { DM_BODY_MAX_LENGTH } from '#core/domain/index.js';

import { MarkdownEditor, type MarkdownEditorHandle } from '../../../components/ui/MarkdownEditor.js';
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
  const inputRef = useRef<MarkdownEditorHandle | null>(null);
  const nearLimit = body.length >= DM_BODY_MAX_LENGTH * 0.9;

  const submit = () => {
    const trimmed = body.trim();
    if (trimmed.length === 0 || disabled) return;
    onSend(trimmed, () => {
      setBody('');
      inputRef.current?.clear();
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
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
      <MarkdownEditor
        ref={inputRef}
        aria-label={t.messages.composerLabel}
        placeholder={t.messages.composerPlaceholder}
        variant="compact"
        minRows={2}
        maxLength={DM_BODY_MAX_LENGTH}
        value={body}
        disabled={disabled}
        onChange={setBody}
        onKeyDown={handleKeyDown}
        inputTestId="message-composer-input"
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
        <Typography
          variant="caption"
          color="text.secondary"
          role="status"
          aria-live={nearLimit ? 'polite' : 'off'}
          aria-label={t.markdownEditor.characterCount({ used: body.length, limit: DM_BODY_MAX_LENGTH })}
          data-testid="message-composer-counter"
          sx={{ ml: 'auto' }}
        >
          {body.length} / {DM_BODY_MAX_LENGTH}
        </Typography>
      </Stack>
    </Stack>
  );
};
