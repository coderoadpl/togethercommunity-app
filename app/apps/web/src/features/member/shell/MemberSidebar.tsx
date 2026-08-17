import { Box, Divider, List, ListItemIcon, ListItemText, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';

import { actions } from '../../../api.js';
import { TenantLogo } from '../../../branding.js';
import { ProgressRing } from '../../../components/ui/ProgressRing.js';
import { useTranslations } from '../../../i18n/index.js';
import { NotificationBell } from '../../../NotificationBell.js';
import { AccountIcon } from '../account-icons.js';
import { coursePercent, isCourseDone } from '../course-progress.js';
import { LockClosed } from '../tree-icons.js';
import {
  activeNavEntry,
  memberHomePath,
  memberSearchPath,
  type MemberNavEntry,
} from './member-nav.js';
import {
  BrandLink,
  IdentityAvatar,
  IdentityRow,
  NavRow,
  type ShellLinkProps,
  type ShellVariant,
} from './shell-chrome.js';
import { ProductsIcon, SearchIcon, SpaceIcon, StartIcon } from './shell-icons.js';
import { LinkRow, SidebarError, SidebarLoading } from './sidebar-rows.js';

const memberInitials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => (word[0] ?? '').toLocaleUpperCase())
    .join('');

const NavigationList = ({ active }: { active: MemberNavEntry | null }) => {
  const t = useTranslations();
  const navigation = useQuery(actions.memberNavigation);

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
          to={`/community/${encodeURIComponent(space.id)}`}
          label={space.name}
          icon={<SpaceIcon />}
          active={active?.kind === 'space' && active.spaceId === space.id}
          testId={`sidebar-space-${space.id}`}
        />
      ))}
      {courses.map((course) => {
        const percent = coursePercent(course);
        const done = isCourseDone(course);
        return (
          <NavRow
            key={course.courseId}
            component={Link}
            to={`/my/courses/${encodeURIComponent(course.courseId)}`}
            selected={active?.kind === 'course' && active.courseId === course.courseId}
            aria-current={
              active?.kind === 'course' && active.courseId === course.courseId ? 'page' : undefined
            }
            aria-label={t.shell.courseProgressLabel({ name: course.courseName, percent })}
            data-testid={`sidebar-course-${course.courseId}`}
          >
            <ListItemIcon>
              <ProgressRing value={percent} done={done} />
            </ListItemIcon>
            <ListItemText
              primary={course.courseName}
              slotProps={{ primary: { noWrap: true } }}
            />
            {done ? null : (
              <Typography variant="caption" color="text.secondary" component="span">
                {`${percent}%`}
              </Typography>
            )}
          </NavRow>
        );
      })}
      {lockedSpaces.map((space) => {
        const productId = space.productIds[0];
        const linkProps: ShellLinkProps & { disabled?: boolean } = productId === undefined
          ? { component: 'div', disabled: true }
          : { component: Link, to: `/checkout/${encodeURIComponent(productId)}` };
        return (
          <Tooltip key={space.id} title={t.shell.lockedSpaceHint}>
            <NavRow {...linkProps} data-testid={`sidebar-locked-${space.id}`}>
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

export const MemberSidebar = ({
  name,
  email,
  variant,
}: {
  name: string;
  email: string;
  variant: ShellVariant;
}) => {
  const t = useTranslations();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = activeNavEntry(pathname);

  return (
    <Box
      component="nav"
      aria-label={t.shell.navigationAria}
      data-testid="member-sidebar"
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
          to={memberHomePath()}
          data-testid="sidebar-brand"
          sx={{ px: '0.6rem', pb: '0.9rem' }}
        >
          <TenantLogo />
        </BrandLink>
      ) : null}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <List component="div" disablePadding>
          <LinkRow
            to={memberHomePath()}
            label={t.shell.start}
            icon={<StartIcon />}
            active={active?.kind === 'start'}
            testId="sidebar-start"
          />
          <LinkRow
            to={memberSearchPath()}
            label={t.shell.searchEntry}
            icon={<SearchIcon />}
            active={active?.kind === 'search'}
            testId="sidebar-search"
          />
        </List>
        <Typography variant="overline" component="p" sx={{ px: '0.6rem', pt: '0.75rem' }}>
          {t.shell.spacesSection}
        </Typography>
        <NavigationList active={active} />
      </Box>
      <Divider sx={{ my: '0.5rem' }} />
      <List component="div" disablePadding>
        <LinkRow
          to="/my/products"
          label={t.student.myProducts}
          icon={<ProductsIcon />}
          active={active?.kind === 'products'}
          testId="sidebar-products"
        />
        {variant === 'drawer' ? <NotificationBell navLabel={t.notifications.bell} /> : null}
        <LinkRow
          to="/account"
          label={t.account.menuAccount}
          icon={<AccountIcon />}
          active={active?.kind === 'account'}
          testId="sidebar-account"
        />
      </List>
      <IdentityRow component={Link} to="/account" data-testid="member-identity">
        <IdentityAvatar aria-hidden>{memberInitials(name)}</IdentityAvatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" component="p" noWrap>
            {name}
          </Typography>
          <Typography variant="caption" component="p" color="text.secondary" noWrap>
            {email}
          </Typography>
        </Box>
      </IdentityRow>
    </Box>
  );
};
