import { useEffect } from 'react';
import { Box } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { EmptySpacesIcon } from './community-icons.js';
import { MemberSurface } from './MemberSurface.js';
import { SpaceCard } from './SpaceCards.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

export const SpacesListPage = () => {
  const t = useTranslations();
  const spaces = useQuery(actions.spaces);
  const navigate = useNavigate();
  const unauthorized = isUnauthorized(spaces.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (spaces.isPending) {
    return (
      <MemberSurface
        title={t.community.heading}
        eyebrow={t.community.listEyebrow}
        width="wide"
        state={{ kind: 'loading', label: t.community.loadingSpaces }}
      />
    );
  }

  if (unauthorized) return null;

  if (spaces.isError) {
    return (
      <MemberSurface
        title={t.community.heading}
        eyebrow={t.community.listEyebrow}
        width="wide"
        state={{
          kind: 'error',
          message: isForbidden(spaces.error) ? t.community.staffNoMember : localizeError(spaces.error, t),
          retry: { label: t.common.retry, onRetry: () => void spaces.refetch() },
        }}
      />
    );
  }

  return (
    <MemberSurface title={t.community.heading} eyebrow={t.community.listEyebrow} width="wide">
      {spaces.data.spaces.length === 0 ? (
        <StatusView
          state={{
            kind: 'empty',
            icon: <EmptySpacesIcon />,
            title: t.community.noSpacesTitle,
            body: t.community.noSpacesBody,
          }}
          data-testid="spaces-empty-state"
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: '1rem',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          }}
        >
          {spaces.data.spaces.map((space) => (
            <SpaceCard key={space.id} space={space} />
          ))}
        </Box>
      )}
    </MemberSurface>
  );
};
