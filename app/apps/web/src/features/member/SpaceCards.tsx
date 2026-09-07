import type { CSSProperties } from 'react';
import { Box, Chip, Stack, SvgIcon, Typography, type SvgIconProps } from '@mui/material';
import { Link } from '@tanstack/react-router';

import type { SpaceProductSummary, SpaceVisibility } from '#core/domain/index.js';

import { useTranslations } from '../../i18n/index.js';
import { CourseCardRoot, EmberCtaLink, LockedSpaceMark, UnreadDot } from '../../theme.js';
import { LockClosed } from './tree-icons.js';

const GLOBE_ICON_PATH =
  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.93 9h-3.02a15.8 15.8 0 0 0-1.01-5.02A8.02 8.02 0 0 1 18.93 11ZM12 4.04c.7.99 1.7 3.1 1.9 6.96h-3.8c.2-3.86 1.2-5.97 1.9-6.96ZM4.07 13h3.02c.14 1.96.49 3.69 1.01 5.02A8.02 8.02 0 0 1 4.07 13Zm3.02-2H4.07A8.02 8.02 0 0 1 8.1 5.98 15.8 15.8 0 0 0 7.09 11ZM12 19.96c-.7-.99-1.7-3.1-1.9-6.96h3.8c-.2 3.86-1.2 5.97-1.9 6.96Zm1.46-.44A17.1 17.1 0 0 0 15.91 13h3.02a8.02 8.02 0 0 1-5.47 6.52Z';

const PEOPLE_ICON_PATH =
  'M16 11a4 4 0 1 0-3.31-6.24 5 5 0 1 0-3.38 8.48A6 6 0 0 0 4 19v1a1 1 0 0 0 2 0v-1a4 4 0 0 1 8 0v1a1 1 0 0 0 2 0v-1a5.96 5.96 0 0 0-1.45-3.91A4.99 4.99 0 0 1 20 20a1 1 0 0 0 2 0a7 7 0 0 0-6-6.93V13a3.98 3.98 0 0 0 0-2Zm-6-5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm6 5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z';

export interface SpaceCardSpace {
  id: string;
  name: string;
  description?: string | null;
  visibility?: SpaceVisibility | undefined;
  publicReadOnly?: boolean | undefined;
  products?: SpaceProductSummary[] | undefined;
  isFollowing?: boolean;
  unread?: boolean;
}

export interface LockedSpaceCardSpace {
  id: string;
  name: string;
  description: string | null;
  productIds: string[];
  products?: SpaceProductSummary[] | undefined;
}

const GlobeIcon = (props: SvgIconProps) => (
  <SvgIcon aria-hidden viewBox="0 0 24 24" {...props}>
    <path d={GLOBE_ICON_PATH} />
  </SvgIcon>
);

const PeopleIcon = (props: SvgIconProps) => (
  <SvgIcon aria-hidden viewBox="0 0 24 24" {...props}>
    <path d={PEOPLE_ICON_PATH} />
  </SvgIcon>
);

const chipSx = {
  alignSelf: 'flex-start',
};

const tooltipChipStyle: CSSProperties = { color: 'inherit', borderColor: 'currentColor' };
const tooltipIconStyle: CSSProperties = { color: 'inherit' };

const chipStyle = (tone: 'surface' | 'tooltip') =>
  tone === 'tooltip' ? tooltipChipStyle : undefined;

const iconStyle = (tone: 'surface' | 'tooltip') =>
  tone === 'tooltip' ? tooltipIconStyle : undefined;

export const SpaceVisibilityChip = ({
  space,
  testId,
  tone = 'surface',
}: {
  space: Pick<SpaceCardSpace, 'visibility' | 'publicReadOnly' | 'products'>;
  testId?: string;
  tone?: 'surface' | 'tooltip';
}) => {
  const t = useTranslations();

  if (space.publicReadOnly === true) {
    return (
      <Chip
        size="small"
        variant="outlined"
        icon={<GlobeIcon style={iconStyle(tone)} />}
        label={t.community.publicReadOnly}
        data-testid={testId}
        style={chipStyle(tone)}
        sx={chipSx}
      />
    );
  }

  if (space.visibility === 'members') {
    return (
      <Chip
        size="small"
        variant="outlined"
        icon={<PeopleIcon style={iconStyle(tone)} />}
        label={t.community.membersOnly}
        data-testid={testId}
        style={chipStyle(tone)}
        sx={chipSx}
      />
    );
  }

  if (space.visibility === 'product') {
    const product = space.products?.[0];
    return (
      <Chip
        size="small"
        variant="outlined"
        icon={<LockClosed style={iconStyle(tone)} />}
        label={
          product === undefined
            ? t.community.productGated
            : t.community.productGatedFor({ product: product.title })
        }
        data-testid={testId}
        style={chipStyle(tone)}
        sx={chipSx}
      />
    );
  }

  return null;
};

const productVisibilitySpace = (space: Pick<LockedSpaceCardSpace, 'products'>) =>
  space.products === undefined
    ? { visibility: 'product' as const }
    : { visibility: 'product' as const, products: space.products };

export const LockedSpaceTooltipTitle = ({ space }: { space: Pick<LockedSpaceCardSpace, 'products'> }) => {
  const t = useTranslations();

  return (
    <Stack useFlexGap sx={{ rowGap: '0.45rem', py: '0.1rem' }}>
      <Typography variant="caption" component="span" style={{ color: 'inherit' }}>
        {t.shell.lockedSpaceHint}
      </Typography>
      <SpaceVisibilityChip space={productVisibilitySpace(space)} tone="tooltip" />
    </Stack>
  );
};

export const SpaceCard = ({ space }: { space: SpaceCardSpace }) => {
  const t = useTranslations();
  return (
    <CourseCardRoot component={Link} to={`/community/${encodeURIComponent(space.id)}`} data-testid={`space-card-${space.id}`}>
      <Box sx={{ p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', flexGrow: 1 }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'flex-start', columnGap: '0.75rem' }}>
          <Typography variant="h2" component="h3" sx={{ flex: 1, minWidth: 0 }}>
            {space.name}
          </Typography>
          {space.unread === true && (
            <UnreadDot
              role="img"
              aria-label={t.shell.spaceUnreadLabel({ name: space.name })}
              data-testid={`space-unread-${space.id}`}
            />
          )}
          {space.isFollowing === true && (
            <Chip
              size="small"
              variant="outlined"
              color="success"
              label={t.community.followingChip}
              data-testid={`space-following-${space.id}`}
            />
          )}
        </Stack>
        {space.description ? (
          <Typography variant="body2" sx={{ flexGrow: 1 }}>
            {space.description}
          </Typography>
        ) : null}
        <Box sx={{ mt: 'auto' }}>
          <SpaceVisibilityChip space={space} testId={`space-visibility-${space.id}`} />
        </Box>
      </Box>
    </CourseCardRoot>
  );
};

export const LockedSpaceCard = ({ space }: { space: LockedSpaceCardSpace }) => {
  const t = useTranslations();
  const productId = space.productIds[0];
  return (
    <CourseCardRoot data-testid={`locked-space-card-${space.id}`}>
      <Box
        sx={{
          p: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          columnGap: '0.75rem',
          rowGap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <LockedSpaceMark>
          <LockClosed />
        </LockedSpaceMark>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h3" component="h3" color="text.primary">
            {space.name}
          </Typography>
          {space.description ? (
            <Typography
              variant="caption"
              component="p"
              color="text.secondary"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {space.description}
            </Typography>
          ) : null}
        </Box>
        {productId === undefined ? null : (
          <EmberCtaLink
            component={Link}
            to={`/checkout/${encodeURIComponent(productId)}`}
            size="small"
            variant="contained"
            data-testid={`locked-space-cta-${space.id}`}
            sx={{
              flexShrink: 0,
              alignSelf: 'center',
              px: '0.7rem',
              py: '0.32rem',
              ml: { xs: 'auto', sm: 0 },
            }}
          >
            {t.courseTree.unlockAccess}
          </EmberCtaLink>
        )}
        <SpaceVisibilityChip
          space={productVisibilitySpace(space)}
          testId={`space-visibility-${space.id}`}
        />
      </Box>
    </CourseCardRoot>
  );
};
