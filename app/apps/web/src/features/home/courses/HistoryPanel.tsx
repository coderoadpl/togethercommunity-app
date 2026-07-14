import { Alert, List, ListItem, ListItemText, Paper, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { Eyebrow } from '../../../theme.js';
import { formatDate } from '../../../lib/format.js';
import { MutationError } from './feedback.js';

/**
 * Read-only "Historia zmian" list for a course. Each entry is a stored snapshot
 * of the previous state captured when the course was edited. Restoring a
 * version is intentionally out of scope for this iteration.
 */
export const HistoryPanel = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const history = useQuery(actions.contentHistory({ entityKind: 'course', entityId: courseId }));

  return (
    <Paper elevation={1} sx={{ p: '1.1rem', display: 'grid', gap: '0.75rem' }} data-testid="history-panel">
      <Eyebrow variant="overline" component="h3">
        {t.courses.historyHeading}
      </Eyebrow>
      <Alert severity="info">{t.courses.historyRestoreNote}</Alert>
      {history.isPending ? (
        <Typography variant="body2">{t.courses.historyLoading}</Typography>
      ) : history.isError ? (
        <MutationError error={history.error} />
      ) : history.data.versions.length === 0 ? (
        <Typography variant="body2">{t.courses.historyEmpty}</Typography>
      ) : (
        <List disablePadding dense>
          {history.data.versions.map((version) => (
            <ListItem key={version.id} disableGutters>
              <ListItemText
                primary={t.courses.historyEntry({
                  version: version.schemaVersion,
                  date: formatDate(version.createdAt, language),
                  author: version.createdBy ?? t.courses.historyUnknownAuthor,
                })}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
};
