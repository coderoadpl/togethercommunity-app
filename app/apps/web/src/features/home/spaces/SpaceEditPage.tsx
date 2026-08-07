import { Alert, Button, Stack } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { StaffSpace } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';
import { SpaceForm, type SpaceFormValues } from './SpaceForm.js';

export const SpaceEditPage = ({ space }: { space: StaffSpace }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
      position: values.position,
    });

  return (
    <PanelPage
      title={space.name}
      description={space.slug}
      backTo={{ label: t.spacesPanel.allSpaces, href: '/panel/spaces' }}
      action={
        <Button
          component="a"
          href={`/community/${encodeURIComponent(space.id)}`}
          variant="text"
        >
          {t.spacesPanel.openFeed}
        </Button>
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
          position: space.position,
        }}
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
