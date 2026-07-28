import type { ReactNode } from 'react';
import { AppBar, Box, Drawer, Toolbar } from '@mui/material';

const DRAWER_WIDTH = 248;

interface AppShellProps {
  isDesktop: boolean;
  mobileNavigationOpen: boolean;
  onMobileNavigationClose: () => void;
  header: ReactNode;
  navigation: ReactNode;
  children: ReactNode;
}

export const AppShell = ({
  isDesktop,
  mobileNavigationOpen,
  onMobileNavigationClose,
  header,
  navigation,
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

    <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
      <Toolbar />
      <Box sx={{ px: { xs: '1.25rem', md: '2rem' }, py: '2rem' }}>{children}</Box>
    </Box>
  </Box>
);
