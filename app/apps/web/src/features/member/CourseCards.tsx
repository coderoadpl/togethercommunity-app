import { Box, Chip, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import type { Course } from '#core/domain/index.js';

import { ChevronRightIcon } from '../../components/ui/account-icons.js';
import { CompletionMark } from '../../components/ui/CompletionMark.js';
import { Cover } from '../../components/ui/Cover.js';
import { useTranslations } from '../../i18n/index.js';
import { CourseCardRoot, RailProgressBar } from '../../theme.js';
import { coursePercent, isCourseDone, type CourseLessonCounts } from './course-progress.js';

export type CourseCardCourse = Pick<Course, 'id' | 'name' | 'description' | 'imageUrl'>;

const CourseCardMedia = ({ course }: { course: CourseCardCourse }) => {
  const t = useTranslations();
  return (
    <Cover
      src={course.imageUrl}
      title={course.name}
      alt={t.courseOverview.coverAlt({ name: course.name })}
      testId={`course-cover-${course.id}`}
      fallbackTestId={`course-cover-fallback-${course.id}`}
    />
  );
};

const CourseCardProgress = ({ courseId, counts }: { courseId: string; counts: CourseLessonCounts }) => {
  const t = useTranslations();
  const percent = coursePercent(counts);
  const done = isCourseDone(counts);
  return (
    <Stack
      direction="row"
      useFlexGap
      data-testid={`course-progress-row-${courseId}`}
      sx={{ alignItems: 'center', columnGap: '0.6rem', marginTop: 'auto' }}
    >
      <RailProgressBar
        variant="determinate"
        value={percent}
        aria-label={t.courseOverview.progressTitle}
        sx={{ flex: 1 }}
      />
      <Typography variant="caption" color="text.secondary" component="span" data-testid={`course-progress-${courseId}`}>
        {t.courseOverview.percentValue({ percent })}
      </Typography>
      {done ? <CompletionMark label={t.courseOverview.courseCompleted} /> : null}
    </Stack>
  );
};

export const CourseCard = ({
  course,
  counts,
  preview = false,
}: {
  course: CourseCardCourse;
  counts?: CourseLessonCounts;
  preview?: boolean;
}) => {
  const t = useTranslations();
  return (
    <CourseCardRoot component={Link} to={`/my/courses/${encodeURIComponent(course.id)}`} data-testid={`course-card-${course.id}`}>
      <CourseCardMedia course={course} />
      <Box
        data-testid={`course-card-body-${course.id}`}
        sx={{ p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', flexGrow: 1 }}
      >
        <Typography variant="h2" component="h3" sx={{ minWidth: 0 }}>
          {course.name}
        </Typography>
        {course.description ? (
          <Typography variant="body2" sx={{ flexGrow: 1 }}>
            {course.description}
          </Typography>
        ) : null}
        {preview ? (
          <Chip
            size="small"
            variant="outlined"
            color="primary"
            label={t.anon.previewChip}
            data-testid={`course-preview-${course.id}`}
            sx={{ alignSelf: 'flex-start', mt: 'auto' }}
          />
        ) : null}
        {counts === undefined ? null : <CourseCardProgress courseId={course.id} counts={counts} />}
      </Box>
    </CourseCardRoot>
  );
};

export const CourseRow = ({ course, actionLabel }: { course: Pick<Course, 'id' | 'name'>; actionLabel: string }) => (
  <CourseCardRoot
    component={Link}
    to={`/my/courses/${encodeURIComponent(course.id)}`}
    data-testid={`course-row-${course.id}`}
    sx={{
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: '0.75rem',
      minHeight: 44,
      p: '0.75rem 1rem',
      '&:active': { transform: 'translateY(1px)' },
    }}
  >
    <Typography variant="h3" component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
      {course.name}
    </Typography>
    <Typography variant="body2" component="span" color="primary" sx={{ flexShrink: 0 }}>
      {actionLabel}
    </Typography>
    <ChevronRightIcon />
  </CourseCardRoot>
);
