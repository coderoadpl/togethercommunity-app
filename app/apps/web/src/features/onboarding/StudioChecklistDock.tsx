import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Divider, IconButton, Paper, Stack, SvgIcon, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme, type Theme } from '@mui/material/styles';

import { useReserveBottomInset } from '../../components/layout/index.js';
import { useTranslations } from '../../i18n/index.js';
import { persistedJsonPreference } from '../../theme-mode.js';
import { OnboardingChecklist } from './OnboardingChecklist.js';
import { TenantSetupChecklist } from './TenantSetupChecklist.js';

const BAR_HEIGHT = '2.75rem';
const PILL_HEIGHT = '2.25rem';
const LAUNCHER_ICON_PATH =
  'M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z';
const COLLAPSE_ICON_PATH = 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z';
const EXPAND_ICON_PATH = 'M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z';
const CLOSE_ICON_PATH =
  'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

const PANEL_ID = 'studio-checklist-panel';

const flagPreferenceFor = (name: string, scope: string) =>
  persistedJsonPreference<boolean | undefined>(
    `together-studio-checklist-${name}:${scope}`,
    (value) => (typeof value === 'boolean' ? value : undefined),
    undefined,
  );

const dockAnchor = {
  position: 'fixed' as const,
  right: { xs: 0, sm: '1.5rem' },
  bottom: 0,
  zIndex: (theme: Theme) => theme.zIndex.speedDial,
  width: { xs: '100vw', sm: '280px' },
  borderRadius: '0.5rem 0.5rem 0 0',
};

export const StudioChecklistDock = ({ scope }: { scope: string }) => {
  const t = useTranslations();
  const preference = useMemo(() => flagPreferenceFor('collapsed', scope), [scope]);
  const dismissal = useMemo(() => flagPreferenceFor('dismissed', scope), [scope]);
  const [choice, setChoice] = useState<boolean | undefined>(preference.load);
  const [dismissed, setDismissed] = useState(() => dismissal.load() === true);
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
  }, [collapsed, dismissed]);

  useReserveBottomInset(dismissed ? PILL_HEIGHT : BAR_HEIGHT);

  const dismiss = () => {
    dismissal.save(true);
    document.querySelector('main')?.focus();
    setDismissed(true);
  };

  const reopen = () => {
    dismissal.save(false);
    movesFocus.current = true;
    setDismissed(false);
  };

  if (dismissed) {
    return (
      <Paper
        elevation={8}
        sx={{ ...dockAnchor, right: { xs: '1rem', sm: '1.5rem' }, width: 'auto' }}
      >
        <Tooltip title={t.studioSetup.panelTitle}>
          <IconButton
            size="small"
            data-testid="studio-checklist-reopen"
            aria-label={t.studioSetup.expand({ title: t.studioSetup.panelTitle })}
            onClick={reopen}
            sx={{ width: PILL_HEIGHT, height: PILL_HEIGHT }}
          >
            <SvgIcon aria-hidden fontSize="small" viewBox="0 0 24 24">
              <path d={LAUNCHER_ICON_PATH} />
            </SvgIcon>
          </IconButton>
        </Tooltip>
      </Paper>
    );
  }

  const header = (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        px: '0.75rem',
        height: BAR_HEIGHT,
      }}
    >
      <Typography variant="subtitle2" component="h2" noWrap sx={{ flex: 1, minWidth: 0 }}>
        {t.studioSetup.panelTitle}
      </Typography>
      <IconButton
        size="small"
        ref={collapsed ? launcherRef : undefined}
        data-testid={collapsed ? 'studio-checklist-launcher' : 'studio-checklist-collapse'}
        aria-label={
          collapsed
            ? t.studioSetup.expand({ title: t.studioSetup.panelTitle })
            : t.studioSetup.collapse({ title: t.studioSetup.panelTitle })
        }
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : PANEL_ID}
        onClick={() => toggle(!collapsed)}
      >
        <SvgIcon aria-hidden fontSize="small" viewBox="0 0 24 24">
          <path d={collapsed ? EXPAND_ICON_PATH : COLLAPSE_ICON_PATH} />
        </SvgIcon>
      </IconButton>
      <IconButton
        size="small"
        data-testid="studio-checklist-close"
        aria-label={t.studioSetup.close({ title: t.studioSetup.panelTitle })}
        onClick={dismiss}
      >
        <SvgIcon aria-hidden fontSize="small" viewBox="0 0 24 24">
          <path d={CLOSE_ICON_PATH} />
        </SvgIcon>
      </IconButton>
    </Box>
  );

  if (collapsed) {
    return (
      <Paper
        elevation={8}
        role="region"
        aria-label={t.studioSetup.panelTitle}
        data-testid="studio-checklist-bar"
        sx={dockAnchor}
      >
        {header}
      </Paper>
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
        width: { xs: '100vw', sm: '24rem' },
        maxHeight: { xs: '60vh', md: 'min(34rem, calc(100vh - 5rem))' },
      }}
    >
      {header}
      <Divider />
      <Stack useFlexGap sx={{ rowGap: '1.25rem', p: '1rem', overflowY: 'auto', minHeight: 0 }}>
        <TenantSetupChecklist />
        <OnboardingChecklist />
      </Stack>
    </Paper>
  );
};
