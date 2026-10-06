import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { AlertTitle, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemButton, ListItemText, Menu, MenuItem, Stack, Typography } from '@mui/material';

import { actions } from '../../api.js';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { LessonEditionWarning } from '../../theme.js';

interface ReaderEdition {
  number: string;
  note: string | null;
  markedAt: string;
}

export const LessonEditionBadge = ({ number }: { number: string }) => {
  const t = useTranslations();
  return <Chip size="small" variant="outlined" label={t.lesson.editionLabel({ number })} data-testid="lesson-edition-badge" />;
};

export const LessonEditionsList = ({ editions, onSelect }: { editions: readonly ReaderEdition[]; onSelect: (number: string) => void }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return (
    <List disablePadding data-testid="lesson-editions-list">
      {editions.map((edition) => (
        <ListItem key={edition.number} disablePadding>
          <ListItemButton onClick={() => onSelect(edition.number)} sx={{ alignItems: 'flex-start' }}>
            <ListItemText
              primary={t.lesson.editionLabel({ number: edition.number })}
              secondary={(
                <>
                  <Typography component="span" variant="body2" sx={{ display: 'block' }}>
                    {new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(edition.markedAt))}
                  </Typography>
                  {edition.note === null ? null : <Typography component="span" variant="body2" sx={{ display: 'block' }}>{edition.note}</Typography>}
                </>
              )}
            />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );
};

export const LessonEditionMenu = ({ editions, onSelect }: { editions: readonly ReaderEdition[]; onSelect: (number: string) => void }) => {
  const t = useTranslations();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [listOpen, setListOpen] = useState(false);
  if (editions.length < 2) return null;
  return (
    <>
      <IconButton aria-label={t.lesson.editionMenu} aria-haspopup="menu" aria-expanded={anchor !== null} onClick={(event) => setAnchor(event.currentTarget)} size="small">⋯</IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => { setAnchor(null); setListOpen(true); }}>{t.lesson.previousEditions}</MenuItem>
      </Menu>
      <Dialog open={listOpen} onClose={() => setListOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t.lesson.previousEditions}</DialogTitle>
        <DialogContent>
          <LessonEditionsList editions={editions} onSelect={(number) => { setListOpen(false); onSelect(number); }} />
        </DialogContent>
      </Dialog>
    </>
  );
};

export const LessonEditionBanner = ({ onCurrent }: { onCurrent: () => void }) => {
  const t = useTranslations();
  return (
    <LessonEditionWarning severity="warning" variant="filled" data-testid="lesson-edition-banner" sx={{ mb: '1.5rem', p: { xs: '1rem', sm: '1.5rem' } }}>
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <AlertTitle><Typography component="span" variant="h3">{t.lesson.editionOlderWarning}</Typography></AlertTitle>
        <Button variant="outlined" color="inherit" onClick={onCurrent}>{t.lesson.editionBackToCurrent}</Button>
      </Stack>
    </LessonEditionWarning>
  );
};

export const LessonEditionControls = ({ lessonId, editionNumber, enabled, onSelect }: { lessonId: string; editionNumber?: string | undefined; enabled: boolean; onSelect: (number: string) => void }) => {
  const editions = useQuery({ ...actions.studentLessonEditions(lessonId), enabled });
  const displayedNumber = editionNumber ?? editions.data?.editions[0]?.number;
  if (!enabled || displayedNumber === undefined || editions.data === undefined) return null;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <LessonEditionBadge number={displayedNumber} />
      <LessonEditionMenu editions={editions.data.editions} onSelect={onSelect} />
    </Stack>
  );
};
