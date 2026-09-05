import { useMemo } from 'react';
import { Box, Divider, List, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { CourseStructureWithAccess } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ProgressRing } from '../../../components/ui/ProgressRing.js';
import { useTranslations } from '../../../i18n/index.js';
import { NotificationBell } from '../../../NotificationBell.js';
import { RailProgressBar } from '../../../theme.js';
import { AccountIcon } from '../account-icons.js';
import { courseTotals } from '../CourseRail.js';
import { focusLesson } from '../course-tree-state.js';
import { CourseTree } from '../CourseTree.js';
import { spacesForCourse } from './course-spaces.js';
import { memberHomePath } from './member-nav.js';
import { BrandLink, type ShellVariant } from './shell-chrome.js';
import { BackIcon, CourseOverviewIcon, SpaceIcon } from './shell-icons.js';
import { LinkRow, SidebarError, SidebarLoading } from './sidebar-rows.js';

const CourseHeader = ({ structure }: { structure: CourseStructureWithAccess }) => {
  const t = useTranslations();
  const totals = courseTotals(structure);
  const done = totals.total > 0 && totals.done === totals.total;

  return (
    <Box sx={{ px: '0.6rem', pb: '0.75rem' }} data-testid="course-sidebar-header">
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.5rem' }}>
        <ProgressRing value={totals.percent} done={done} />
        <Typography variant="subtitle1" component="p" noWrap sx={{ minWidth: 0 }}>
          {structure.name}
        </Typography>
      </Stack>
      <RailProgressBar
        variant="determinate"
        value={totals.percent}
        sx={{ mt: '0.6rem' }}
        aria-label={t.courseOverview.progressTitle}
      />
      <Typography
        variant="body2"
        component="p"
        color="text.secondary"
        sx={{ mt: '0.35rem' }}
        data-testid="course-sidebar-totals"
      >
        {`${t.courseOverview.percentValue({ percent: totals.percent })} · ${t.shell.lessonsOf({
          done: totals.done,
          total: totals.total,
        })}`}
      </Typography>
    </Box>
  );
};

const CourseSpaceRows = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  const navigation = useQuery(actions.memberNavigation);
  if (!navigation.isSuccess) return null;

  const spaces = spacesForCourse(navigation.data.navigation.spaces, courseId);
  return (
    <>
      {spaces.map((space) => (
        <LinkRow
          key={space.id}
          to={`/community/${encodeURIComponent(space.id)}`}
          label={spaces.length === 1 ? t.shell.courseSpaceEntry : space.name}
          icon={<SpaceIcon />}
          active={false}
          testId={`course-sidebar-space-${space.id}`}
        />
      ))}
    </>
  );
};

export const CourseSidebar = ({
  courseId,
  currentLessonId,
  tenantName,
  variant,
}: {
  courseId: string;
  currentLessonId: string | null;
  tenantName: string;
  variant: ShellVariant;
}) => {
  const t = useTranslations();
  const structure = useQuery(actions.courseStructure(courseId));
  const progress = useQuery(actions.studentProgress(courseId));
  const tree = structure.data?.structure;
  const lastViewedLessonId = progress.data?.progress.lastViewedLessonId;
  const waitingForLastViewed = currentLessonId === null && progress.isPending;
  const focusLessonId = useMemo(
    () =>
      tree === undefined || waitingForLastViewed
        ? null
        : focusLesson(tree, { currentLessonId, lastViewedLessonId }),
    [tree, waitingForLastViewed, currentLessonId, lastViewedLessonId],
  );

  return (
    <Box
      component="nav"
      aria-label={t.shell.navigationAria}
      data-testid="course-sidebar"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        px: '0.6rem',
        pt: '0.5rem',
        pb: '0.75rem',
      }}
    >
      <BrandLink
        component={Link}
        to={memberHomePath()}
        data-testid="course-sidebar-back"
        sx={{ px: '0.6rem', pb: '0.9rem', columnGap: '0.4rem', flexShrink: 0 }}
      >
        <BackIcon />
        <Typography variant="body1" component="span" noWrap>
          {t.shell.backTo({ name: tenantName })}
        </Typography>
      </BrandLink>
      {structure.isPending || structure.isError ? (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {structure.isError ? (
            <SidebarError error={structure.error} onRetry={() => void structure.refetch()} />
          ) : (
            <SidebarLoading />
          )}
        </Box>
      ) : null}
      {tree === undefined ? null : (
        <>
          <Box sx={{ flexShrink: 0 }} data-testid="course-sidebar-pinned">
            <CourseHeader structure={tree} />
            <List component="div" disablePadding>
              <LinkRow
                to={`/my/courses/${encodeURIComponent(courseId)}`}
                label={t.shell.courseOverviewEntry}
                icon={<CourseOverviewIcon />}
                active={currentLessonId === null}
                testId="course-sidebar-overview"
              />
              <CourseSpaceRows courseId={courseId} />
            </List>
            <Typography
              variant="overline"
              component="p"
              sx={{ px: '0.6rem', pt: '0.75rem', pb: '0.35rem' }}
            >
              {t.courseOverview.curriculum}
            </Typography>
          </Box>
          <CourseTree
            courseId={courseId}
            structure={tree}
            focusLessonId={focusLessonId}
            scrollFocusIntoView
            {...(currentLessonId === null ? {} : { currentLessonId })}
          />
        </>
      )}
      {variant === 'drawer' ? (
        <Box sx={{ flexShrink: 0 }}>
          <Divider sx={{ my: '0.5rem' }} />
          <List component="div" disablePadding>
            <NotificationBell navLabel={t.notifications.bell} />
            <LinkRow
              to="/account"
              label={t.account.menuAccount}
              icon={<AccountIcon />}
              active={false}
              testId="course-sidebar-account"
            />
          </List>
        </Box>
      ) : null}
    </Box>
  );
};
