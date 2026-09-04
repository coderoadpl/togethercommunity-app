import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Divider, Fab, IconButton, Paper, Stack, SvgIcon, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme, type Theme } from '@mui/material/styles';

import { useTranslations } from '../../i18n/index.js';
import { persistedJsonPreference } from '../../theme-mode.js';
import { OnboardingChecklist } from './OnboardingChecklist.js';
import { TenantSetupChecklist } from './TenantSetupChecklist.js';

const LAUNCHER_ICON_PATH =
  'M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z';
const COLLAPSE_ICON_PATH = 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z';

const PANEL_ID = 'studio-checklist-panel';

const collapsedPreferenceFor = (scope: string) =>
  persistedJsonPreference<boolean | undefined>(
    `together-studio-checklist-collapsed:${scope}`,
    (value) => (typeof value === 'boolean' ? value : undefined),
    undefined,
  );

const dockAnchor = {
  position: 'fixed' as const,
  right: { xs: '1rem', md: '1.5rem' },
  bottom: { xs: '1rem', md: '1.5rem' },
  zIndex: (theme: Theme) => theme.zIndex.speedDial,
};

export const StudioChecklistDock = ({ scope }: { scope: string }) => {
  const t = useTranslations();
  const preference = useMemo(() => collapsedPreferenceFor(scope), [scope]);
  const [choice, setChoice] = useState<boolean | undefined>(preference.load);
  const theme = useTheme();
  const roomForPanel = useMediaQuery(theme.breakpoints.up('sm'));
  const collapsed = choice ?? !roomForPanel;
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const movesFocus = useRef(false);

  const toggle = useCallback(
    (next: boolean) => {
      preference.save(next);
      movesFocus.current = true;
      setChoice(next);
    },
    [preference],
  );

  useEffect(() => {
    if (!movesFocus.current) return;
    movesFocus.current = false;
    if (collapsed) launcherRef.current?.focus();
    else panelRef.current?.focus();
  }, [collapsed]);

  if (collapsed) {
    return (
      <Tooltip title={t.studioSetup.panelTitle}>
        <Fab
          ref={launcherRef}
          size="medium"
          color="primary"
          data-testid="studio-checklist-launcher"
          aria-label={t.studioSetup.expand({ title: t.studioSetup.panelTitle })}
          aria-expanded={false}
          onClick={() => toggle(false)}
          sx={dockAnchor}
        >
          <SvgIcon aria-hidden viewBox="0 0 24 24">
            <path d={LAUNCHER_ICON_PATH} />
          </SvgIcon>
        </Fab>
      </Tooltip>
    );
  }

  return (
    <Paper
      ref={panelRef}
      elevation={8}
      id={PANEL_ID}
      role="region"
      tabIndex={-1}
      aria-label={t.studioSetup.panelTitle}
      data-testid="studio-checklist-panel"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        toggle(true);
      }}
      sx={{
        ...dockAnchor,
        display: 'flex',
        flexDirection: 'column',
        width: { xs: 'calc(100vw - 2rem)', sm: '24rem' },
        maxHeight: { xs: 'min(60vh, calc(100vh - 2rem))', md: 'min(34rem, calc(100vh - 7rem))' },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          px: '1rem',
          py: '0.6rem',
        }}
      >
        <Typography variant="subtitle1" component="h2" sx={{ flex: 1, minWidth: 0 }}>
          {t.studioSetup.panelTitle}
        </Typography>
        <IconButton
          size="small"
          data-testid="studio-checklist-collapse"
          aria-label={t.studioSetup.collapse({ title: t.studioSetup.panelTitle })}
          aria-expanded
          aria-controls={PANEL_ID}
          onClick={() => toggle(true)}
        >
          <SvgIcon aria-hidden fontSize="small" viewBox="0 0 24 24">
            <path d={COLLAPSE_ICON_PATH} />
          </SvgIcon>
        </IconButton>
      </Box>
      <Divider />
      <Stack useFlexGap sx={{ rowGap: '1.25rem', p: '1rem', overflowY: 'auto', minHeight: 0 }}>
        <TenantSetupChecklist />
        <OnboardingChecklist />
      </Stack>
    </Paper>
  );
};
