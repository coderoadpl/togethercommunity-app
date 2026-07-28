import { useState, type FormEvent } from 'react';
import { Alert, Button, FormControl, FormLabel, OutlinedInput, Stack } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from '@tanstack/react-router';

import type { EmailLayout } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ListSection, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { MarketingSummaryRow } from './MarketingSummaryRow.js';

const LayoutForm = ({ layout }: { layout?: EmailLayout | undefined }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(layout?.name ?? '');
  const [bodyHtml, setBodyHtml] = useState(layout?.bodyHtml ?? '<html><body>{{{content}}}</body></html>');
  const save = useMutation({
    ...actions.saveMarketingLayout,
    onSuccess: async ({ layout: saved }) => {
      await queryClient.invalidateQueries(actions.marketingInvalidates());
      if (layout === undefined) await navigate({ to: '/panel/marketing/layouts/$layoutId', params: { layoutId: saved.id } });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ ...(layout === undefined ? {} : { layoutId: layout.id }), name, bodyHtml });
  };
  return (
    <SectionCard title={t.marketing.layoutEditor} description={t.marketing.layoutSlotHint} onSubmit={submit} actions={<Button type="submit" variant="contained" disabled={save.isPending}>{save.isPending ? t.marketing.saving : t.marketing.save}</Button>}>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-layout-name">{t.marketing.nameLabel}</FormLabel>
        <OutlinedInput id="marketing-layout-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-layout-html">{t.marketing.layoutHtmlLabel}</FormLabel>
        <OutlinedInput id="marketing-layout-html" value={bodyHtml} onChange={(event) => setBodyHtml(event.target.value)} multiline minRows={12} required />
      </FormControl>
      {save.isError ? <Alert>{localizeError(save.error, t)}</Alert> : null}
    </SectionCard>
  );
};

export const LayoutsPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const layouts = useQuery(actions.marketingLayouts);
  const navigate = useNavigate();
  return (
    <PanelPage title={t.marketing.layoutsTitle} description={t.marketing.layoutsDescription} action={<Button component={Link} to="/panel/marketing/layouts/new" variant="contained">+ {t.common.add}</Button>}>
      <ListSection isEmpty={layouts.isSuccess && layouts.data.layouts.length === 0} empty={<StatusView state={{ kind: 'empty', title: t.marketing.layoutsEmpty, action: <Button component={Link} to="/panel/marketing/layouts/new">+ {t.common.add}</Button> }} />}>
        {layouts.isPending ? <StatusView state={{ kind: 'loading', label: t.marketing.layoutsLoading }} /> : layouts.isError ? <StatusView state={{ kind: 'error', message: localizeError(layouts.error, t) }} /> : (
          <Stack spacing="1rem">
            {layouts.data.layouts.map((layout) => (
              <MarketingSummaryRow key={layout.id} title={layout.name} summary={t.marketing.layoutSlotHint} date={formatDateTime(layout.updatedAt, language)} actions={<Button onClick={() => void navigate({ to: '/panel/marketing/layouts/$layoutId', params: { layoutId: layout.id } })}>{t.marketing.layoutEditor}</Button>} testId="marketing-layout-row" />
            ))}
          </Stack>
        )}
      </ListSection>
    </PanelPage>
  );
};

export const LayoutCreatePage = () => {
  const t = useTranslations();
  return <PanelPage title={t.marketing.newLayout} backTo={{ label: t.marketing.allLayouts, href: '/panel/marketing/layouts' }}><LayoutForm /></PanelPage>;
};

export const LayoutDetailPage = () => {
  const t = useTranslations();
  const params = useParams({ strict: false });
  const layouts = useQuery(actions.marketingLayouts);
  if (layouts.isPending) return <PanelPage title={t.marketing.layoutsTitle} state={{ kind: 'loading', label: t.marketing.layoutsLoading }} />;
  if (layouts.isError) return <PanelPage title={t.marketing.layoutsTitle} state={{ kind: 'error', message: localizeError(layouts.error, t) }} />;
  const layout = layouts.data.layouts.find((entry) => entry.id === params.layoutId);
  if (layout === undefined) return <Navigate to="/panel/marketing/layouts" />;
  return <PanelPage title={layout.name} backTo={{ label: t.marketing.allLayouts, href: '/panel/marketing/layouts' }}><LayoutForm layout={layout} /></PanelPage>;
};
