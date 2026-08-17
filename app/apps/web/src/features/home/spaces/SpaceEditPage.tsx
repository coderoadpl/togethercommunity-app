import { Alert, Button, Stack } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import type { StaffSpace } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { SpaceForm, type SpaceFormValues } from './SpaceForm.js';

export const SpaceEditPage = ({ space }: { space: StaffSpace }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);

  const updateSpace = useMutation({
    ...actions.updateSpace,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.spacesInvalidates());
      await navigate({ to: '/panel/spaces' });
    },
  });

  const submit = (values: SpaceFormValues) =>
    updateSpace.mutate({
      id: space.id,
      name: values.name,
      description: values.description.trim() === '' ? null : values.description.trim(),
      visibility: values.visibility,
      productIds: values.productIds,
      publicReadOnly: values.publicReadOnly,
      position: values.position,
    });

  return (
    <PanelPage
      title={space.name}
      description={space.slug}
      backTo={<PanelBackLink to="/panel/spaces">{t.spacesPanel.allSpaces}</PanelBackLink>}
      action={
        <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
          <Button
            component={Link}
            to={`/panel/spaces/${encodeURIComponent(space.id)}/events`}
            variant="text"
            data-testid="space-edit-events"
          >
            {t.events.manageEvents}
          </Button>
          <Button
            component={Link}
            to={`/community/${encodeURIComponent(space.id)}`}
            variant="text"
          >
            {t.spacesPanel.openFeed}
          </Button>
        </Stack>
      }
    >
      {space.archivedAt !== null ? <Alert severity="info" data-testid="space-archived-note">{t.spacesPanel.archivedNote}</Alert> : null}
      <SpaceForm
        mode="edit"
        initial={{
          name: space.name,
          slug: space.slug,
          description: space.description ?? '',
          visibility: space.visibility,
          productIds: space.productIds,
          publicReadOnly: space.publicReadOnly,
          position: space.position,
        }}
        isDefaultHomeSpace={settings.data?.settings.defaultHomeSpaceId === space.id}
        pending={updateSpace.isPending}
        error={updateSpace.isError ? updateSpace.error : null}
        onSubmit={submit}
      />
      <SectionCard title={t.spacesPanel.moderationHeading}>
        <Stack useFlexGap spacing="0.5rem">
          {t.spacesPanel.moderationHint}
        </Stack>
      </SectionCard>
    </PanelPage>
  );
};
