import type { ReactNode } from 'react';
import { AppBar, Box, Container, Drawer, IconButton, SvgIcon, Toolbar, Tooltip } from '@mui/material';

import { StatusView, type PageState } from './StatusView.js';

const DRAWER_WIDTH = 248;
const APP_CONTENT_WIDTH = '44rem';

interface AppShellProps {
  isDesktop: boolean;
  mobileNavigationOpen: boolean;
  onMobileNavigationClose: () => void;
  mobileNavigationCloseLabel: string;
  header: ReactNode;
  navigation: ReactNode;
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
  footer,
  state,
  children,
}: AppShellProps) => (
  <Box sx={{ display: 'flex', minHeight: '100vh' }}>
    <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
      <Toolbar sx={{ gap: '0.75rem' }}>{header}</Toolbar>
    </AppBar>

    <Box sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
      {isDesktop ? (
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
          }}
        >
          <Toolbar />
          {navigation}
        </Drawer>
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
          {navigation}
        </Drawer>
      )}
    </Box>

    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Toolbar />
        <Box sx={{ px: { xs: '1.25rem', md: '2rem' }, py: '2rem' }}>
          {state === undefined ? (
            children
          ) : (
            <Container data-testid="app-shell-status" sx={{ maxWidth: APP_CONTENT_WIDTH }}>
              <StatusView state={state} />
            </Container>
          )}
        </Box>
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
