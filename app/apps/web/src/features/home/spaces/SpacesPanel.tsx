import { useState } from 'react';
import { Alert, Button, Chip, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { StaffSpace } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, ListSection, PanelPage, StatusView } from '../../../components/layout/index.js';
import { PanelListRow } from '../../../components/ui/PanelListRow.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { DataValue } from '../../../theme.js';

type SpaceFilter = 'all' | 'active' | 'archived';

const SpaceRow = ({ space }: { space: StaffSpace }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const isArchived = space.archivedAt !== null;

  const setArchived = useMutation({
    ...actions.archiveSpace,
    onSuccess: async () => {
      setConfirmArchive(false);
      await queryClient.invalidateQueries(actions.spacesInvalidates());
    },
  });

  return (
    <PanelListRow
      data-testid="space-row"
      title={space.name}
      badges={
        <>
          <Chip
            size="small"
            variant="outlined"
            label={space.visibility === 'members' ? t.spacesPanel.membersOnlyChip : t.spacesPanel.productGatedChip}
          />
          {space.publicReadOnly ? (
            <Chip
              size="small"
              color="info"
              variant="outlined"
              label={t.spacesPanel.publicChip}
              data-testid={`space-public-${space.id}`}
            />
          ) : null}
          {isArchived ? (
            <Chip size="small" color="warning" variant="outlined" label={t.spacesPanel.statusArchived} />
          ) : null}
        </>
      }
      meta={
        <>
          <span>{space.slug}</span>
          <span>
            <DataValue>{space.stats.posts}</DataValue> {t.spacesPanel.postsNoun({ count: space.stats.posts })} ·{' '}
            <DataValue>{space.stats.followers}</DataValue>{' '}
            {t.spacesPanel.followersNoun({ count: space.stats.followers })}
          </span>
        </>
      }
      actions={
        <>
          <Button
            size="small"
            variant="text"
            component={Link}
            to={`/panel/spaces/${encodeURIComponent(space.id)}`}
            data-testid={`space-manage-${space.id}`}
          >
            {t.spacesPanel.manage}
          </Button>
          <Button
            size="small"
            variant="text"
            component={Link}
            to={`/panel/spaces/${encodeURIComponent(space.id)}/events`}
            data-testid={`space-events-${space.id}`}
          >
            {t.events.manageEvents}
          </Button>
          {isArchived ? (
            <Button
              size="small"
              variant="text"
              disabled={setArchived.isPending}
              onClick={() => setArchived.mutate({ id: space.id, archived: false })}
              data-testid={`space-restore-${space.id}`}
            >
              {t.spacesPanel.restore}
            </Button>
          ) : (
            <Button
              size="small"
              variant="text"
              color="error"
              onClick={() => setConfirmArchive(true)}
              data-testid={`space-archive-${space.id}`}
            >
              {t.spacesPanel.archive}
            </Button>
          )}
        </>
      }
    >
      {setArchived.isError ? <Alert severity="error">{localizePanelError(setArchived.error, t)}</Alert> : null}
      <ConfirmDialog
        open={confirmArchive}
        title={t.spacesPanel.archiveConfirmTitle}
        body={<Typography variant="body1">{t.spacesPanel.archiveConfirmBody}</Typography>}
        confirmLabel={t.spacesPanel.archiveConfirmCta}
        cancelLabel={t.common.cancel}
        pending={setArchived.isPending}
        onConfirm={() => setArchived.mutate({ id: space.id, archived: true })}
        onClose={() => setConfirmArchive(false)}
        confirmTestId={`space-archive-confirm-${space.id}`}
      />
    </PanelListRow>
  );
};

export const SpacesPanel = () => {
  const t = useTranslations();
  const spaces = useQuery(actions.staffSpaces);
  const [filter, setFilter] = useState<SpaceFilter>('active');

  const all = spaces.data?.spaces ?? [];
  const visible = all.filter((space) =>
    filter === 'all' ? true : filter === 'archived' ? space.archivedAt !== null : space.archivedAt === null,
  );
  const filterLabels: Record<SpaceFilter, string> = {
    all: t.spacesPanel.filterAll,
    active: t.spacesPanel.filterActive,
    archived: t.spacesPanel.filterArchived,
  };

  return (
    <PanelPage
      title={t.sections.spaces}
      action={
        <Button component={Link} to="/panel/spaces/new" variant="contained">
          + {t.common.add}
        </Button>
      }
    >
      <ListSection
        toolbar={{
          filters: (
            <Stack direction="row" useFlexGap spacing="0.4rem" role="group" aria-label={t.spacesPanel.filterAria}>
              {(['all', 'active', 'archived'] as const).map((value) => (
                <Chip
                  key={value}
                  size="small"
                  clickable
                  variant={filter === value ? 'filled' : 'outlined'}
                  color={filter === value ? 'primary' : 'default'}
                  label={filterLabels[value]}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                />
              ))}
            </Stack>
          ),
        }}
        isEmpty={spaces.isSuccess && all.length === 0}
        empty={
          <StatusView
            state={{
              kind: 'empty',
              title: t.spacesPanel.empty,
              body: t.spacesPanel.emptyHint,
              action: (
                <Button component={Link} to="/panel/spaces/new">
                  + {t.common.add}
                </Button>
              ),
            }}
          />
        }
        noMatches={
          spaces.isSuccess && all.length > 0 && visible.length === 0 ? (
            <Typography variant="body1">{t.spacesPanel.noMatches}</Typography>
          ) : undefined
        }
      >
        {spaces.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.spacesPanel.loading }} />
        ) : spaces.isError ? (
          <StatusView state={{ kind: 'error', message: localizePanelError(spaces.error, t), retry: { label: t.common.retry, onRetry: () => void spaces.refetch() } }} />
        ) : (
          <Stack useFlexGap spacing="1rem">
            {visible.map((space) => (
              <SpaceRow key={space.id} space={space} />
            ))}
          </Stack>
        )}
      </ListSection>
    </PanelPage>
  );
};
