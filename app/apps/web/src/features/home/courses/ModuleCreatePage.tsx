import { useState, type FormEvent } from 'react';
import { Button, FormControl, FormLabel, OutlinedInput, Stack } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { MutationError } from './feedback.js';

const CreateModuleForm = ({ courseId, onCreated }: { courseId: string; onCreated: () => void }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [prefix, setPrefix] = useState('');
  const errorId = 'create-module-error';

  const createModule = useMutation({
    ...actions.createModule,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.modulesInvalidates());
      onCreated();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createModule.mutate({ courseIds: [courseId], title: title.trim(), prefix: prefix.trim() || null });
  };

  return (
    <SectionCard title={t.courses.newModule} onSubmit={submit}>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: 'flex-end' }}>
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="new-module-title">{t.products.titleLabel}</FormLabel>
          <OutlinedInput
            id="new-module-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            aria-describedby={createModule.isError ? errorId : undefined}
          />
        </FormControl>
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="new-module-prefix">{t.courses.prefixLabel}</FormLabel>
          <OutlinedInput id="new-module-prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} aria-describedby={createModule.isError ? errorId : undefined} />
        </FormControl>
        <Button type="submit" variant="contained" disabled={createModule.isPending || title.trim().length === 0}>
          {createModule.isPending ? t.courses.creatingModule : t.courses.createModule}
        </Button>
      </Stack>
      {createModule.isError ? (
        <MutationError
          error={createModule.error}
          id={errorId}
          fields={[
            { name: 'title', id: 'new-module-title', label: t.products.titleLabel },
            { name: 'prefix', id: 'new-module-prefix', label: t.courses.prefixLabel },
          ]}
        />
      ) : null}
    </SectionCard>
  );
};

export const ModuleCreatePage = ({ courseId, courseName }: { courseId: string; courseName: string }) => {
  const t = useTranslations();
  const navigate = useNavigate();

  return (
    <PanelPage title={t.courses.newModule} backTo={<PanelBackLink to={`/panel/courses/${encodeURIComponent(courseId)}`}>{`← ${courseName}`}</PanelBackLink>}>
      <CreateModuleForm
        courseId={courseId}
        onCreated={() => void navigate({ to: '/panel/courses/$courseId', params: { courseId } })}
      />
    </PanelPage>
  );
};
