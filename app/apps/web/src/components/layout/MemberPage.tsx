import type { ReactNode } from 'react';
import { Box, Container, Stack, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { Eyebrow, LedgerBreadcrumbs, LedgerTitle, MemberLedgerHeader } from '../../theme.js';
import { BrandLoader } from './BrandLoader.js';
import { StatusView, type PageState } from './StatusView.js';
import { PAGE_WIDTH } from './widths.js';

export interface BreadcrumbItem {
  label: ReactNode;
  link?: ReactNode;
}

export interface MemberPageProps {
  title: ReactNode;
  eyebrow: ReactNode;
  width?: 'prose' | 'wide';
  breadcrumbs?: BreadcrumbItem[];
  breadcrumbLabel: string;
  /** Page-level call to action, right-aligned in the header on sm+. */
  actions?: ReactNode;
  /** Sticky right column (24rem) on md+. */
  rail?: ReactNode;
  railLeading?: ReactNode;
  /**
   * Where the rail lands on xs: 'before' (course overview — progress summary
   * leads), 'after' (lesson player — the lesson itself must come first), or
   * 'split' (leading rail content, main content, trailing rail content).
   */
  mobileRail?: 'before' | 'after' | 'split';
  /** Tighter head rhythm and a smaller h1 below md, for reading-first pages. */
  dense?: boolean;
  state?: PageState;
  children?: ReactNode;
  'data-testid'?: string;
}

const crumbTrailToParent = (items: BreadcrumbItem[]): BreadcrumbItem[] => {
  const parentIndex = items.reduce((deepest, item, index) => (item.link === undefined ? deepest : index), 0);
  const parent = items[parentIndex];
  return parentIndex === 0 || parent === undefined ? items.slice(0, 1) : [...items.slice(0, 1), parent];
};

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
  actions,
  rail,
  railLeading,
  mobileRail = 'before',
  dense = false,
  state,
  children,
  'data-testid': testId,
}: MemberPageProps) => {
  const theme = useTheme();
  const compactCrumbs = useMediaQuery(theme.breakpoints.down('sm'));
  const crumbs = breadcrumbs === undefined || !compactCrumbs ? breadcrumbs : crumbTrailToParent(breadcrumbs);
  const statusOnly = state !== undefined && state.kind !== 'ready';
  const body = state?.kind === 'loading'
    ? <BrandLoader scope="container" caption={state.label} />
    : statusOnly
      ? <StatusView state={state} />
      : children;
  const hasRail = rail !== undefined || railLeading !== undefined;
  const splitRail = mobileRail === 'split' && railLeading !== undefined;
  const bodyOffset = {
    xs: dense ? '1rem' : '1.5rem',
    md: dense ? '1.25rem' : '2.5rem',
  };

  return (
    <Container
      disableGutters
      sx={{ maxWidth: `${PAGE_WIDTH[width]} !important`, pb: '3rem' }}
      data-testid={testId}
    >
      <MemberLedgerHeader component="header" sx={{ pb: { xs: '14px', md: '21px' } }}>
        {crumbs !== undefined && crumbs.length > 0 && (
          <LedgerBreadcrumbs
            aria-label={breadcrumbLabel}
            data-testid="member-breadcrumbs"
            sx={{ mb: '0.75rem' }}
          >
            {crumbs.map((item, index) => (
              <Crumb key={index} item={item} isCurrent={index === crumbs.length - 1} />
            ))}
          </LedgerBreadcrumbs>
        )}
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            justifyContent: 'space-between',
            alignItems: { xs: 'flex-start', sm: 'flex-end' },
            gap: '1rem',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <LedgerTitle variant="h1" dense={dense}>{title}</LedgerTitle>
            <Eyebrow variant="overline" component="p">
              {eyebrow}
            </Eyebrow>
          </Box>
          {actions === undefined ? null : <Box sx={{ flexShrink: 0 }}>{actions}</Box>}
        </Box>
      </MemberLedgerHeader>

      {hasRail && !statusOnly ? (
        <Box
          sx={{
            mt: bodyOffset,
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
        <Box component="main" sx={{ mt: bodyOffset }}>
          {body}
        </Box>
      )}
    </Container>
  );
};
