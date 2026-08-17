import { Box, Button, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import type { CourseStructureLesson, CourseStructureWithAccess } from '#core/domain/index.js';

import { useTranslations, type Messages } from '../../i18n/index.js';
import { CourseCompletedNote, Eyebrow, RailProgressBar, StatTileValue } from '../../theme.js';

export const flattenLessons = (structure: CourseStructureWithAccess): CourseStructureLesson[] =>
  structure.modules.flatMap((module) => module.chapters.flatMap((chapter) => chapter.lessons));

export interface CourseTotals {
  total: number;
  done: number;
  percent: number;
  totalMinutes: number;
}

export const courseTotals = (structure: CourseStructureWithAccess): CourseTotals => {
  const lessons = flattenLessons(structure);
  const done = lessons.filter((lesson) => lesson.completionStatus === 'fully-completed').length;
  const totalMinutes = lessons.reduce((sum, lesson) => sum + (lesson.durationMinutes ?? 0), 0);
  return {
    total: lessons.length,
    done,
    percent: lessons.length === 0 ? 0 : Math.round((done / lessons.length) * 100),
    totalMinutes,
  };
};

const firstAccessibleLessonId = (structure: CourseStructureWithAccess): string | null =>
  flattenLessons(structure).find((lesson) => lesson.accessStatus === 'fully-accessible')?.lessonId ??
  null;

export const continueLessonId = (
  structure: CourseStructureWithAccess,
  lastViewedLessonId: string | undefined,
): string | null => {
  const accessible = flattenLessons(structure).filter(
    (lesson) => lesson.accessStatus === 'fully-accessible',
  );
  const unfinished = (lesson: CourseStructureLesson) =>
    lesson.completionStatus !== 'fully-completed';
  const lastViewedIndex = accessible.findIndex(
    (lesson) => lesson.lessonId === lastViewedLessonId,
  );
  if (lastViewedIndex !== -1) {
    const lastViewed = accessible[lastViewedIndex];
    if (lastViewed !== undefined && unfinished(lastViewed)) return lastViewed.lessonId;
    const following = accessible.slice(lastViewedIndex + 1).find(unfinished);
    if (following !== undefined) return following.lessonId;
  }
  return accessible.find(unfinished)?.lessonId ?? accessible[0]?.lessonId ?? null;
};

export const formatTotalDuration = (t: Messages, totalMinutes: number): string =>
  totalMinutes >= 60
    ? t.courseOverview.durationHoursMinutes({
        hours: Math.floor(totalMinutes / 60),
        minutes: totalMinutes % 60,
      })
    : t.courseOverview.durationMinutesOnly({ minutes: totalMinutes });

export const CourseProgressCard = ({
  courseId,
  structure,
  lastViewedLessonId,
}: {
  courseId: string;
  structure: CourseStructureWithAccess;
  lastViewedLessonId: string | undefined;
}) => {
  const t = useTranslations();
  const totals = courseTotals(structure);
  const continueTarget = continueLessonId(structure, lastViewedLessonId);
  const firstTarget = firstAccessibleLessonId(structure);
  const targetLesson =
    continueTarget === null
      ? undefined
      : flattenLessons(structure).find((lesson) => lesson.lessonId === continueTarget);
  const isReview = targetLesson?.completionStatus === 'fully-completed';
  const courseCompleted = totals.total > 0 && totals.done === totals.total;

  return (
    <Paper elevation={1} sx={{ p: '1.25rem' }} data-testid="course-progress-card">
      <Eyebrow variant="overline" component="p">
        {t.courseOverview.progressTitle}
      </Eyebrow>
      <Stack
        direction="row"
        useFlexGap
        sx={{ alignItems: 'baseline', columnGap: '0.75rem', mt: '0.5rem' }}
      >
        <Typography variant="body2" sx={{ flex: 1 }} data-testid="progress-summary">
          {t.courseOverview.completedOf({ done: totals.done, total: totals.total })}
        </Typography>
        <StatTileValue component="span" data-testid="progress-percent">
          {t.courseOverview.percentValue({ percent: totals.percent })}
        </StatTileValue>
      </Stack>
      <RailProgressBar
        variant="determinate"
        value={totals.percent}
        sx={{ mt: '0.6rem' }}
        aria-label={t.courseOverview.progressTitle}
      />
      {courseCompleted && (
        <CourseCompletedNote
          variant="body2"
          component="p"
          data-testid="course-completed-note"
          sx={{ mt: '0.75rem' }}
        >
          {t.courseOverview.courseCompleted}
        </CourseCompletedNote>
      )}
      {continueTarget !== null && (
        <Stack useFlexGap sx={{ mt: '1.25rem', rowGap: '0.75rem' }}>
          <Button
            variant={isReview ? 'outlined' : 'contained'}
            fullWidth
            component={Link}
            to={`/my/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(continueTarget)}`}
            data-testid="continue-cta"
          >
            {isReview ? t.courseOverview.reviewAgain : t.courseOverview.continueLearning}
          </Button>
          {firstTarget !== null && firstTarget !== continueTarget && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <MuiLink
                component={Link}
                to={`/my/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(firstTarget)}`}
                variant="body2"
                data-testid="first-lesson-link"
              >
                {t.courseOverview.goToFirstLesson}
              </MuiLink>
            </Box>
          )}
        </Stack>
      )}
    </Paper>
  );
};
