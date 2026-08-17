import { Typography } from '@mui/material';
import { Link, useRouterState } from '@tanstack/react-router';

import { useTranslations } from '../../../i18n/index.js';
import { activeNavEntry, memberHomePath, memberSearchPath } from './member-nav.js';
import { TabBar, TabButton } from './shell-chrome.js';
import { MenuIcon, SearchIcon, StartIcon } from './shell-icons.js';

const TabLabel = ({ label }: { label: string }) => (
  <Typography variant="caption" component="span" noWrap title={label} sx={{ maxWidth: '100%' }}>
    {label}
  </Typography>
);

export const MemberBottomBar = ({
  menuOpen,
  onOpenMenu,
}: {
  menuOpen: boolean;
  onOpenMenu: () => void;
}) => {
  const t = useTranslations();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = activeNavEntry(pathname);
  const startActive = active?.kind === 'start';
  const searchActive = active?.kind === 'search';

  return (
    <TabBar aria-label={t.shell.navigationAria} data-testid="member-bottom-nav">
      <TabButton
        component={Link}
        to={memberHomePath()}
        aria-current={startActive ? 'page' : undefined}
        data-testid="member-tab-start"
      >
        <StartIcon />
        <TabLabel label={t.shell.start} />
      </TabButton>
      <TabButton
        component={Link}
        to={memberSearchPath()}
        aria-current={searchActive ? 'page' : undefined}
        data-testid="member-tab-search"
      >
        <SearchIcon />
        <TabLabel label={t.shell.searchEntry} />
      </TabButton>
      <TabButton
        onClick={onOpenMenu}
        aria-haspopup="dialog"
        aria-expanded={menuOpen ? true : undefined}
        data-testid="member-tab-menu"
      >
        <MenuIcon />
        <TabLabel label={t.shell.menuTab} />
      </TabButton>
    </TabBar>
  );
};
