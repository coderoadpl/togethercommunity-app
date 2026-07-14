import { useEffect } from 'react';
import { Alert, Box, Chip, Container, Link, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';
import type { CompletionStatus, Course } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { localizeError, useTranslations, type Messages } from '../../i18n/index.js';
import { CardTitle, CourseCardRoot, Eyebrow, LedgerHeader } from '../../theme.js';
import { MemberAccountMenu } from './MemberAccountMenu.js';

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

const CourseCard = ({ course }: { course: Course }) => (
  <CourseCardRoot component="a" href={`/my/courses/${course.id}`} data-testid={`course-card-${course.id}`}>
    <Box sx={{ p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', height: '100%' }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'flex-start', columnGap: '0.75rem' }}>
        <CardTitle variant="h2" sx={{ flex: 1, minWidth: 0 }}>
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
      <Container sx={{ maxWidth: '52rem', py: 6 }}>
        <Typography variant="h2" component="p">
          {t.student.loadingCourses}
        </Typography>
      </Container>
    );
  }

  if (unauthorized) return null;

  if (courses.isError) {
    return (
      <Container sx={{ maxWidth: '52rem', py: 6 }}>
        <Alert>
          {isForbidden(courses.error) ? t.student.staffNoMember : localizeError(courses.error, t)}
        </Alert>
      </Container>
    );
  }

  return (
    <Container disableGutters sx={{ maxWidth: '52rem !important', px: '1.25rem', pb: '6rem' }}>
      <LedgerHeader component="header" sx={{ pt: '48px', pb: '21px' }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem' }}>
          <Typography variant="h1">{t.student.myCourses}</Typography>
          <Box sx={{ flex: 1 }} />
          <Link href="/my/products">{t.student.myProducts}</Link>
          <Link href="/">{t.common.home}</Link>
          <MemberAccountMenu />
        </Stack>
        <Eyebrow variant="overline" component="p">
          {t.student.courseLibrary}
        </Eyebrow>
      </LedgerHeader>

      <Box component="section" sx={{ mt: '2.5rem' }}>
        {courses.data.courses.length === 0 ? (
          <Paper elevation={1} sx={{ p: '1.5rem' }}>
            <CardTitle variant="h1">{t.student.noCourses}</CardTitle>
            <Typography variant="body1" sx={{ mt: '1rem' }}>
              {t.student.coursesWillAppear}
            </Typography>
          </Paper>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: '1rem',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
            }}
          >
            {courses.data.courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </Box>
        )}
      </Box>
    </Container>
  );
};
