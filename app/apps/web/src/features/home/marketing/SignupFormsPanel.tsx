import { en } from '../../../i18n/en.js';
import { pl } from '../../../i18n/pl.js';
import { useState } from 'react';
import { Alert, Button, FormControlLabel, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { marketingSignupFormInputSchema, type Language, type MarketingSignupForm } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { CopyField } from '../../../components/ui/CopyField.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { usePanelContext } from '../panel-context.js';
import { DirectoryField, DirectorySelect, DirectoryListSelect, DirectoryError, directoryTokens } from './DirectoryFields.js';

const escapeAttribute = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
const EmbedPanel = ({ form }: { form: MarketingSignupForm }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [labelLanguage, setLabelLanguage] = useState<Language>(language);
  const routing = useQuery(actions.tenantRouting);
  const origin = routing.data?.routing.canonicalOrigin;
  if (origin === undefined) return <DirectoryError error={routing.error} />;
  const labels = (labelLanguage === 'pl' ? pl : en).signupForms;
  const action = `${origin}/api/public/marketing/forms/${form.slug}/submit`;
  const hosted = `${origin}/marketing/forms/${form.slug}`;
  const html = `<form method="post" action="${escapeAttribute(action)}">\n  <label>${escapeAttribute(labels.email)} <input name="email" type="email" autocomplete="email" maxlength="254" required></label>\n${form.collectName ? `  <label>${escapeAttribute(labels.displayName)} <input name="displayName" autocomplete="name" maxlength="120"></label>\n` : ''}  <div hidden aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>\n  <input type="hidden" name="token" value="${escapeAttribute(form.token)}">\n  <p>${escapeAttribute(form.consentVersion.label)}</p>\n  <button type="submit">${escapeAttribute(labels.submit)}</button>\n</form>`;
  const json = `fetch(${JSON.stringify(action)}, {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({\n    email: "reader@example.org",${form.collectName ? '\n    displayName: "Reader",' : ''}\n    website: "",\n    token: ${JSON.stringify(form.token)}\n  })\n}).then(response => {\n  if (!response.ok) throw new Error(String(response.status));\n  return response.json();\n});`;
  return <SectionCard title={t.signupForms.embed} description={t.signupForms.embedHelp}><Stack spacing={2}>
    <DirectorySelect label={t.signupForms.labelLanguage} value={labelLanguage} onChange={setLabelLanguage} options={[{ value: 'en', label: t.common.languageEnglish }, { value: 'pl', label: t.common.languagePolish }]} />
    <CopyField label={t.signupForms.hostedLink} value={hosted} />
    <CopyField label={t.signupForms.htmlEmbed} value={html} multiline />
    <CopyField label={t.signupForms.jsonExample} value={json} multiline />
  </Stack></SectionCard>;
};
const SignupEditor = ({ form, onSaved, onCancel }: { form: MarketingSignupForm | null; onSaved: (form: MarketingSignupForm) => void; onCancel: () => void }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const queryClient = useQueryClient();
  const definitions = useQuery(actions.marketingConsents);
  const create = useMutation(actions.directory.createSignupForm);
  const update = useMutation(actions.directory.updateSignupForm);
  const [name, setName] = useState(form?.name ?? '');
  const [slug, setSlug] = useState(form?.slug ?? '');
  const [definitionId, setDefinitionId] = useState(form?.consentDefinitionId ?? '');
  const [listId, setListId] = useState(form?.listId ?? '');
  const [tags, setTags] = useState(form?.tags.join(' | ') ?? '');
  const [collectName, setCollectName] = useState(form?.collectName ?? false);
  const [successEn, setSuccessEn] = useState(form?.successText.en ?? en.signupForms.defaultSuccessEn);
  const [successPl, setSuccessPl] = useState(form?.successText.pl ?? pl.signupForms.defaultSuccessPl);
  const [redirect, setRedirect] = useState(form?.redirectUrl ?? '');
  const [origins, setOrigins] = useState(form?.allowedOrigins.join('\n') ?? '');
  const [status, setStatus] = useState<'active' | 'archived'>(form?.status ?? 'active');
  const [invalid, setInvalid] = useState(false);
  const busy = create.isPending || update.isPending;
  const save = async () => {
    const parsed = marketingSignupFormInputSchema.safeParse({ name, slug, consentDefinitionId: definitionId, listId: listId || null, tags: directoryTokens(tags), collectName, successText: { en: successEn, pl: successPl }, redirectUrl: redirect || null, allowedOrigins: origins.split('\n').map((value) => value.trim()).filter(Boolean), status });
    setInvalid(!parsed.success);
    if (!parsed.success) return;
    const result = form === null ? await create.mutateAsync(parsed.data) : await update.mutateAsync({ ...parsed.data, expectedRevision: form.revision });
    await queryClient.invalidateQueries(actions.directory.invalidates(tenant.id));
    onSaved(result.form);
  };
  return <SectionCard title={form === null ? t.signupForms.create : t.signupForms.edit} description={t.signupForms.editorHelp}><Stack component="form" spacing={2} onSubmit={(event) => { event.preventDefault(); void save().catch(() => undefined); }}>
    <DirectoryField label={t.directory.name} value={name} onChange={setName} maxLength={200} required />
    <DirectoryField label={t.signupForms.slug} value={slug} onChange={setSlug} maxLength={80} required disabled={form !== null} />
    <DirectorySelect label={t.signupForms.consent} value={definitionId} onChange={setDefinitionId} options={[{ value: '', label: t.signupForms.chooseConsent }, ...(definitions.data?.definitions.filter((definition) => definition.status === 'active' && definition.kind === 'optional_marketing').map((definition) => ({ value: definition.id, label: `${definition.key} · ${definition.doubleOptIn ? t.signupForms.doubleOptIn : t.signupForms.singleOptIn}` })) ?? [])]} />
    <DirectoryError error={definitions.error} />
    <DirectoryListSelect emptyLabel={t.signupForms.noList} label={t.signupForms.list} value={listId} onChange={setListId} staticOnly helperText={t.signupForms.listHelp} />
    <DirectoryField label={t.signupForms.tags} value={tags} onChange={setTags} />
    <FormControlLabel control={<Switch checked={collectName} onChange={(_, checked) => setCollectName(checked)} />} label={t.signupForms.collectName} />
    <DirectoryField label={t.signupForms.successEn} value={successEn} onChange={setSuccessEn} multiline required maxLength={500} />
    <DirectoryField label={t.signupForms.successPl} value={successPl} onChange={setSuccessPl} multiline required maxLength={500} />
    <DirectoryField label={t.signupForms.redirect} value={redirect} onChange={setRedirect} helperText={t.signupForms.redirectHelp} />
    <DirectoryField label={t.signupForms.origins} value={origins} onChange={setOrigins} multiline helperText={t.signupForms.originsHelp} />
    <DirectorySelect label={t.directory.archiveState} value={status} onChange={setStatus} options={[{ value: 'active', label: t.directory.active }, { value: 'archived', label: t.directory.archived }]} />
    {invalid ? <Alert severity="error">{t.signupForms.invalid}</Alert> : null}<DirectoryError error={create.error ?? update.error} />
    <Stack direction="row" spacing={1}><Button type="submit" variant="contained" disabled={busy}>{t.common.save}</Button><Button onClick={onCancel}>{t.common.cancel}</Button></Stack>
  </Stack></SectionCard>;
};
export const SignupFormsPanel = () => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const forms = useQuery(actions.directory.signupForms(tenant.id));
  const [editing, setEditing] = useState<MarketingSignupForm | null | undefined>();
  const [embed, setEmbed] = useState<MarketingSignupForm>();
  return <PanelPage title={t.signupForms.title} description={t.signupForms.description} action={<Button variant="contained" onClick={() => { setEditing(null); setEmbed(undefined); }}>{t.signupForms.create}</Button>}>
    <DirectoryError error={forms.error} />
    {editing !== undefined ? <SignupEditor key={editing?.id ?? 'new'} form={editing} onSaved={(form) => { setEditing(undefined); setEmbed(form); }} onCancel={() => setEditing(undefined)} /> : null}
    {embed === undefined ? null : <EmbedPanel form={embed} />}
    <SectionCard title={t.signupForms.title}>{forms.isPending ? <StatusView state={{ kind: 'loading', label: t.common.loading }} /> : forms.data?.forms.length === 0 ? <StatusView state={{ kind: 'empty', title: t.signupForms.empty }} /> : <ResponsiveTable><Table aria-label={t.signupForms.title}><TableHead><TableRow>{[t.directory.name, t.directory.archiveState, t.signupForms.last24h, t.signupForms.last7d, t.signupForms.total, t.signupForms.confirmed, t.signupForms.pending, t.signupForms.actions].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{forms.data?.forms.map(({ form, counters }) => <TableRow key={form.id}>
      <TableCell><Typography>{form.name}</Typography><Typography variant="caption">{form.slug}</Typography></TableCell><TableCell>{form.status === 'active' ? t.directory.active : t.directory.archived}</TableCell>
      {[counters.submissions24h, counters.submissions7d, counters.submissionsTotal, counters.confirmed, counters.pending].map((value, index) => <TableCell key={index}>{value}</TableCell>)}
      <TableCell><Button onClick={() => { setEditing(form); setEmbed(undefined); }}>{t.signupForms.edit}</Button><Button onClick={() => { setEmbed(form); setEditing(undefined); }}>{t.signupForms.embed}</Button></TableCell>
    </TableRow>)}</TableBody></Table></ResponsiveTable>}</SectionCard>
  </PanelPage>;
};
