import { useState } from 'react';
import { Alert, Button, Chip, IconButton, Menu, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Survey } from '#core/domain/index.js';
import { TenantLogo } from '../../../branding.js';
import { actions } from '../../../api.js';
import { PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { CopyField } from '../../../components/ui/CopyField.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { usePanelContext } from '../panel-context.js';
import { SurveyEditor } from './SurveyEditor.js';
import { SurveyResults } from './SurveyResults.js';

export const SurveyList = ({ surveys, onEdit, onResults, onToggle, onDelete, pending = false }: { surveys: Survey[]; onEdit: (survey: Survey) => void; onResults: (survey: Survey) => void; onToggle: (survey: Survey) => void; onDelete: (survey: Survey) => void; pending?: boolean }) => {
  const t = useTranslations();
  const [menu, setMenu] = useState<{ anchor: HTMLElement; survey: Survey }>();
  const closeMenu = () => setMenu(undefined);
  const selectAction = (action: (survey: Survey) => void) => {
    if (menu === undefined) return;
    action(menu.survey);
    closeMenu();
  };
  return <SectionCard title={t.surveys.title}><div data-testid="survey-list">{surveys.length === 0 ? <StatusView state={{ kind: 'empty', title: t.surveys.empty }} /> : <ResponsiveTable><Table aria-label={t.surveys.title} sx={(theme) => ({ [theme.breakpoints.down('sm')]: { '& th, & td': { px: 1 } } })}><TableHead><TableRow>{[t.surveys.internalTitle, t.surveys.type, t.surveys.status, t.surveys.actions].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{surveys.map((survey) => <TableRow key={survey.id}><TableCell><Typography>{survey.title}</Typography><Typography variant="caption" color="text.secondary">{`/survey/${survey.slug}`}</Typography></TableCell><TableCell>{survey.type === 'nps' ? t.surveys.nps : t.surveys.stars}</TableCell><TableCell><Chip size="small" label={survey.active ? t.surveys.active : t.surveys.inactive} color={survey.active ? 'success' : 'default'} /></TableCell><TableCell><IconButton aria-label={t.surveys.actions} aria-haspopup="menu" aria-expanded={menu?.survey.id === survey.id} sx={{ display: { xs: 'inline-flex', sm: 'none' } }} onClick={(event) => setMenu({ anchor: event.currentTarget, survey })}><span aria-hidden="true">⋮</span></IconButton><Stack direction="row" useFlexGap sx={{ display: { xs: 'none', sm: 'flex' }, flexWrap: 'wrap' }}><Button onClick={() => onEdit(survey)}>{t.surveys.edit}</Button><Button onClick={() => onResults(survey)}>{t.surveys.results}</Button><Button disabled={pending} onClick={() => onToggle(survey)}>{survey.active ? t.surveys.deactivate : t.surveys.activate}</Button><Button disabled={pending} color="error" onClick={() => onDelete(survey)}>{t.surveys.delete}</Button></Stack></TableCell></TableRow>)}</TableBody></Table></ResponsiveTable>}</div><Menu anchorEl={menu?.anchor} open={menu !== undefined} onClose={closeMenu}><MenuItem onClick={() => selectAction(onEdit)}>{t.surveys.edit}</MenuItem><MenuItem onClick={() => selectAction(onResults)}>{t.surveys.results}</MenuItem><MenuItem disabled={pending} onClick={() => selectAction(onToggle)}>{menu?.survey.active ? t.surveys.deactivate : t.surveys.activate}</MenuItem><MenuItem disabled={pending} onClick={() => selectAction(onDelete)}><Typography color="error">{t.surveys.delete}</Typography></MenuItem></Menu></SectionCard>;
};

const ResultsPanel = ({ survey }: { survey: Survey }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState<unknown>();
  const [exporting, setExporting] = useState(false);
  const results = useQuery(actions.surveys.results(tenant.id, { id: survey.id, page, pageSize: 25 }));
  const download = async () => {
    setExporting(true); setExportError(undefined);
    try {
      const file = await queryClient.fetchQuery(actions.surveys.export(tenant.id, { id: survey.id }));
      const url = URL.createObjectURL(new Blob([file.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `survey-${survey.slug}.csv`; link.click(); URL.revokeObjectURL(url);
    } catch (error) { setExportError(error); } finally { setExporting(false); }
  };
  return <>{exportError === undefined ? null : <Alert severity="error">{localizeError(exportError, t)}</Alert>}{results.isPending ? <StatusView state={{ kind: 'loading', label: t.common.loading }} /> : results.isError ? <StatusView state={{ kind: 'error', message: localizeError(results.error, t), retry: { label: t.common.retry, onRetry: () => void results.refetch() } }} /> : <SurveyResults results={results.data.results} type={survey.type} onPage={setPage} onExport={() => void download()} pending={exporting || results.isFetching} />}</>;
};

export const SurveysPanel = () => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const queryClient = useQueryClient();
  const list = useQuery(actions.surveys.list(tenant.id));
  const routing = useQuery(actions.tenantRouting);
  const create = useMutation(actions.surveys.create);
  const update = useMutation(actions.surveys.update);
  const remove = useMutation(actions.surveys.remove);
  const [editing, setEditing] = useState<Survey | null | undefined>();
  const [selected, setSelected] = useState<Survey>();
  const [deleting, setDeleting] = useState<Survey>();
  const busy = create.isPending || update.isPending || remove.isPending;
  const refresh = () => queryClient.invalidateQueries(actions.surveys.invalidates(tenant.id));
  const mutationError = create.error ?? update.error ?? remove.error;
  const origin = routing.data?.routing.canonicalOrigin ?? window.location.origin;
  return <PanelPage title={t.surveys.title} description={t.surveys.description} action={<Button variant="contained" onClick={() => { setEditing(null); setSelected(undefined); }}>{t.surveys.create}</Button>}>
    {mutationError === null ? null : <Alert severity="error">{localizeError(mutationError, t)}</Alert>}
    {editing === undefined && selected === undefined ? null : <Button sx={{ alignSelf: 'flex-start' }} onClick={() => { setEditing(undefined); setSelected(undefined); }}>{t.surveys.back}</Button>}
    {editing === undefined ? null : <SurveyEditor key={editing?.id ?? 'new'} survey={editing} branding={<TenantLogo />} pending={busy} onCancel={() => setEditing(undefined)} onSave={(input) => { const mutation = editing === null ? create.mutateAsync(input) : update.mutateAsync({ ...input, id: editing.id, expectedRevision: editing.revision }); void mutation.then(async ({ survey }) => { await refresh(); setEditing(undefined); setSelected(survey); }).catch(() => undefined); }} />}
    {selected === undefined ? null : <><CopyField label={t.surveys.publicUrl} value={`${origin}/survey/${selected.slug}`} /><ResultsPanel key={selected.id} survey={selected} /></>}
    {editing === undefined && selected === undefined ? list.isPending ? <StatusView state={{ kind: 'loading', label: t.common.loading }} /> : list.isError ? <StatusView state={{ kind: 'error', message: localizeError(list.error, t), retry: { label: t.common.retry, onRetry: () => void list.refetch() } }} /> : <SurveyList surveys={list.data.surveys} pending={busy} onEdit={(survey) => setEditing(survey)} onResults={setSelected} onDelete={setDeleting} onToggle={(survey) => { void update.mutateAsync({ id: survey.id, title: survey.title, question: survey.question, slug: survey.slug, type: survey.type, commentEnabled: survey.commentEnabled, commentPrompt: survey.commentPrompt, endings: survey.endings, active: !survey.active, expectedRevision: survey.revision }).then(refresh).catch(() => undefined); }} /> : null}
    <ConfirmDialog open={deleting !== undefined} title={t.surveys.delete} body={t.surveys.deleteBody} confirmLabel={t.surveys.delete} cancelLabel={t.common.cancel} pending={remove.isPending} onClose={() => setDeleting(undefined)} onConfirm={() => { if (deleting !== undefined) void remove.mutateAsync({ id: deleting.id }).then(async () => { await refresh(); setDeleting(undefined); }).catch(() => undefined); }} />
  </PanelPage>;
};
