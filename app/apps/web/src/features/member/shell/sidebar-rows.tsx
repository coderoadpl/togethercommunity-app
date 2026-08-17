import type { ReactNode } from 'react';
import { Box, ListItemIcon, ListItemText, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import { StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { UnreadDot } from '../../../theme.js';
import { NavRow, UnreadRowText } from './shell-chrome.js';

export const LinkRow = ({
  to,
  label,
  icon,
  active,
  testId,
  unread,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  testId: string;
  unread?: { label: string };
}) => (
  <NavRow
    component={Link}
    to={to}
    activeOptions={{ exact: true }}
    selected={active}
    aria-current={active ? 'page' : undefined}
    {...(unread === undefined ? {} : { 'aria-label': unread.label })}
    data-testid={testId}
  >
    <ListItemIcon>{icon}</ListItemIcon>
    <ListItemText
      primary={unread === undefined ? label : <UnreadRowText>{label}</UnreadRowText>}
      slotProps={{ primary: { noWrap: true } }}
    />
    {unread === undefined ? null : <UnreadDot aria-hidden data-testid={`${testId}-unread`} />}
  </NavRow>
);

export const SidebarLoading = () => {
  const t = useTranslations();
  return (
    <Typography variant="body2" color="text.secondary" sx={{ px: '0.6rem', py: '0.5rem' }}>
      {t.common.loading}
    </Typography>
  );
};

export const SidebarError = ({ error, onRetry }: { error: Error; onRetry: () => void }) => {
  const t = useTranslations();
  return (
    <Box sx={{ px: '0.35rem' }}>
      <StatusView
        surface={false}
        state={{
          kind: 'error',
          message: localizeError(error, t),
          retry: { label: t.common.retry, onRetry },
        }}
      />
    </Box>
  );
};
