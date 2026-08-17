import type { ElementType, ReactNode } from 'react';
import { AppBar, Box, Container, Drawer, IconButton, SvgIcon, Toolbar, Tooltip } from '@mui/material';
import { styled } from '@mui/material/styles';

import { StatusView, type PageState } from './StatusView.js';

const DRAWER_WIDTH = 248;
const APP_CONTENT_WIDTH = '44rem';

const SidebarColumn = styled(Box)<{ component?: ElementType }>(({ theme }) => ({
  width: `${DRAWER_WIDTH}px`,
  flexShrink: 0,
  alignSelf: 'flex-start',
  position: 'sticky',
  top: 0,
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: theme.palette.background.default,
  borderRight: `1px solid ${theme.palette.divider}`,
}));

interface AppShellProps {
  isDesktop: boolean;
  mobileNavigationOpen: boolean;
  onMobileNavigationClose: () => void;
  mobileNavigationCloseLabel: string;
  header: ReactNode;
  navigation: ReactNode;
  brand?: ReactNode;
  footer?: ReactNode;
  state?: PageState;
  children?: ReactNode;
}

export const AppShell = ({
  isDesktop,
  mobileNavigationOpen,
  onMobileNavigationClose,
  mobileNavigationCloseLabel,
  header,
  navigation,
  brand,
  footer,
  state,
  children,
}: AppShellProps) => (
  <Box sx={{ display: 'flex', minHeight: '100vh' }}>
    {isDesktop ? (
      <SidebarColumn component="aside">
        {brand}
        <Box data-testid="navigation-scroll" sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {navigation}
        </Box>
      </SidebarColumn>
    ) : (
      <Drawer
        variant="temporary"
        open={mobileNavigationOpen}
        onClose={onMobileNavigationClose}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar sx={{ justifyContent: 'flex-end' }}>
          <Tooltip title={mobileNavigationCloseLabel}>
            <IconButton
              data-testid="close-navigation"
              aria-label={mobileNavigationCloseLabel}
              onClick={onMobileNavigationClose}
            >
              <SvgIcon aria-hidden viewBox="0 0 24 24">
                <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4l-6.3 6.31-1.42-1.42L9.17 12l-6.3-6.29 1.42-1.42 6.3 6.31 6.3-6.31z" />
              </SvgIcon>
            </IconButton>
          </Tooltip>
        </Toolbar>
        {brand}
        {navigation}
      </Drawer>
    )}

    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
      <AppBar position="sticky">
        <Toolbar variant="dense" sx={{ minHeight: '52px', px: '1.25rem', gap: '0.75rem' }}>
          {header}
        </Toolbar>
      </AppBar>
      <Box
        component="main"
        sx={{ flexGrow: 1, minWidth: 0, px: { xs: '1.25rem', md: '1.5rem' }, py: '2rem' }}
      >
        {state === undefined ? (
          children
        ) : (
          <Container data-testid="app-shell-status" sx={{ maxWidth: APP_CONTENT_WIDTH }}>
            <StatusView state={state} />
          </Container>
        )}
      </Box>
      {footer === undefined ? null : (
        <Box
          component="footer"
          sx={{ display: 'flex', justifyContent: 'flex-end', px: '1.5rem', py: '0.8rem' }}
        >
          {footer}
        </Box>
      )}
    </Box>
  </Box>
);
