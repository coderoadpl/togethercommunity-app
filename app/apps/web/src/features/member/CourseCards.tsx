import { Box, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import type { Course } from '#core/domain/index.js';

import { useTranslations } from '../../i18n/index.js';
import {
  CardTitle,
  CourseCardCover,
  CourseCardCoverFallback,
  CourseCardInitials,
  CourseCardRoot,
  RailProgressBar,
} from '../../theme.js';
import { coursePercent, type CourseLessonCounts } from './course-progress.js';

const courseInitials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => (word[0] ?? '').toLocaleUpperCase())
    .join('');

const CourseCardMedia = ({ course }: { course: Course }) => {
  const t = useTranslations();
  if (course.imageUrl !== null) {
    return (
      <CourseCardCover
        src={course.imageUrl}
        alt={t.courseOverview.coverAlt({ name: course.name })}
        loading="lazy"
        data-testid={`course-cover-${course.id}`}
      />
    );
  }
  return (
    <CourseCardCoverFallback data-testid={`course-cover-fallback-${course.id}`}>
      <CourseCardInitials component="span" aria-hidden>
        {courseInitials(course.name)}
      </CourseCardInitials>
    </CourseCardCoverFallback>
  );
};

const CourseCardProgress = ({ courseId, counts }: { courseId: string; counts: CourseLessonCounts }) => {
  const t = useTranslations();
  const percent = coursePercent(counts);
  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{ alignItems: 'center', columnGap: '0.6rem' }}
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
    </Stack>
  );
};

export const CourseCard = ({ course, counts }: { course: Course; counts?: CourseLessonCounts }) => (
  <CourseCardRoot component={Link} to={`/my/courses/${encodeURIComponent(course.id)}`} data-testid={`course-card-${course.id}`}>
    <CourseCardMedia course={course} />
    <Box sx={{ p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <CardTitle variant="h2" sx={{ minWidth: 0 }}>
        {course.name}
      </CardTitle>
      {course.description ? <Typography variant="body2">{course.description}</Typography> : null}
      {counts === undefined ? null : <CourseCardProgress courseId={course.id} counts={counts} />}
    </Box>
  </CourseCardRoot>
);
