import type { ElementType } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import { Link } from '@tanstack/react-router';

import type { SpaceVisibility } from '#core/domain/index.js';

import { useTranslations } from '../../i18n/index.js';
import { CourseCardRoot, EmberCtaButton, UnreadDot } from '../../theme.js';
import { LockClosed } from './tree-icons.js';

const EmberCtaLink = styled(EmberCtaButton)<{ component?: ElementType; to?: string }>({});

export interface SpaceCardSpace {
  id: string;
  name: string;
  description?: string | null;
  /** Absent for anonymous visitors, whose navigation carries no entitlement dimension. */
  visibility?: SpaceVisibility;
  isFollowing?: boolean;
  unread?: boolean;
}

export interface LockedSpaceCardSpace {
  id: string;
  name: string;
  description: string | null;
  productIds: string[];
}

export const SpaceCard = ({ space }: { space: SpaceCardSpace }) => {
  const t = useTranslations();
  return (
    <CourseCardRoot component={Link} to={`/community/${encodeURIComponent(space.id)}`} data-testid={`space-card-${space.id}`}>
      <Box sx={{ p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', height: '100%' }}>
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
          <>
            <Typography variant="body2">{space.description}</Typography>
            <Box sx={{ flex: 1 }} />
          </>
        ) : null}
        {space.visibility === undefined ? null : (
          <Chip
            size="small"
            variant="outlined"
            label={space.visibility === 'product' ? t.community.productGated : t.community.membersOnly}
            data-testid={`space-visibility-${space.id}`}
            sx={{ alignSelf: 'flex-start' }}
          />
        )}
      </Box>
    </CourseCardRoot>
  );
};

export const LockedSpaceCard = ({ space }: { space: LockedSpaceCardSpace }) => {
  const t = useTranslations();
  const productId = space.productIds[0];
  return (
    <CourseCardRoot data-testid={`locked-space-card-${space.id}`}>
      <Box sx={{ p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', height: '100%' }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.6rem' }}>
          <LockClosed />
          <Typography variant="h2" component="h3" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
            {space.name}
          </Typography>
        </Stack>
        {space.description ? (
          <Typography variant="body2" color="text.secondary">
            {space.description}
          </Typography>
        ) : null}
        <Box sx={{ flex: 1 }} />
        {productId === undefined ? null : (
          <EmberCtaLink
            component={Link}
            to={`/checkout/${encodeURIComponent(productId)}`}
            variant="contained"
            data-testid={`locked-space-cta-${space.id}`}
          >
            {t.courseTree.unlockAccess}
          </EmberCtaLink>
        )}
      </Box>
    </CourseCardRoot>
  );
};
