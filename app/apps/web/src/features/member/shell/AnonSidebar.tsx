import { Box, Divider, List, ListItemIcon, ListItemText, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';

import { communitySpacePath } from '#core/contract/index.js';

import { actions } from '../../../api.js';
import { TenantLogo } from '../../../branding.js';
import { useTranslations } from '../../../i18n/index.js';
import { AccountIcon } from '../account-icons.js';
import { LockClosed } from '../tree-icons.js';
import { activeNavEntry, anonHomePath, type MemberNavEntry } from './member-nav.js';
import { BrandLink, NavRow, type ShellLinkProps, type ShellVariant } from './shell-chrome.js';
import { CourseOverviewIcon, SpaceIcon, StartIcon } from './shell-icons.js';
import { LinkRow, SidebarError, SidebarLoading } from './sidebar-rows.js';

const AnonNavigationList = ({ active }: { active: MemberNavEntry | null }) => {
  const t = useTranslations();
  const navigation = useQuery(actions.publicNavigation);

  if (navigation.isPending) return <SidebarLoading />;

  if (navigation.isError) {
    return <SidebarError error={navigation.error} onRetry={() => void navigation.refetch()} />;
  }

  const { spaces, courses, lockedSpaces } = navigation.data.navigation;

  return (
    <List component="div" disablePadding>
      {spaces.map((space) => (
        <LinkRow
          key={space.id}
          to={communitySpacePath(space.id)}
          label={space.name}
          icon={<SpaceIcon />}
          active={active?.kind === 'space' && active.spaceId === space.id}
          testId={`anon-sidebar-space-${space.id}`}
        />
      ))}
      {courses.map((course) => (
        <LinkRow
          key={course.id}
          to={`/my/courses/${encodeURIComponent(course.id)}`}
          label={course.name}
          icon={<CourseOverviewIcon />}
          active={active?.kind === 'course' && active.courseId === course.id}
          testId={`anon-sidebar-course-${course.id}`}
        />
      ))}
      {lockedSpaces.map((space) => {
        const productId = space.productIds[0];
        const linkProps: ShellLinkProps & { disabled?: boolean } = productId === undefined
          ? { component: 'div', disabled: true }
          : { component: Link, to: `/checkout/${encodeURIComponent(productId)}` };
        return (
          <Tooltip key={space.id} title={t.shell.lockedSpaceHint}>
            <NavRow {...linkProps} data-testid={`anon-sidebar-locked-${space.id}`}>
              <ListItemIcon>
                <LockClosed />
              </ListItemIcon>
              <ListItemText primary={space.name} slotProps={{ primary: { noWrap: true } }} />
            </NavRow>
          </Tooltip>
        );
      })}
    </List>
  );
};

export const AnonSidebar = ({ variant }: { variant: ShellVariant }) => {
  const t = useTranslations();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = activeNavEntry(pathname);

  return (
    <Box
      component="nav"
      aria-label={t.shell.navigationAria}
      data-testid="anon-sidebar"
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
      {variant === 'drawer' ? (
        <BrandLink
          component={Link}
          to={anonHomePath()}
          data-testid="anon-sidebar-brand"
          sx={{ px: '0.6rem', pb: '0.9rem' }}
        >
          <TenantLogo />
        </BrandLink>
      ) : null}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <List component="div" disablePadding>
          <LinkRow
            to={anonHomePath()}
            label={t.shell.start}
            icon={<StartIcon />}
            active={active?.kind === 'start'}
            testId="anon-sidebar-start"
          />
        </List>
        <Typography variant="overline" component="p" sx={{ px: '0.6rem', pt: '0.75rem' }}>
          {t.shell.spacesSection}
        </Typography>
        <AnonNavigationList active={active} />
      </Box>
      <Divider sx={{ my: '0.5rem' }} />
      <List component="div" disablePadding>
        <LinkRow
          to="/login"
          label={t.auth.signInLink}
          icon={<AccountIcon />}
          active={false}
          testId="anon-sidebar-signin"
        />
      </List>
    </Box>
  );
};
