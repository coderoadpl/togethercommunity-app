import { Box, Button, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import type { CourseResume, CourseStructureLesson, CourseStructureWithAccess } from '#core/domain/index.js';

import { CompletionMark } from '../../components/ui/CompletionMark.js';
import { useTranslations, type Messages } from '../../i18n/index.js';
import { Eyebrow, RailProgressBar, StatTileValue } from '../../theme.js';

const flattenLessons = (structure: CourseStructureWithAccess): CourseStructureLesson[] =>
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
  resume,
}: {
  courseId: string;
  structure: CourseStructureWithAccess;
  resume: CourseResume | undefined;
}) => {
  const t = useTranslations();
  const totals = courseTotals(structure);
  const target = resume?.target;
  const firstTarget = resume?.firstIncomplete;
  const isReview = resume?.isReview === true;
  const label = target == null ? '' : `${isReview ? t.courseOverview.reviewAgain : t.courseOverview.continueLearning}: ${target.name}`;
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
        {courseCompleted ? (
          <CompletionMark size="md" label={t.courseOverview.courseCompleted} />
        ) : null}
      </Stack>
      <RailProgressBar
        variant="determinate"
        value={totals.percent}
        sx={{ mt: '0.6rem' }}
        aria-label={t.courseOverview.progressTitle}
      />
      {target != null && (
        <Stack useFlexGap sx={{ mt: '1.25rem', rowGap: '0.75rem' }}>
          <Button
            variant={isReview ? 'outlined' : 'contained'}
            fullWidth
            component={Link}
            to={`/my/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(target.id)}`}
            data-testid="continue-cta"
            title={label}
            sx={{ minWidth: 0 }}
          >
            <Typography component="span" variant="inherit" noWrap sx={{ minWidth: 0 }}>{label}</Typography>
          </Button>
          {firstTarget != null && firstTarget.id !== target.id && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <MuiLink
                component={Link}
                to={`/my/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(firstTarget.id)}`}
                variant="body2"
                color="text.secondary"
                data-testid="first-lesson-link"
              >
                {t.courseOverview.firstIncomplete({ name: firstTarget.name })}
              </MuiLink>
            </Box>
          )}
        </Stack>
      )}
    </Paper>
  );
};
