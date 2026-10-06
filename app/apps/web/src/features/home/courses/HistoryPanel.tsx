import { useState } from 'react';
import { Button, List, ListItemButton, ListItemText, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { Eyebrow, FinePrint } from '../../../theme.js';
import { formatDateTime } from '../../../lib/format.js';
import { VersionPreviewDialog } from './VersionPreviewDialog.js';

const HISTORY_PAGE_SIZE = 20;

export const HistoryPanel = (input: { courseId: string } | { lessonId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [offset, setOffset] = useState(0);
  const [openVersionId, setOpenVersionId] = useState<string | null>(null);
  const courseHistory = useQuery({
    ...actions.contentHistory({ courseId: 'courseId' in input ? input.courseId : '', limit: HISTORY_PAGE_SIZE }),
    enabled: 'courseId' in input,
  });
  const lessonHistory = useQuery({
    ...actions.staffLessonHistory('lessonId' in input ? input.lessonId : '', offset, HISTORY_PAGE_SIZE),
    enabled: 'lessonId' in input,
  });
  const history = 'lessonId' in input ? lessonHistory : courseHistory;

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
          state={{ kind: 'empty', title: offset > 0 ? t.courses.historyEnd : t.courses.historyEmpty, ...(offset > 0 ? {} : { body: t.courses.historyEmptyBody }) }}
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
                      : version.subjectKind === 'lesson'
                        ? t.courses.historySubjectLesson({ name: version.subjectName })
                        : t.courses.historySubjectModule({ name: version.subjectName })
                  } · ${t.courses.historyEntrySchema({ version: version.schemaVersion })}${version.edition ? ` · ${t.lesson.editionLabel({ number: version.edition.number })}` : ''}`}
                />
              </ListItemButton>
            ))}
          </List>
        </>
      )}
      {'lessonId' in input && (offset > 0 || (history.data?.versions.length ?? 0) === HISTORY_PAGE_SIZE) ? (
        <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Button disabled={offset === 0 || history.isPending} onClick={() => setOffset((current) => Math.max(0, current - HISTORY_PAGE_SIZE))}>
            {t.pagination.previousPage}
          </Button>
          <Typography variant="caption" aria-live="polite">{t.courses.historyPage({ page: offset / HISTORY_PAGE_SIZE + 1 })}</Typography>
          <Button disabled={history.isPending || (history.data?.versions.length ?? 0) < HISTORY_PAGE_SIZE} onClick={() => setOffset((current) => current + HISTORY_PAGE_SIZE)}>
            {t.pagination.nextPage}
          </Button>
        </Stack>
      ) : null}
      {openVersionId === null ? null : (
        <VersionPreviewDialog versionId={openVersionId} onClose={() => setOpenVersionId(null)} />
      )}
    </Paper>
  );
};
