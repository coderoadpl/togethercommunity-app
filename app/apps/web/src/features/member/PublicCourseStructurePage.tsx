import { Box, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import {
  CourseCoverImage,
  EmberCtaLink,
  Eyebrow,
  StatTile,
  StatTileLabel,
  StatTileValue,
} from '../../theme.js';
import { courseTotals, formatTotalDuration } from './CourseRail.js';
import { CourseTree } from './CourseTree.js';
import { MemberSurface } from './MemberSurface.js';
import { anonCrumbs } from './anon-crumbs.js';
import { EmptyCourseIcon, StatClockIcon, StatLessonsIcon } from './overview-icons.js';
import { anonHomePath } from './shell/member-nav.js';

const isNotFound = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'not_found';

export const PublicCourseStructurePage = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  const structure = useQuery(actions.publicCourseStructure(courseId));
  const navigation = useQuery(actions.publicNavigation);

  if (structure.isPending) {
    return (
      <MemberSurface
        title={t.courseTree.courseSyllabus}
        eyebrow={t.anon.eyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.courseTree.loadingCourse }}
      />
    );
  }

  if (structure.isError) {
    const notFound = isNotFound(structure.error);
    return (
      <MemberSurface
        title={notFound ? t.courseTree.courseNotFound : t.courseTree.courseSyllabus}
        eyebrow={t.anon.eyebrow}
        width={notFound ? 'prose' : 'wide'}
        state={notFound
          ? {
              kind: 'not-found',
              title: t.courseTree.courseNotFound,
              body: t.courseTree.courseNotInLibrary,
              action: <MuiLink component={Link} to={anonHomePath()}>{t.shell.start}</MuiLink>,
            }
          : {
              kind: 'error',
              message: localizeError(structure.error, t),
              retry: { label: t.common.retry, onRetry: () => void structure.refetch() },
            }}
      />
    );
  }

  const course = structure.data.structure;
  const catalogEntry = navigation.data?.navigation.courses.find((entry) => entry.id === courseId);
  const totals = courseTotals(course);
  const hasModules = course.modules.length > 0;
  const unlockProductId = course.modules
    .flatMap((module) => module.chapters)
    .flatMap((chapter) => chapter.lessons)
    .find((lesson) => lesson.unlockProductId !== undefined)?.unlockProductId;
  const unlockCta = (testId: string) =>
    unlockProductId === undefined ? null : (
      <EmberCtaLink
        variant="contained"
        component={Link}
        to={`/checkout/${encodeURIComponent(unlockProductId)}`}
        data-testid={testId}
      >
        {t.anon.unlockCta}
      </EmberCtaLink>
    );

  const programCta = unlockCta('public-course-unlock-cta-program');

  return (
    <MemberSurface
      title={course.name}
      eyebrow={t.anon.eyebrow}
      width="wide"
      breadcrumbs={anonCrumbs(t, { label: course.name })}
      actions={unlockCta('public-course-unlock-cta') ?? undefined}
    >
      <Stack useFlexGap sx={{ rowGap: '1.5rem', minWidth: 0 }}>
        <Box
          sx={{
            display: 'grid',
            gap: '0.75rem',
            gridTemplateColumns: { xs: '1fr', sm: totals.totalMinutes > 0 ? '1fr 1fr' : '1fr' },
          }}
        >
          <StatTile data-testid="stat-tile-lessons">
            <StatLessonsIcon />
            <Box sx={{ minWidth: 0 }}>
              <StatTileValue component="p">{String(totals.total)}</StatTileValue>
              <StatTileLabel component="p">
                {t.courseOverview.statLessons({ count: totals.total })}
              </StatTileLabel>
            </Box>
          </StatTile>
          {totals.totalMinutes > 0 ? (
            <StatTile data-testid="stat-tile-duration">
              <StatClockIcon />
              <Box sx={{ minWidth: 0 }}>
                <StatTileValue component="p">
                  {formatTotalDuration(t, totals.totalMinutes)}
                </StatTileValue>
                <StatTileLabel component="p">{t.courseOverview.statDuration}</StatTileLabel>
              </Box>
            </StatTile>
          ) : null}
        </Box>
        {catalogEntry?.imageUrl != null && (
          <CourseCoverImage
            src={catalogEntry.imageUrl}
            alt={t.courseOverview.coverAlt({ name: course.name })}
            data-testid="course-cover"
            sx={{ maxHeight: 320 }}
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
        {hasModules ? (
          <Box component="section" data-testid="anon-course-program">
            <Typography variant="h3" component="h2" sx={{ mb: '0.5rem' }}>
              {t.courseOverview.curriculum}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: '0.9rem' }}>
              {t.anon.lockedCourseHint}
            </Typography>
            {programCta === null ? null : <Box sx={{ mb: '0.9rem' }}>{programCta}</Box>}
            <CourseTree courseId={courseId} structure={course} expandAll />
          </Box>
        ) : (
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
