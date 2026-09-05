import { useState } from 'react';
import { List, ListItemButton, ListItemText, Paper } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { Eyebrow, FinePrint } from '../../../theme.js';
import { formatDateTime } from '../../../lib/format.js';
import { VersionPreviewDialog } from './VersionPreviewDialog.js';

/**
 * "Historia zmian" for a course: the course's own snapshots merged with those
 * of its attached modules. Each entry opens a read-only preview that can be
 * restored as a new save.
 */
export const HistoryPanel = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [openVersionId, setOpenVersionId] = useState<string | null>(null);
  const history = useQuery(actions.contentHistory({ courseId }));

  return (
    <Paper elevation={1} sx={{ p: '1.1rem', display: 'grid', gap: '0.75rem' }} data-testid="history-panel">
      <Eyebrow variant="overline" component="h3">
        {t.courses.historyHeading}
      </Eyebrow>
      {history.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.courses.historyLoading }} />
      ) : history.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(history.error, t), retry: { label: t.common.retry, onRetry: () => void history.refetch() } }} />
      ) : history.data.versions.length === 0 ? (
        <StatusView
          state={{ kind: 'empty', title: t.courses.historyEmpty, body: t.courses.historyEmptyBody }}
          surface={false}
        />
      ) : (
        <>
          <FinePrint component="p">{t.courses.historyHint}</FinePrint>
          <List disablePadding dense>
            {history.data.versions.map((version) => (
              <ListItemButton
                key={version.id}
                disableGutters
                aria-label={t.courses.historyOpenAria({ ordinal: version.ordinal })}
                onClick={() => setOpenVersionId(version.id)}
              >
                <ListItemText
                  primary={t.courses.historyEntry({
                    ordinal: version.ordinal,
                    date: formatDateTime(version.createdAt, language),
                    author: version.createdByDisplayName ?? t.courses.historyUnknownAuthor,
                  })}
                  secondary={`${
                    version.subjectKind === 'course'
                      ? t.courses.historySubjectCourse({ name: version.subjectName })
                      : t.courses.historySubjectModule({ name: version.subjectName })
                  } · ${t.courses.historyEntrySchema({ version: version.schemaVersion })}`}
                />
              </ListItemButton>
            ))}
          </List>
        </>
      )}
      {openVersionId === null ? null : (
        <VersionPreviewDialog versionId={openVersionId} onClose={() => setOpenVersionId(null)} />
      )}
    </Paper>
  );
};
