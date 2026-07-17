import { Alert, List, ListItem, ListItemText, Paper } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { StatusView } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { Eyebrow } from '../../../theme.js';
import { formatDateTime } from '../../../lib/format.js';

/**
 * Read-only "Historia zmian" list for a course. Each entry is a stored snapshot
 * of the previous state captured when the course was edited. Restoring a
 * version is intentionally out of scope for this iteration.
 */
export const HistoryPanel = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const history = useQuery(actions.contentHistory({ courseId }));

  return (
    <Paper elevation={1} sx={{ p: '1.1rem', display: 'grid', gap: '0.75rem' }} data-testid="history-panel">
      <Eyebrow variant="overline" component="h3">
        {t.courses.historyHeading}
      </Eyebrow>
      <Alert severity="info">{t.courses.historyRestoreNote}</Alert>
      {history.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.courses.historyLoading }} />
      ) : history.isError ? (
        <StatusView state={{ kind: 'error', message: localizeError(history.error, t) }} />
      ) : history.data.versions.length === 0 ? (
        <StatusView state={{ kind: 'empty', title: t.courses.historyEmpty }} surface={false} />
      ) : (
        <List disablePadding dense>
          {history.data.versions.map((version) => (
            <ListItem key={version.id} disableGutters>
              <ListItemText
                primary={t.courses.historyEntry({
                  version: version.schemaVersion,
                  date: formatDateTime(version.createdAt, language),
                  author: version.createdByDisplayName ?? t.courses.historyUnknownAuthor,
                })}
                secondary={`${
                  version.subjectKind === 'course'
                    ? t.courses.historySubjectCourse({ name: version.subjectName })
                    : t.courses.historySubjectModule({ name: version.subjectName })
                } · ${t.courses.historyEntryId({ id: version.id })}`}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
};
