import { Box, Button, Link, Paper, Stack, Typography } from '@mui/material';

import type { CourseStructureLesson, CourseStructureWithAccess } from '@core/domain/index.js';

import { useTranslations, type Messages } from '../../i18n/index.js';
import { Eyebrow, RailProgressBar, StatTileValue } from '../../theme.js';
import { CourseTree } from './CourseTree.js';

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

export const firstAccessibleLessonId = (structure: CourseStructureWithAccess): string | null =>
  flattenLessons(structure).find((lesson) => lesson.accessStatus === 'fully-accessible')?.lessonId ??
  null;

export const continueLessonId = (
  structure: CourseStructureWithAccess,
  lastViewedLessonId: string | undefined,
): string | null => {
  const lessons = flattenLessons(structure);
  const lastViewed = lessons.find(
    (lesson) =>
      lesson.lessonId === lastViewedLessonId && lesson.accessStatus === 'fully-accessible',
  );
  return lastViewed?.lessonId ?? firstAccessibleLessonId(structure);
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
      {continueTarget !== null && (
        <Stack useFlexGap sx={{ mt: '1.25rem', rowGap: '0.75rem' }}>
          <Button
            variant="contained"
            fullWidth
            component="a"
            href={`/my/courses/${courseId}/lessons/${continueTarget}`}
            data-testid="continue-cta"
          >
            {t.courseOverview.continueLearning}
          </Button>
          {firstTarget !== null && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Link
                href={`/my/courses/${courseId}/lessons/${firstTarget}`}
                variant="body2"
                data-testid="first-lesson-link"
              >
                {t.courseOverview.goToFirstLesson}
              </Link>
            </Box>
          )}
        </Stack>
      )}
    </Paper>
  );
};

export const CurriculumCard = ({
  courseId,
  structure,
  currentLessonId,
}: {
  courseId: string;
  structure: CourseStructureWithAccess;
  currentLessonId?: string;
}) => {
  const t = useTranslations();
  return (
    <Paper elevation={1} sx={{ p: '1.25rem' }} data-testid="curriculum-card">
      <Eyebrow variant="overline" component="p" sx={{ mb: '0.75rem' }}>
        {t.courseOverview.curriculum}
      </Eyebrow>
      <CourseTree
        courseId={courseId}
        structure={structure}
        {...(currentLessonId === undefined ? {} : { currentLessonId })}
      />
    </Paper>
  );
};
