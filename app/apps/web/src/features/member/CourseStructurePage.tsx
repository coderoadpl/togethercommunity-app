import { useEffect } from 'react';
import { Box, Container, Link, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';
import type { CourseStructureWithAccess } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import {
  CardTitle,
  CourseCoverImage,
  EmptyStateContent,
  Eyebrow,
  LedgerHeader,
  StatTile,
  StatTileLabel,
  StatTileValue,
} from '../../theme.js';
import {
  courseTotals,
  CourseProgressCard,
  CurriculumCard,
  formatTotalDuration,
} from './CourseRail.js';
import { EmptyCourseIcon, StatCheckIcon, StatClockIcon, StatLessonsIcon } from './overview-icons.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

const isNotFound = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'not_found';

const CourseStatTiles = ({ structure }: { structure: CourseStructureWithAccess }) => {
  const t = useTranslations();
  const totals = courseTotals(structure);
  const tiles = [
    {
      key: 'lessons',
      icon: <StatLessonsIcon />,
      value: `${totals.total}`,
      label: t.courseOverview.statLessons({ count: totals.total }),
    },
    {
      key: 'duration',
      icon: <StatClockIcon />,
      value: formatTotalDuration(t, totals.totalMinutes),
      label: t.courseOverview.statDuration,
    },
    {
      key: 'completed',
      icon: <StatCheckIcon />,
      value: t.courseOverview.percentValue({ percent: totals.percent }),
      label: t.courseOverview.statCompleted,
    },
  ];
  return (
    <Box
      sx={{
        display: 'grid',
        gap: '0.75rem',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
      }}
    >
      {tiles.map((tile) => (
        <StatTile key={tile.key} data-testid={`stat-tile-${tile.key}`}>
          {tile.icon}
          <Box sx={{ minWidth: 0 }}>
            <StatTileValue component="p">{tile.value}</StatTileValue>
            <StatTileLabel component="p">{tile.label}</StatTileLabel>
          </Box>
        </StatTile>
      ))}
    </Box>
  );
};

export const CourseStructurePage = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  const structure = useQuery(actions.courseStructure(courseId));
  const progress = useQuery(actions.studentProgress(courseId));
  const courses = useQuery(actions.studentCourses);
  const navigate = useNavigate();
  const unauthorized = isUnauthorized(structure.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (structure.isPending) {
    return (
      <Container sx={{ maxWidth: '52rem', py: 6 }}>
        <Typography variant="h2" component="p">
          {t.courseTree.loadingCourse}
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
            {isNotFound(structure.error) ? t.courseTree.courseNotFound : t.courseTree.courseUnavailable}
          </CardTitle>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            {isForbidden(structure.error)
              ? t.student.staffNoMember
              : isNotFound(structure.error)
                ? t.courseTree.courseNotInLibrary
                : localizeError(structure.error, t)}
          </Typography>
          <Box sx={{ mt: '1rem' }}>
            <Link href="/my">{t.courseTree.backToMyCourses}</Link>
          </Box>
        </Paper>
      </Container>
    );
  }

  const course = structure.data.structure;
  const catalogEntry = courses.data?.courses.find((entry) => entry.id === courseId);
  const hasModules = course.modules.length > 0;

  return (
    <Container disableGutters sx={{ maxWidth: '72rem !important', px: '1.25rem', pb: '6rem' }}>
      <LedgerHeader component="header" sx={{ pt: '48px', pb: '21px' }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem' }}>
          <Typography variant="h1">{course.name}</Typography>
          <Box sx={{ flex: 1 }} />
          <Link href="/my">{t.student.myCourses}</Link>
        </Stack>
        <Eyebrow variant="overline" component="p">
          {t.courseTree.courseSyllabus}
        </Eyebrow>
      </LedgerHeader>

      <Box component="section" sx={{ mt: '1.5rem' }}>
        <CourseStatTiles structure={course} />
      </Box>

      <Box
        component="section"
        sx={{
          mt: '1.5rem',
          display: 'grid',
          gap: '1.5rem',
          alignItems: 'start',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 24rem' },
        }}
      >
        <Stack useFlexGap sx={{ rowGap: '1.5rem', order: { xs: 2, md: 1 }, minWidth: 0 }}>
          {catalogEntry?.imageUrl != null && (
            <CourseCoverImage
              src={catalogEntry.imageUrl}
              alt={t.courseOverview.coverAlt({ name: course.name })}
              data-testid="course-cover"
            />
          )}
          {catalogEntry !== undefined && catalogEntry.description !== '' && (
            <Paper elevation={1} sx={{ p: '1.5rem' }}>
              <Eyebrow variant="overline" component="p" sx={{ mb: '0.75rem' }}>
                {t.courseOverview.aboutCourse}
              </Eyebrow>
              <Typography variant="body1">{catalogEntry.description}</Typography>
            </Paper>
          )}
          {!hasModules && (
            <Paper elevation={1} sx={{ p: '2.5rem' }} data-testid="course-empty-state">
              <EmptyStateContent useFlexGap sx={{ rowGap: '0.75rem' }}>
                <EmptyCourseIcon />
                <CardTitle variant="h2">{t.courseTree.emptyCourseTitle}</CardTitle>
                <Typography variant="body1">{t.courseTree.noPublishedContent}</Typography>
              </EmptyStateContent>
            </Paper>
          )}
        </Stack>

        <Stack
          useFlexGap
          sx={{
            rowGap: '1.5rem',
            order: { xs: 1, md: 2 },
            position: { md: 'sticky' },
            top: { md: '1.5rem' },
            maxHeight: { md: 'calc(100vh - 3rem)' },
            overflowY: { md: 'auto' },
          }}
        >
          <CourseProgressCard
            courseId={courseId}
            structure={course}
            lastViewedLessonId={progress.data?.progress.lastViewedLessonId}
          />
          {hasModules && <CurriculumCard courseId={courseId} structure={course} />}
        </Stack>
      </Box>
    </Container>
  );
};
