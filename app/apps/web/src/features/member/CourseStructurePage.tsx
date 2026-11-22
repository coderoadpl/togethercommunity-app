import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Paper, Stack, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import type { CourseStructureWithAccess } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { Cover } from '../../components/ui/Cover.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { useRedirectToLogin } from './use-login-redirect.js';
import {
  CourseStatTile,
  Eyebrow,
  StatTileLabel,
  StatTileValue,
} from '../../theme.js';
import { courseTotals, CourseProgressCard, formatTotalDuration } from './CourseRail.js';
import { CourseDiscussionSearch } from './CourseDiscussionSearch.js';
import { focusLesson } from './course-tree-state.js';
import { CourseTree } from './CourseTree.js';
import { CourseLoading } from './CourseLoading.js';
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

const ABOUT_CLAMP_LINES = 5;

const AboutCourseCard = ({ description, clamp }: { description: string; clamp: boolean }) => {
  const t = useTranslations();
  const textId = useId();
  const text = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const collapsed = clamp && !expanded;

  useLayoutEffect(() => {
    const element = text.current;
    if (element === null || !collapsed) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [collapsed, description]);

  return (
    <Paper elevation={1} sx={{ p: '1.25rem' }} data-testid="course-about-card">
      <Eyebrow variant="overline" component="p" sx={{ mb: '0.75rem' }}>
        {t.courseOverview.aboutCourse}
      </Eyebrow>
      <Typography
        ref={text}
        id={textId}
        variant="body1"
        data-testid="course-about-text"
        data-collapsed={collapsed}
        sx={collapsed ? {
          display: '-webkit-box',
          WebkitLineClamp: ABOUT_CLAMP_LINES,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        } : undefined}
      >
        {description}
      </Typography>
      {clamp && (expanded || overflowing) ? (
        <Button
          variant="text"
          sx={{ mt: '0.5rem' }}
          aria-controls={textId}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          data-testid="course-about-toggle"
        >
          {expanded ? t.courseOverview.aboutShowLess : t.courseOverview.aboutShowMore}
        </Button>
      ) : null}
    </Paper>
  );
};

const CourseProgramSection = ({
  courseId,
  structure,
  focusLessonId,
  nextLessonId,
}: {
  courseId: string;
  structure: CourseStructureWithAccess;
  focusLessonId: string | null;
  nextLessonId: string | null;
}) => {
  const t = useTranslations();
  const headingId = useId();
  return (
    <Paper
      elevation={1}
      component="section"
      aria-labelledby={headingId}
      data-testid="course-tree-inline"
      sx={{ p: '1.25rem' }}
    >
      <Eyebrow variant="overline" component="h2" id={headingId} sx={{ mb: '0.75rem' }}>
        {t.courseOverview.curriculum}
      </Eyebrow>
      <CourseTree courseId={courseId} structure={structure} focusLessonId={focusLessonId} nextLessonId={nextLessonId} />
    </Paper>
  );
};

export const CourseStructurePage = ({ courseId }: { courseId: string }) => {
  const viewer = useViewerKind();

  if (viewer === 'pending') {
    return <CourseLoading lesson={false} />;
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
  const redirectToLogin = useRedirectToLogin();
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));
  const unauthorized = isUnauthorized(structure.error);
  const loadedStructure = structure.data?.structure;
  const lastViewedLessonId = progress.data?.progress.lastViewedLessonId;
  const waitingForLastViewed = progress.isPending;
  const focusLessonId = useMemo(
    () =>
      loadedStructure === undefined || waitingForLastViewed
        ? null
        : focusLesson(loadedStructure, { lastViewedLessonId }),
    [loadedStructure, waitingForLastViewed, lastViewedLessonId],
  );

  useEffect(() => {
    if (unauthorized) void redirectToLogin();
  }, [redirectToLogin, unauthorized]);

  if (structure.isPending) {
    return <CourseLoading lesson={false} />;
  }

  if (unauthorized) return null;

  if (structure.isError) {
    const notFound = isNotFound(structure.error);
    if (notFound) {
      return (
        <MemberSurface
          title={t.courseTree.courseNotFound}
          eyebrow={t.student.courseEyebrow}
          width="wide"
          state={{
            kind: 'not-found',
            title: t.courseTree.courseUnavailable,
            body: `${t.courseTree.courseNotInLibrary} ${t.courseTree.renewInMyProducts}`,
            action: (
              <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', justifyContent: 'center', gap: '0.5rem' }}>
                <Button component={Link} to="/my" variant="contained">
                  {t.courseTree.backToMyCourses}
                </Button>
                <Button component={Link} to="/my/products" variant="text">
                  {t.student.myProducts}
                </Button>
              </Stack>
            ),
          }}
        />
      );
    }

    return (
      <MemberSurface
        title={t.courseTree.courseUnavailable}
        eyebrow={t.student.courseEyebrow}
        width="wide"
        state={{
          kind: 'error',
          message: isForbidden(structure.error) ? t.student.staffNoMember : localizeError(structure.error, t),
          retry: { label: t.common.retry, onRetry: () => void structure.refetch() },
          action: (
            <Button component={Link} to="/my" variant="text">
              {t.courseTree.backToMyCourses}
            </Button>
          ),
        }}
      />
    );
  }

  const course = structure.data.structure;
  const catalogEntry = courses.data?.courses.find((entry) => entry.id === courseId);
  const hasModules = course.modules.length > 0;
  const aboutCard = catalogEntry !== undefined && catalogEntry.description !== '' ? (
    <AboutCourseCard description={catalogEntry.description} clamp={isCompact} />
  ) : null;
  const discussionSearch = hasModules ? (
    <CourseDiscussionSearch courseId={courseId} structure={course} />
  ) : null;
  const progressCard = hasModules ? (
    <CourseProgressCard
      courseId={courseId}
      structure={course}
      resume={progress.data?.progress.resume}
    />
  ) : null;
  const statTiles = hasModules ? <CourseStatTiles structure={course} /> : null;
  const cover = catalogEntry === undefined ? null : (
    <Cover
      src={catalogEntry.imageUrl}
      title={course.name}
      alt={t.courseOverview.coverAlt({ name: course.name })}
      frame="standalone"
      whenMissing="omit"
      testId="course-cover"
      fallbackTestId="course-cover-fallback"
    />
  );
  const program = hasModules ? (
    <CourseProgramSection
      courseId={courseId}
      structure={course}
      focusLessonId={focusLessonId}
      nextLessonId={progress.data?.progress.resume?.target?.id ?? null}
    />
  ) : null;
  const emptyState = !hasModules ? (
    <StatusView
      state={{
        kind: 'empty',
        icon: <EmptyCourseIcon />,
        title: t.courseTree.emptyCourseTitle,
        body: t.courseTree.noPublishedContent,
      }}
      data-testid="course-empty-state"
    />
  ) : null;
  const compactSections = (
    <>
      {progressCard}
      {program}
      {emptyState}
      {statTiles}
      {cover}
      {aboutCard}
      {discussionSearch}
    </>
  );
  const desktopSections = (
    <>
      {statTiles}
      {program}
      {cover}
      {aboutCard}
      {emptyState}
    </>
  );

  return (
    <MemberSurface
      title={course.name}
      eyebrow={t.student.courseEyebrow}
      width="wide"
      mobileRail="split"
      railLeading={hasModules && !isCompact ? progressCard : undefined}
      rail={hasModules && !isCompact ? discussionSearch : undefined}
    >
      <Stack useFlexGap sx={{ rowGap: '1.5rem', minWidth: 0 }}>
        {progress.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(progress.error, t), retry: { label: t.common.retry, onRetry: () => void progress.refetch() } }} /> : null}
        {courses.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(courses.error, t), retry: { label: t.common.retry, onRetry: () => void courses.refetch() } }} /> : null}
        {isCompact ? compactSections : desktopSections}
      </Stack>
    </MemberSurface>
  );
};
