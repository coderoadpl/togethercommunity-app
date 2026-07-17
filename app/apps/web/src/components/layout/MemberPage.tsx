import type { ReactNode } from 'react';
import { Box, Breadcrumbs, Container, Link, Stack, Typography } from '@mui/material';

import { Eyebrow, LedgerHeader } from '../../theme.js';
import { StatusView, type PageState } from './StatusView.js';
import { PAGE_WIDTH } from './widths.js';

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
}

export interface MemberPageProps {
  title: ReactNode;
  eyebrow: ReactNode;
  width?: 'prose' | 'wide';
  /** Utility nav in the header row: links + NotificationBell + MemberAccountMenu. */
  nav?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  /** Sticky right column (24rem) on md+, rendered above the content on xs. */
  rail?: ReactNode;
  /** Persistent bottom tab bar, xs only (decision D4); caller supplies the tabs. */
  bottomNav?: ReactNode;
  state?: PageState;
  children?: ReactNode;
  'data-testid'?: string;
}

const Crumb = ({ item, isCurrent }: { item: BreadcrumbItem; isCurrent: boolean }) => {
  if (item.href !== undefined) return <Link href={item.href}>{item.label}</Link>;
  return (
    <Typography variant="body2" color={isCurrent ? 'text.primary' : undefined}>
      {item.label}
    </Typography>
  );
};

export const MemberPage = ({
  title,
  eyebrow,
  width = 'prose',
  nav,
  breadcrumbs,
  rail,
  bottomNav,
  state,
  children,
  'data-testid': testId,
}: MemberPageProps) => {
  const statusOnly = state !== undefined && state.kind !== 'ready';
  const body = statusOnly ? <StatusView state={state} /> : children;

  return (
    <Container
      disableGutters
      sx={{
        maxWidth: `${PAGE_WIDTH[width]} !important`,
        px: '1.25rem',
        pb: bottomNav === undefined ? '6rem' : { xs: '7.5rem', sm: '6rem' },
      }}
      data-testid={testId}
    >
      <LedgerHeader component="header" sx={{ pt: '48px', pb: '21px' }}>
        {breadcrumbs !== undefined && breadcrumbs.length > 0 && (
          <Breadcrumbs aria-label="breadcrumb" sx={{ mb: '0.75rem' }}>
            {breadcrumbs.map((item, index) => (
              <Crumb key={index} item={item} isCurrent={index === breadcrumbs.length - 1} />
            ))}
          </Breadcrumbs>
        )}
        <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem' }}>
          <Typography variant="h1">{title}</Typography>
          <Box sx={{ flex: 1 }} />
          {nav}
        </Stack>
        <Eyebrow variant="overline" component="p">
          {eyebrow}
        </Eyebrow>
      </LedgerHeader>

      {rail !== undefined && !statusOnly ? (
        <Box
          sx={{
            mt: '2.5rem',
            display: 'grid',
            gap: '1.5rem',
            alignItems: 'start',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 24rem' },
          }}
        >
          <Box sx={{ order: { xs: 2, md: 1 }, minWidth: 0 }}>{body}</Box>
          <Stack
            useFlexGap
            sx={{
              rowGap: '1.5rem',
              order: { xs: 1, md: 2 },
              position: { md: 'sticky' },
              top: { md: '1.5rem' },
              maxHeight: { md: 'calc(100vh - 3rem)' },
              overflowY: { md: 'auto' },
            }}
          >
            {rail}
          </Stack>
        </Box>
      ) : (
        <Box component="section" sx={{ mt: '2.5rem' }}>
          {body}
        </Box>
      )}

      {bottomNav !== undefined && (
        <Box
          component="nav"
          sx={{
            display: { xs: 'block', sm: 'none' },
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 'appBar',
          }}
          data-testid="member-bottom-nav"
        >
          {bottomNav}
        </Box>
      )}
    </Container>
  );
};
