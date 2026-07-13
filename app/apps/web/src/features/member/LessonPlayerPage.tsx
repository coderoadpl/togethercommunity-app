import { useEffect } from 'react';
import { Box, Container, Link, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { CardTitle, Eyebrow, LedgerHeader } from '../../theme.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

export const LessonPlayerPage = ({
  courseId,
  lessonId,
}: {
  courseId: string;
  lessonId: string;
}) => {
  const lesson = useQuery(actions.studentLesson(lessonId));
  const navigate = useNavigate();
  const unauthorized = isUnauthorized(lesson.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  const backLink = <Link href={`/my/courses/${courseId}`}>Back to course</Link>;

  if (lesson.isPending) {
    return (
      <Container sx={{ maxWidth: '52rem', py: 6 }}>
        <Typography variant="h2" component="p">
          loading lesson…
        </Typography>
      </Container>
    );
  }

  if (unauthorized) return null;

  if (lesson.isError) {
    const locked = isForbidden(lesson.error);
    return (
      <Container sx={{ maxWidth: '52rem', py: 6 }}>
        <Paper elevation={1} sx={{ p: '1.5rem' }}>
          <CardTitle variant="h1">{locked ? 'Content locked' : 'Lesson unavailable'}</CardTitle>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            {locked
              ? 'You may need to upgrade or enroll to view this lesson.'
              : lesson.error.message}
          </Typography>
          <Box sx={{ mt: '1rem' }}>{backLink}</Box>
        </Paper>
      </Container>
    );
  }

  return (
    <Container disableGutters sx={{ maxWidth: '52rem !important', px: '1.25rem', pb: '6rem' }}>
      <LedgerHeader component="header" sx={{ pt: '48px', pb: '21px' }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem' }}>
          <Typography variant="h1">{lesson.data.lesson.name}</Typography>
          <Box sx={{ flex: 1 }} />
          {backLink}
        </Stack>
        <Eyebrow variant="overline" component="p">
          lesson
        </Eyebrow>
      </LedgerHeader>

      <Box component="section" sx={{ mt: '2.5rem' }}>
        <Paper elevation={1} sx={{ p: '1.5rem' }}>
          <CardTitle variant="h1">Lesson player coming soon</CardTitle>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            This lesson has {lesson.data.lesson.contents.length} content block(s). The player lands
            in the next stage.
          </Typography>
        </Paper>
      </Box>
    </Container>
  );
};
