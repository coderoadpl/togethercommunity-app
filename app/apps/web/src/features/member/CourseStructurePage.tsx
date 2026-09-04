import { useEffect } from 'react';
import { Box, Link as MuiLink, Paper, Stack, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import type { CourseStructureWithAccess } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import {
  CourseCoverImage,
  CourseStatTile,
  Eyebrow,
  StatTileLabel,
  StatTileValue,
} from '../../theme.js';
import { courseTotals, CourseProgressCard, formatTotalDuration } from './CourseRail.js';
import { CourseDiscussionSearch } from './CourseDiscussionSearch.js';
import { CourseTree } from './CourseTree.js';
import { MemberSurface } from './MemberSurface.js';
import { EmptyCourseIcon, StatClockIcon, StatLessonsIcon } from './overview-icons.js';
import { PublicCourseStructurePage } from './PublicCourseStructurePage.js';
import { useViewerKind } from './viewer.js';

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
    ...(totals.totalMinutes > 0
      ? [
          {
            key: 'duration',
            icon: <StatClockIcon />,
            value: formatTotalDuration(t, totals.totalMinutes),
            label: t.courseOverview.statDuration,
          },
        ]
      : []),
  ];
  return (
    <Box
      sx={{
        display: 'grid',
        gap: '0.75rem',
        gridTemplateColumns: {
          xs: 'repeat(auto-fit, minmax(9rem, 1fr))',
          sm: `repeat(${Math.max(tiles.length, 2)}, 1fr)`,
        },
      }}
    >
      {tiles.map((tile) => (
        <CourseStatTile key={tile.key} data-testid={`stat-tile-${tile.key}`}>
          {tile.icon}
          <Box sx={{ minWidth: 0 }}>
            <StatTileValue component="p">{tile.value}</StatTileValue>
            <StatTileLabel component="p">{tile.label}</StatTileLabel>
          </Box>
        </CourseStatTile>
      ))}
    </Box>
  );
};

export const CourseStructurePage = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  const viewer = useViewerKind();

  if (viewer === 'pending') {
    return (
      <MemberSurface
        title={t.student.myCourses}
        eyebrow={t.student.courseEyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.courseTree.loadingCourse }}
      />
    );
  }

  return viewer === 'anonymous' ? (
    <PublicCourseStructurePage courseId={courseId} />
  ) : (
    <MemberCourseStructurePage courseId={courseId} />
  );
};

const MemberCourseStructurePage = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  const structure = useQuery(actions.courseStructure(courseId));
  const progress = useQuery(actions.studentProgress(courseId));
  const courses = useQuery(actions.studentCourses);
  const navigate = useNavigate();
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));
  const unauthorized = isUnauthorized(structure.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (structure.isPending) {
    return (
      <MemberSurface
        title={t.student.myCourses}
        eyebrow={t.student.courseEyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.courseTree.loadingCourse }}
      />
    );
  }

  if (unauthorized) return null;

  if (structure.isError) {
    const notFound = isNotFound(structure.error);
    return (
      <MemberSurface
        title={notFound ? t.courseTree.courseNotFound : t.student.myCourses}
        eyebrow={t.student.courseEyebrow}
        width={notFound ? 'prose' : 'wide'}
        state={notFound
          ? {
              kind: 'not-found',
              title: t.courseTree.courseNotFound,
              body: t.courseTree.courseNotInLibrary,
              action: <MuiLink component={Link} to="/my">{t.courseTree.backToMyCourses}</MuiLink>,
            }
          : {
              kind: 'error',
              message: isForbidden(structure.error) ? t.student.staffNoMember : localizeError(structure.error, t),
              retry: { label: t.common.retry, onRetry: () => void structure.refetch() },
            }}
      />
    );
  }

  const course = structure.data.structure;
  const catalogEntry = courses.data?.courses.find((entry) => entry.id === courseId);
  const hasModules = course.modules.length > 0;

  return (
    <MemberSurface
      title={course.name}
      eyebrow={t.student.courseEyebrow}
      width="wide"
      mobileRail="split"
      railLeading={
        <>
          <CourseProgressCard
            courseId={courseId}
            structure={course}
            lastViewedLessonId={progress.data?.progress.lastViewedLessonId}
          />
          {hasModules && isCompact ? (
            <Box data-testid="course-tree-inline">
              <Typography variant="overline" component="h2">
                {t.courseOverview.curriculum}
              </Typography>
              <CourseTree courseId={courseId} structure={course} initiallyCollapsed />
            </Box>
          ) : null}
        </>
      }
      rail={hasModules ? <CourseDiscussionSearch courseId={courseId} structure={course} /> : undefined}
    >
      <Stack useFlexGap sx={{ rowGap: '1.5rem', minWidth: 0 }}>
        {progress.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(progress.error, t), retry: { label: t.common.retry, onRetry: () => void progress.refetch() } }} /> : null}
        {courses.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(courses.error, t), retry: { label: t.common.retry, onRetry: () => void courses.refetch() } }} /> : null}
        <CourseStatTiles structure={course} />
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
          <StatusView
            state={{
              kind: 'empty',
              icon: <EmptyCourseIcon />,
              title: t.courseTree.emptyCourseTitle,
              body: t.courseTree.noPublishedContent,
            }}
            data-testid="course-empty-state"
          />
        )}
      </Stack>
    </MemberSurface>
  );
};
