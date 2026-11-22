import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material';

import { actions } from '../../api.js';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { LessonEditionRows, LessonEditionTrigger, LessonEditionWarning } from '../../theme.js';
import { CheckIcon, ChevronDownIcon, CloseIcon } from './shell/shell-icons.js';

interface ReaderEdition {
  number: string;
  note: string | null;
  markedAt: string;
}

interface ReaderEditions {
  editions: readonly ReaderEdition[];
  currentEdition: string | null;
}

const useEditionDate = () => {
  const { language } = useLanguage();
  return (markedAt: string) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(markedAt));
};

const useLessonEditions = (lessonId: string, enabled: boolean) =>
  useQuery({ ...actions.studentLessonEditions(lessonId), enabled });

const liveOnScreen = (currentEdition: string | null, viewing: string | undefined) =>
  viewing === undefined || viewing === currentEdition;

export const LessonEditionBadge = ({ number }: { number: string }) => {
  const t = useTranslations();
  return <Chip size="small" variant="outlined" label={t.lesson.editionLabel({ number })} data-testid="lesson-edition-badge" />;
};

const EditionRow = ({ label, edition, currentMark, onScreen, onClick }: {
  label: string;
  edition: ReaderEdition | undefined;
  currentMark: boolean;
  onScreen: boolean;
  onClick: () => void;
}) => {
  const t = useTranslations();
  const formatDate = useEditionDate();
  return (
    <ListItem disablePadding>
      <ListItemButton selected={onScreen} aria-current={onScreen ? 'page' : undefined} onClick={onClick}>
        <ListItemText
          primary={(
            <Box component="span" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              {label}
              {currentMark ? <Chip size="small" color="primary" variant="outlined" label={t.lesson.editionCurrentMark} /> : null}
            </Box>
          )}
          secondary={edition === undefined ? null : (
            <>
              <Typography component="span" variant="body2" sx={{ display: 'block' }}>{formatDate(edition.markedAt)}</Typography>
              {edition.note === null ? null : <Typography component="span" variant="body2" sx={{ display: 'block' }}>{edition.note}</Typography>}
            </>
          )}
        />
        {onScreen ? <CheckIcon /> : null}
      </ListItemButton>
    </ListItem>
  );
};

export const LessonEditionsList = ({ editions, currentEdition, viewing, onSelect, onCurrent }: ReaderEditions & {
  viewing?: string | undefined;
  onSelect: (number: string) => void;
  onCurrent: () => void;
}) => {
  const t = useTranslations();
  const current = editions.find((edition) => edition.number === currentEdition);
  return (
    <LessonEditionRows disablePadding data-testid="lesson-editions-list">
      <EditionRow
        label={current === undefined ? t.lesson.editionCurrentVersion : t.lesson.editionLabel({ number: current.number })}
        edition={current}
        currentMark={current !== undefined}
        onScreen={liveOnScreen(currentEdition, viewing)}
        onClick={onCurrent}
      />
      {editions.filter((edition) => edition.number !== currentEdition).map((edition) => (
        <EditionRow
          key={edition.number}
          label={t.lesson.editionLabel({ number: edition.number })}
          edition={edition}
          currentMark={false}
          onScreen={viewing === edition.number}
          onClick={() => onSelect(edition.number)}
        />
      ))}
    </LessonEditionRows>
  );
};

export const LessonEditionPicker = ({ editions, currentEdition, viewing, onSelect, onCurrent }: ReaderEditions & {
  viewing?: string | undefined;
  onSelect: (number: string) => void;
  onCurrent: () => void;
}) => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  if (editions.length === 0) return null;
  const onLive = liveOnScreen(currentEdition, viewing);
  if (onLive && currentEdition !== null && editions.length === 1) return <LessonEditionBadge number={currentEdition} />;
  const shown = onLive ? currentEdition : viewing ?? null;
  const close = () => setOpen(false);
  return (
    <>
      <LessonEditionTrigger
        variant="outlined"
        endIcon={<ChevronDownIcon />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="lesson-edition-badge"
      >
        {shown === null ? t.lesson.editionCurrentVersion : t.lesson.editionLabel({ number: shown })}
      </LessonEditionTrigger>
      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', pr: '0.75rem' }}>
          <DialogTitle sx={{ flexGrow: 1 }}>{t.lesson.editionsTitle}</DialogTitle>
          <IconButton aria-label={t.common.close} onClick={close} data-testid="lesson-editions-close"><CloseIcon /></IconButton>
        </Box>
        <DialogContent sx={{ px: 0, pt: 0, pb: '0.5rem' }}>
          <LessonEditionsList
            editions={editions}
            currentEdition={currentEdition}
            viewing={viewing}
            onSelect={(number) => { close(); if (number !== viewing) onSelect(number); }}
            onCurrent={() => { close(); if (viewing !== undefined) onCurrent(); }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export const LessonEditionBanner = ({ number, markedAt, onCurrent }: { number: string; markedAt?: string | undefined; onCurrent: () => void }) => {
  const t = useTranslations();
  const formatDate = useEditionDate();
  return (
    <LessonEditionWarning
      severity="warning"
      variant="standard"
      data-testid="lesson-edition-banner"
      sx={{ mb: '1.5rem' }}
      action={<Button variant="outlined" color="inherit" onClick={onCurrent}>{t.lesson.editionGoToCurrent}</Button>}
    >
      <Typography variant="body1">
        {markedAt === undefined
          ? t.lesson.editionOlderNoticeUndated({ number })
          : t.lesson.editionOlderNotice({ number, date: formatDate(markedAt) })}
      </Typography>
    </LessonEditionWarning>
  );
};

export const LessonEditionNotice = ({ lessonId, editionNumber, enabled, onCurrent }: { lessonId: string; editionNumber?: string | undefined; enabled: boolean; onCurrent: () => void }) => {
  const editions = useLessonEditions(lessonId, enabled && editionNumber !== undefined);
  if (!enabled || editionNumber === undefined) return null;
  if (editions.isError) return <LessonEditionBanner number={editionNumber} onCurrent={onCurrent} />;
  if (editions.data === undefined || editions.data.currentEdition === editionNumber) return null;
  const marked = editions.data.editions.find((edition) => edition.number === editionNumber);
  return <LessonEditionBanner number={editionNumber} markedAt={marked?.markedAt} onCurrent={onCurrent} />;
};

export const LessonEditionControls = ({ lessonId, editionNumber, enabled, onSelect, onCurrent }: { lessonId: string; editionNumber?: string | undefined; enabled: boolean; onSelect: (number: string) => void; onCurrent: () => void }) => {
  const editions = useLessonEditions(lessonId, enabled);
  if (!enabled || editions.data === undefined) return null;
  return <LessonEditionPicker editions={editions.data.editions} currentEdition={editions.data.currentEdition} viewing={editionNumber} onSelect={onSelect} onCurrent={onCurrent} />;
};
