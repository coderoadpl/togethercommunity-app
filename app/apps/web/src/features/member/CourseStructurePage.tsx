import { useEffect } from 'react';
import { Alert, Box, Container, Link, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { CardTitle, Eyebrow, LedgerHeader } from '../../theme.js';
import { CourseTree } from './CourseTree.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

const isNotFound = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'not_found';

export const CourseStructurePage = ({ courseId }: { courseId: string }) => {
  const structure = useQuery(actions.courseStructure(courseId));
  const navigate = useNavigate();
  const unauthorized = isUnauthorized(structure.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (structure.isPending) {
    return (
      <Container sx={{ maxWidth: '52rem', py: 6 }}>
        <Typography variant="h2" component="p">
          loading course…
        </Typography>
      </Container>
    );
  }

  if (unauthorized) return null;

  if (structure.isError) {
    return (
      <Container sx={{ maxWidth: '52rem', py: 6 }}>
        <Paper elevation={1} sx={{ p: '1.5rem' }}>
          <CardTitle variant="h1">
            {isNotFound(structure.error) ? 'Course not found' : 'Course unavailable'}
          </CardTitle>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            {isForbidden(structure.error)
              ? 'This account has staff access here, but no member profile yet.'
              : isNotFound(structure.error)
                ? 'This course is not in your library.'
                : structure.error.message}
          </Typography>
          <Box sx={{ mt: '1rem' }}>
            <Link href="/my">Back to my courses</Link>
          </Box>
        </Paper>
      </Container>
    );
  }

  const course = structure.data.structure;

  return (
    <Container disableGutters sx={{ maxWidth: '52rem !important', px: '1.25rem', pb: '6rem' }}>
      <LedgerHeader component="header" sx={{ pt: '48px', pb: '21px' }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem' }}>
          <Typography variant="h1">{course.name}</Typography>
          <Box sx={{ flex: 1 }} />
          <Link href="/my">My courses</Link>
        </Stack>
        <Eyebrow variant="overline" component="p">
          course syllabus
        </Eyebrow>
      </LedgerHeader>

      <Box component="section" sx={{ mt: '2.5rem' }}>
        {course.modules.length === 0 ? (
          <Alert>This course has no published content yet.</Alert>
        ) : (
          <CourseTree courseId={courseId} structure={course} />
        )}
      </Box>
    </Container>
  );
};
