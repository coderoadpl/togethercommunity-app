import { useEffect, type ReactNode } from 'react';
import { Box, Link, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import type { MemberNavigationCourse } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { ProgressRing } from '../../components/ui/ProgressRing.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { CardTitle, CourseCardRoot } from '../../theme.js';
import { CourseCard } from './CourseCards.js';
import { coursePercent, isCourseDone, type CourseLessonCounts } from './course-progress.js';
import { continueLessonId, flattenLessons } from './CourseRail.js';
import { MemberSurface } from './MemberSurface.js';
import { EmptyLibraryIcon } from './overview-icons.js';
import { LockedSpaceCard, SpaceCard } from './SpaceCards.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

const latestActivityCourse = (courses: MemberNavigationCourse[]): MemberNavigationCourse | null =>
  courses.reduce<MemberNavigationCourse | null>((best, course) => {
    if (course.lastActivityAt === null) return best;
    if (best?.lastActivityAt == null) return course;
    return course.lastActivityAt > best.lastActivityAt ? course : best;
  }, null);

const continueCourse = (courses: MemberNavigationCourse[]): MemberNavigationCourse | null =>
  latestActivityCourse(courses)
  ?? courses.find((course) => course.completedLessonCount < course.accessibleLessonCount)
  ?? null;

const ContinueBar = ({ course }: { course: MemberNavigationCourse }) => {
  const t = useTranslations();
  const structure = useQuery(actions.courseStructure(course.courseId));
  if (structure.data === undefined) return null;

  const targetId = continueLessonId(structure.data.structure, course.lastViewedLessonId);
  const target = flattenLessons(structure.data.structure).find(
    (lesson) => lesson.lessonId === targetId,
  );
  if (target === undefined) return null;

  const percent = coursePercent(course);
  const label = { lesson: target.name, course: course.courseName };

  return (
    <CourseCardRoot
      component={RouterLink}
      to={`/my/courses/${encodeURIComponent(course.courseId)}/lessons/${encodeURIComponent(target.lessonId)}`}
      data-testid="start-continue"
    >
      <Stack
        direction="row"
        useFlexGap
        sx={{ alignItems: 'center', columnGap: '0.9rem', p: '1.1rem 1.25rem' }}
      >
        <ProgressRing value={percent} size={32} done={isCourseDone(course)} />
        <Typography variant="body1" sx={{ flex: 1, minWidth: 0 }}>
          {target.completionStatus === 'fully-completed'
            ? t.start.reviewLabel(label)
            : t.start.continueLabel(label)}
        </Typography>
        <Typography variant="body2" color="text.secondary" component="span">
          {t.courseOverview.percentValue({ percent })}
        </Typography>
      </Stack>
    </CourseCardRoot>
  );
};

const TileSection = ({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) => (
  <Box component="section" data-testid={testId}>
    <CardTitle variant="h2" component="h2" sx={{ mb: '0.9rem' }}>
      {title}
    </CardTitle>
    <Box
      sx={{
        display: 'grid',
        gap: '1rem',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
      }}
    >
      {children}
    </Box>
  </Box>
);

export const StartPage = () => {
  const t = useTranslations();
  const navigation = useQuery(actions.memberNavigation);
  const courses = useQuery(actions.studentCourses);
  const navigate = useNavigate();
  const unauthorized = isUnauthorized(navigation.error) || isUnauthorized(courses.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (navigation.isPending || courses.isPending) {
    return (
      <MemberSurface
        title={t.start.title}
        eyebrow={t.start.eyebrow}
        state={{ kind: 'loading', label: t.common.loading }}
      />
    );
  }

  if (unauthorized) return null;

  if (navigation.isError || courses.isError) {
    const error = navigation.error ?? courses.error;
    return (
      <MemberSurface
        title={t.start.title}
        eyebrow={t.start.eyebrow}
        state={{
          kind: 'error',
          message: isForbidden(error) ? t.student.staffNoMember : localizeError(error, t),
          retry: {
            label: t.common.retry,
            onRetry: () => {
              void navigation.refetch();
              void courses.refetch();
            },
          },
        }}
      />
    );
  }

  const { spaces, courses: navigationCourses, lockedSpaces } = navigation.data.navigation;
  const counts = new Map<string, CourseLessonCounts>(
    navigationCourses.map((course) => [course.courseId, course]),
  );
  const resumable = continueCourse(navigationCourses);

  if (spaces.length === 0 && courses.data.courses.length === 0 && lockedSpaces.length === 0) {
    return (
      <MemberSurface title={t.start.title} eyebrow={t.start.eyebrow}>
        <StatusView
          state={{
            kind: 'empty',
            icon: <EmptyLibraryIcon />,
            title: t.start.emptyTitle,
            body: t.start.emptyBody,
            action: <Link component={RouterLink} to="/my/products">{t.student.myProducts}</Link>,
          }}
          data-testid="start-empty-state"
        />
      </MemberSurface>
    );
  }

  return (
    <MemberSurface title={t.start.title} eyebrow={t.start.eyebrow}>
      <Stack useFlexGap sx={{ rowGap: '2rem' }}>
        {resumable === null ? null : <ContinueBar course={resumable} />}
        {spaces.length === 0 ? null : (
          <TileSection title={t.start.spacesSection} testId="start-spaces">
            {spaces.map((space) => (
              <SpaceCard key={space.id} space={space} />
            ))}
          </TileSection>
        )}
        {courses.data.courses.length === 0 ? null : (
          <TileSection title={t.start.coursesSection} testId="start-courses">
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
          </TileSection>
        )}
        {lockedSpaces.length === 0 ? null : (
          <TileSection title={t.start.lockedSection} testId="start-locked">
            {lockedSpaces.map((space) => (
              <LockedSpaceCard key={space.id} space={space} />
            ))}
          </TileSection>
        )}
      </Stack>
    </MemberSurface>
  );
};
