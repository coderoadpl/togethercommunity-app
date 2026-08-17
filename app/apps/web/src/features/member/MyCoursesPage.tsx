import { useEffect } from 'react';
import { Box, Link, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { CourseCard } from './CourseCards.js';
import type { CourseLessonCounts } from './course-progress.js';
import { MemberSurface } from './MemberSurface.js';
import { EmptyLibraryIcon } from './overview-icons.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

export const MyCoursesPage = () => {
  const t = useTranslations();
  const courses = useQuery(actions.studentCourses);
  const navigation = useQuery(actions.memberNavigation);
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

  const counts = new Map<string, CourseLessonCounts>(
    (navigation.data?.navigation.courses ?? []).map((course) => [course.courseId, course]),
  );

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
            {courses.data.courses.map((course) => {
              const progress = counts.get(course.id);
              return (
                <CourseCard
                  key={course.id}
                  course={course}
                  {...(progress === undefined ? {} : { counts: progress })}
                />
              );
            })}
          </Box>
        )}
    </MemberSurface>
  );
};
