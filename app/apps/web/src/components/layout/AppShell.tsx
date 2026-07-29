import type { ReactNode } from 'react';
import { AppBar, Box, Container, Drawer, Toolbar } from '@mui/material';

import { StatusView, type PageState } from './StatusView.js';

const DRAWER_WIDTH = 248;
const APP_CONTENT_WIDTH = '44rem';

interface AppShellProps {
  isDesktop: boolean;
  mobileNavigationOpen: boolean;
  onMobileNavigationClose: () => void;
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
          <Toolbar />
          {navigation}
        </Drawer>
      )}
    </Box>

    <Box
      component="main"
      sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}
    >
      <Toolbar />
      <Box sx={{ flexGrow: 1, px: { xs: '1.25rem', md: '2rem' }, py: '2rem' }}>
        {state === undefined ? (
          children
        ) : (
          <Container data-testid="app-shell-status" sx={{ maxWidth: APP_CONTENT_WIDTH }}>
            <StatusView state={state} />
          </Container>
        )}
      </Box>
      <Box
        component="footer"
        sx={{ display: 'flex', justifyContent: 'flex-end', px: '1.5rem', py: '0.8rem' }}
      >
        {footer}
      </Box>
    </Box>
  </Box>
);
