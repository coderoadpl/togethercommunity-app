import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../../api.js';
import { PanelPage } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { SpaceForm, type SpaceFormValues } from './SpaceForm.js';

export const SpaceCreatePage = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const createSpace = useMutation({
    ...actions.createSpace,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.spacesInvalidates());
      await navigate({ to: '/panel/spaces' });
    },
  });

  const submit = (values: SpaceFormValues) =>
    createSpace.mutate({
      slug: values.slug,
      name: values.name,
      description: values.description.trim() === '' ? undefined : values.description.trim(),
      visibility: values.visibility,
      productIds: values.productIds,
    });

  return (
    <PanelPage title={t.spacesPanel.newSpace} backTo={<PanelBackLink to="/panel/spaces">{t.spacesPanel.allSpaces}</PanelBackLink>}>
      <SpaceForm
        mode="create"
        initial={{ name: '', slug: '', description: '', visibility: 'members', productIds: [], position: 0 }}
        pending={createSpace.isPending}
        error={createSpace.isError ? createSpace.error : null}
        onSubmit={submit}
      />
    </PanelPage>
  );
};
