import type { ReactNode } from 'react';
import { Box, Breadcrumbs, Container, Stack, Typography } from '@mui/material';

import { Eyebrow, LedgerHeader } from '../../theme.js';
import { BrandLoader } from './BrandLoader.js';
import { StatusView, type PageState } from './StatusView.js';
import { PAGE_WIDTH } from './widths.js';

interface BreadcrumbItem {
  label: ReactNode;
  link?: ReactNode;
}

export interface MemberPageProps {
  title: ReactNode;
  eyebrow: ReactNode;
  width?: 'prose' | 'wide';
  breadcrumbs?: BreadcrumbItem[];
  breadcrumbLabel: string;
  /** Sticky right column (24rem) on md+. */
  rail?: ReactNode;
  railLeading?: ReactNode;
  /**
   * Where the rail lands on xs: 'before' (course overview — progress summary
   * leads), 'after' (lesson player — the lesson itself must come first), or
   * 'split' (leading rail content, main content, trailing rail content).
   */
  mobileRail?: 'before' | 'after' | 'split';
  /** Persistent bottom tab bar below md; caller supplies the tabs. */
  bottomNav?: ReactNode;
  state?: PageState;
  children?: ReactNode;
  'data-testid'?: string;
}

const Crumb = ({ item, isCurrent }: { item: BreadcrumbItem; isCurrent: boolean }) => {
  if (item.link !== undefined) return item.link;
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
  breadcrumbs,
  breadcrumbLabel,
  rail,
  railLeading,
  mobileRail = 'before',
  bottomNav,
  state,
  children,
  'data-testid': testId,
}: MemberPageProps) => {
  const statusOnly = state !== undefined && state.kind !== 'ready';
  const body = state?.kind === 'loading'
    ? <BrandLoader scope="container" caption={state.label} />
    : statusOnly
      ? <StatusView state={state} />
      : children;
  const hasRail = rail !== undefined || railLeading !== undefined;
  const splitRail = mobileRail === 'split' && railLeading !== undefined;

  return (
    <Container
      disableGutters
      sx={{
        maxWidth: `${PAGE_WIDTH[width]} !important`,
        pb:
          bottomNav === undefined
            ? '3rem'
            : { xs: 'calc(7.5rem + env(safe-area-inset-bottom))', md: '3rem' },
      }}
      data-testid={testId}
    >
      <LedgerHeader component="header" sx={{ pb: '21px' }}>
        {breadcrumbs !== undefined && breadcrumbs.length > 0 && (
          <Breadcrumbs aria-label={breadcrumbLabel} data-testid="member-breadcrumbs" sx={{ mb: '0.75rem' }}>
            {breadcrumbs.map((item, index) => (
              <Crumb key={index} item={item} isCurrent={index === breadcrumbs.length - 1} />
            ))}
          </Breadcrumbs>
        )}
        <Typography variant="h1">{title}</Typography>
        <Eyebrow variant="overline" component="p">
          {eyebrow}
        </Eyebrow>
      </LedgerHeader>

      {hasRail && !statusOnly ? (
        <Box
          sx={{
            mt: '2.5rem',
            display: 'grid',
            gap: '1.5rem',
            alignItems: 'start',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 24rem' },
          }}
        >
          <Box
            component="main"
            sx={{
              order: {
                xs: mobileRail === 'before' || splitRail ? 2 : 1,
                md: 1,
              },
              minWidth: 0,
            }}
          >
            {body}
          </Box>
          <Stack
            component="aside"
            useFlexGap
            sx={{
              rowGap: '1.5rem',
              display: { xs: splitRail ? 'contents' : 'flex', md: 'flex' },
              order: { xs: mobileRail === 'before' ? 1 : 2, md: 2 },
              position: { md: 'sticky' },
              top: { md: '1.5rem' },
              maxHeight: { md: 'calc(100vh - 3rem)' },
              overflowY: { md: 'auto' },
            }}
          >
            {splitRail ? (
              <>
                <Box data-testid="member-rail-leading" sx={{ minWidth: 0, order: { xs: 1 } }}>
                  {railLeading}
                </Box>
                <Stack
                  useFlexGap
                  data-testid="member-rail-trailing"
                  sx={{ minWidth: 0, rowGap: '1.5rem', order: { xs: 3 } }}
                >
                  {rail}
                </Stack>
              </>
            ) : (
              <>
                {railLeading}
                {rail}
              </>
            )}
          </Stack>
        </Box>
      ) : (
        <Box component="main" sx={{ mt: '2.5rem' }}>
          {body}
        </Box>
      )}

      {bottomNav !== undefined && (
        <Box
          component="nav"
          sx={{
            display: { xs: 'block', md: 'none' },
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
