import { useState } from 'react';
import { Alert, Button, Chip, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SalesLink } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { ConfirmDialog, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { CopyField } from '../../../components/ui/CopyField.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { usePanelContext } from '../panel-context.js';
import { SalesLinkEditor } from './SalesLinkEditor.js';

export const SalesLinksPanel = () => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const queryClient = useQueryClient();
  const list = useQuery(actions.salesLinks.list(tenant.id));
  const products = useQuery(actions.products);
  const routing = useQuery(actions.tenantRouting);
  const create = useMutation(actions.salesLinks.create);
  const update = useMutation(actions.salesLinks.update);
  const remove = useMutation(actions.salesLinks.remove);
  const [editing, setEditing] = useState<SalesLink | null | undefined>();
  const [deleting, setDeleting] = useState<SalesLink>();
  const busy = create.isPending || update.isPending || remove.isPending;
  const mutationError = create.error ?? update.error ?? remove.error;
  const refresh = () => queryClient.invalidateQueries(actions.salesLinks.invalidates(tenant.id));
  const origin = routing.data?.routing.canonicalOrigin ?? window.location.origin;
  return <PanelPage title={t.salesLinks.heading} backTo={<PanelBackLink to="/panel/products">{t.products.allProducts}</PanelBackLink>} action={editing === undefined ? <Button variant="contained" onClick={() => setEditing(null)}>{t.salesLinks.create}</Button> : undefined}>
    {mutationError === null ? null : <Alert severity="error">{localizePanelError(mutationError, t)}</Alert>}
    {list.isPending || products.isPending ? <StatusView state={{ kind: 'loading', label: t.common.loading }} /> : list.isError || products.isError ? <StatusView state={{ kind: 'error', message: localizePanelError(list.error ?? products.error, t), retry: { label: t.common.retry, onRetry: () => { void list.refetch(); void products.refetch(); } } }} /> : editing !== undefined ? <SalesLinkEditor key={editing?.id ?? 'new'} salesLink={editing} products={products.data.products} pending={busy} onCancel={() => setEditing(undefined)} onSave={(input) => {
      const operation = editing === null ? create.mutateAsync(input) : update.mutateAsync({ ...input, id: editing.id, expectedRevision: editing.revision });
      void operation.then(async () => { await refresh(); setEditing(undefined); }).catch(() => undefined);
    }} /> : list.data.salesLinks.length === 0 ? <StatusView state={{ kind: 'empty', title: t.salesLinks.empty }} /> : list.data.salesLinks.map((salesLink) => <SectionCard key={salesLink.id} title={salesLink.title}>
      <Chip size="small" sx={{ alignSelf: 'flex-start' }} color={salesLink.active ? 'success' : 'default'} label={salesLink.active ? t.salesLinks.active : t.salesLinks.inactive} />
      <Typography>{salesLink.productIds.map((id) => products.data.products.find((product) => product.id === id)?.title ?? id).join(' · ')}</Typography>
      <CopyField label={t.salesLinks.url} value={`${origin}/offer/${encodeURIComponent(salesLink.slug)}`} />
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap' }} spacing={1}>
        <Button onClick={() => setEditing(salesLink)}>{t.salesLinks.edit}</Button>
        <Button disabled={busy} onClick={() => { const { id, title, heading, slug, description, productIds, listed, validFrom, validTo, revision } = salesLink; void update.mutateAsync({ id, title, heading, slug, description, productIds, listed, validFrom, validTo, active: !salesLink.active, expectedRevision: revision }).then(refresh).catch(() => undefined); }}>{salesLink.active ? t.salesLinks.deactivate : t.salesLinks.activate}</Button>
        <Button color="error" disabled={busy} onClick={() => setDeleting(salesLink)}>{t.salesLinks.remove}</Button>
      </Stack>
    </SectionCard>)}
    <ConfirmDialog open={deleting !== undefined} title={t.salesLinks.remove} body={t.salesLinks.deleteBody} cancelLabel={t.common.cancel} confirmLabel={t.salesLinks.remove} pending={remove.isPending} onClose={() => setDeleting(undefined)} onConfirm={() => { if (deleting !== undefined) void remove.mutateAsync({ id: deleting.id }).then(async () => { await refresh(); setDeleting(undefined); }).catch(() => undefined); }} />
  </PanelPage>;
};
