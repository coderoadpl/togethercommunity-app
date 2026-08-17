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
import { CourseTree } from '../CourseTree.js';
import { memberHomePath } from './member-nav.js';
import { BrandLink, type ShellVariant } from './shell-chrome.js';
import { BackIcon, CourseOverviewIcon } from './shell-icons.js';
import { LinkRow, SidebarError, SidebarLoading } from './sidebar-rows.js';

const CourseHeader = ({ structure }: { structure: CourseStructureWithAccess }) => {
  const t = useTranslations();
  const totals = courseTotals(structure);
  const done = totals.total > 0 && totals.done === totals.total;

  return (
    <Box sx={{ px: '0.6rem', pb: '0.75rem' }} data-testid="course-sidebar-header">
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.5rem' }}>
        <ProgressRing value={totals.percent} done={done} />
        <Typography variant="body2" component="p" noWrap sx={{ minWidth: 0 }}>
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
        variant="caption"
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
        px: '0.6rem',
        pt: '0.5rem',
        pb: '0.75rem',
      }}
    >
      <BrandLink
        component={Link}
        to={memberHomePath()}
        data-testid="course-sidebar-back"
        sx={{ px: '0.6rem', pb: '0.9rem', columnGap: '0.4rem' }}
      >
        <BackIcon />
        <Typography variant="body2" component="span" noWrap>
          {t.shell.backTo({ name: tenantName })}
        </Typography>
      </BrandLink>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {structure.isPending ? <SidebarLoading /> : null}
        {structure.isError ? (
          <SidebarError error={structure.error} onRetry={() => void structure.refetch()} />
        ) : null}
        {structure.isSuccess ? (
          <>
            <CourseHeader structure={structure.data.structure} />
            <List component="div" disablePadding>
              <LinkRow
                to={`/my/courses/${encodeURIComponent(courseId)}`}
                label={t.shell.courseOverviewEntry}
                icon={<CourseOverviewIcon />}
                active={currentLessonId === null}
                testId="course-sidebar-overview"
              />
            </List>
            <Typography variant="overline" component="p" sx={{ px: '0.6rem', pt: '0.75rem' }}>
              {t.courseOverview.curriculum}
            </Typography>
            <CourseTree
              courseId={courseId}
              structure={structure.data.structure}
              {...(currentLessonId === null ? {} : { currentLessonId })}
            />
          </>
        ) : null}
      </Box>
      {variant === 'drawer' ? (
        <>
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
        </>
      ) : null}
    </Box>
  );
};
