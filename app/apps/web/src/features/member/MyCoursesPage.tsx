import { useEffect } from 'react';
import { Box, Chip, Link, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import type { CompletionStatus, Course } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations, type Messages } from '../../i18n/index.js';
import {
  CardTitle,
  CourseCardCover,
  CourseCardCoverFallback,
  CourseCardInitials,
  CourseCardRoot,
} from '../../theme.js';
import { MemberSurface } from './MemberSurface.js';
import { EmptyLibraryIcon } from './overview-icons.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

const completionLabel = (t: Messages, status: CompletionStatus): string =>
  status === 'fully-completed'
    ? t.student.completionCompleted
    : status === 'partially-completed'
      ? t.student.completionInProgress
      : t.student.completionNotStarted;

const CompletionChip = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  const structure = useQuery(actions.courseStructure(courseId));
  if (structure.isError) {
    return <StatusView surface={false} state={{ kind: 'error', message: localizeError(structure.error, t), retry: { label: t.common.retry, onRetry: () => void structure.refetch() } }} />;
  }
  if (!structure.data) return null;
  const status = structure.data.structure.completionStatus;
  return (
    <Chip
      size="small"
      variant="outlined"
      color={status === 'fully-completed' ? 'success' : 'default'}
      label={completionLabel(t, status)}
      data-testid={`completion-${courseId}`}
    />
  );
};

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

const CourseCard = ({ course }: { course: Course }) => (
  <CourseCardRoot component={RouterLink} to={`/my/courses/${encodeURIComponent(course.id)}`} data-testid={`course-card-${course.id}`}>
    <CourseCardMedia course={course} />
    <Box sx={{ p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <Stack useFlexGap sx={{ alignItems: 'flex-start', rowGap: '0.55rem' }}>
        <CardTitle variant="h2" sx={{ minWidth: 0 }}>
          {course.name}
        </CardTitle>
        <CompletionChip courseId={course.id} />
      </Stack>
      {course.description ? (
        <Typography variant="body2">{course.description}</Typography>
      ) : null}
    </Box>
  </CourseCardRoot>
);

export const MyCoursesPage = () => {
  const t = useTranslations();
  const courses = useQuery(actions.studentCourses);
  const navigate = useNavigate();
  const unauthorized = isUnauthorized(courses.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (courses.isPending) {
    return (
      <MemberSurface
        title={t.student.myCourses}
        eyebrow={t.student.courseLibrary}
        width="wide"
        state={{ kind: 'loading', label: t.student.loadingCourses }}
      />
    );
  }

  if (unauthorized) return null;

  if (courses.isError) {
    return (
      <MemberSurface
        title={t.student.myCourses}
        eyebrow={t.student.courseLibrary}
        width="wide"
        state={{
          kind: 'error',
          message: isForbidden(courses.error) ? t.student.staffNoMember : localizeError(courses.error, t),
          retry: { label: t.common.retry, onRetry: () => void courses.refetch() },
        }}
      />
    );
  }

  return (
    <MemberSurface title={t.student.myCourses} eyebrow={t.student.courseLibrary} width="wide">
        {courses.data.courses.length === 0 ? (
          <StatusView
            state={{
              kind: 'empty',
              icon: <EmptyLibraryIcon />,
              title: t.student.noCourses,
              body: (
                <Stack useFlexGap spacing="0.5rem">
                  <Typography variant="body1">{t.student.coursesWillAppear}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t.student.coursesEmptyRenewHint}
                  </Typography>
                </Stack>
              ),
              action: <Link component={RouterLink} to="/my/products">{t.student.myProducts}</Link>,
            }}
            data-testid="my-courses-empty-state"
          />
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: '1rem',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
            }}
          >
            {courses.data.courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </Box>
        )}
    </MemberSurface>
  );
};
