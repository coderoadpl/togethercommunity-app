import { useId, useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';
import { lessonEditionNumberSchema } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { Eyebrow } from '../../../theme.js';

export const LessonEditionEditor = ({
  lessonId,
  versionId,
  edition,
  disabled = false,
}: {
  lessonId: string;
  versionId?: string;
  edition: { number: string; note: string | null } | null;
  disabled?: boolean;
}) => {
  const t = useTranslations();
  const id = useId();
  const queryClient = useQueryClient();
  const [number, setNumber] = useState(edition?.number ?? '');
  const [note, setNote] = useState(edition?.note ?? '');
  const invalidate = async () => {
    await queryClient.invalidateQueries(actions.contentHistoryInvalidates());
  };
  const mark = useMutation({ ...actions.markLessonEdition, onSuccess: invalidate });
  const unmark = useMutation({ ...actions.unmarkLessonEdition, onSuccess: invalidate });
  const pending = mark.isPending || unmark.isPending;
  const validNumber = lessonEditionNumberSchema.safeParse(number).success;
  const error = mark.error ?? unmark.error;
  const errorMessage = mark.error instanceof ApiError && mark.error.appError.code === 'conflict'
    ? t.courses.editionNumberConflict : localizePanelError(error, t);

  return (
    <Stack spacing={1.5} data-testid="lesson-edition-editor">
      <Eyebrow component="h4">{t.courses.editionHeading}</Eyebrow>
      {versionId === undefined ? <Typography variant="caption">{t.courses.editionCurrentHint}</Typography> : null}
      <TextField
        id={`${id}-number`}
        label={t.courses.editionNumber}
        value={number}
        size="small"
        disabled={disabled || pending}
        helperText={t.courses.editionNumberHint}
        slotProps={{ htmlInput: { maxLength: 12 } }}
        onChange={(event) => setNumber(event.target.value)}
      />
      <TextField
        id={`${id}-note`}
        label={t.courses.editionNote}
        value={note}
        size="small"
        multiline
        maxRows={3}
        disabled={disabled || pending}
        slotProps={{ htmlInput: { maxLength: 200 } }}
        onChange={(event) => setNote(event.target.value)}
      />
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          disabled={disabled || pending || !validNumber || note.length > 200}
          onClick={() => mark.mutate({ lessonId, ...(versionId === undefined ? {} : { versionId }), edition: { number, ...(note === '' ? {} : { note }) } })}
        >
          {edition === null ? t.courses.editionMark : t.courses.editionUpdate}
        </Button>
        {edition === null ? null : (
          <Button disabled={disabled || pending} onClick={() => unmark.mutate({ lessonId, number: edition.number })}>
            {t.courses.editionUnmark}
          </Button>
        )}
      </Stack>
      {error === null ? null : <Alert severity="error">{errorMessage}</Alert>}
      {mark.isSuccess ? <Alert severity="success">{t.courses.editionSaved}</Alert> : null}
      {unmark.isSuccess ? <Alert severity="success">{t.courses.editionRemoved}</Alert> : null}
    </Stack>
  );
};
