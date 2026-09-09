import { useState } from 'react';
import { Alert, Button, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';

import { marketingListCreateSchema, type MarketingList, type MarketingListRule } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { SearchField } from '../../../components/ui/SearchField.js';
import { useTranslations } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { usePanelContext } from '../panel-context.js';
import { ContactsTable } from './ContactsPanel.js';
import { DirectoryError, DirectoryField, DirectoryPagination, DirectorySelect } from './DirectoryFields.js';
import { MarketingListRuleEditor } from './MarketingListRuleEditor.js';

const ListMemberships = ({ list }: { list: MarketingList }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const cache = useQueryClient();
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [candidateCursor, setCandidateCursor] = useState<string>();
  const [consentDefinitionId, setConsentDefinitionId] = useState('');
  const consents = useQuery(actions.marketingConsents);
  const members = useQuery(actions.directory.listContacts(tenant.id, { listId: list.id, limit: 20, ...(cursor ? { cursor } : {}), ...(consentDefinitionId ? { consentDefinitionId } : {}) }));
  const candidates = useQuery({ ...actions.directory.contacts(tenant.id, { search, limit: 20, archived: false, ...(candidateCursor ? { cursor: candidateCursor } : {}) }), enabled: list.kind === 'static' && list.archivedAt === null && search.trim().length > 0 });
  const onSuccess = async () => cache.invalidateQueries(actions.directory.invalidates(tenant.id));
  const add = useMutation({ ...actions.directory.addMarketingListContacts, onSuccess });
  const remove = useMutation({ ...actions.directory.removeMarketingListContacts, onSuccess });
  const editable = list.kind === 'static' && list.archivedAt === null;
  const definition = consents.data?.definitions.find((item) => item.id === consentDefinitionId);
  return <SectionCard title={list.kind === 'static' ? t.directory.memberships : t.directory.preview}>
    <DirectorySelect label={t.directory.consentDefinition} value={consentDefinitionId} onChange={(id) => { setConsentDefinitionId(id); setCursor(undefined); }} options={[{ value: '', label: t.directory.contactsOnly }, ...(consents.data?.definitions.map((item) => ({ value: item.id, label: item.key })) ?? [])]} />
    {members.data ? <Typography>{t.directory.contactCount}: {members.data.counts.contactCount} · {t.directory.suppressedCount}: {members.data.counts.suppressedCount} · {t.directory.eligibleCount}: {members.data.counts.eligibleCount ?? '—'}</Typography> : null}
    <DirectoryError error={members.error ?? consents.error ?? add.error ?? remove.error} />
    <ContactsTable contacts={members.data?.contacts ?? []} {...(definition ? { consentDefinition: definition.key } : {})} renderRowActions={(contact) => editable ? <Button disabled={remove.isPending} onClick={() => remove.mutate({ listId: list.id, contactIds: [contact.id] })}>{t.directory.remove}</Button> : null} />
    <DirectoryPagination cursor={cursor} nextCursor={members.data?.nextCursor} onChange={setCursor} />
    {editable ? <><SearchField value={search} onChange={(value) => { setSearch(value); setCandidateCursor(undefined); }} label={t.directory.search} placeholder={t.directory.search} testId="list-contact-search" />{search.trim() ? <><DirectoryError error={candidates.error} /><ContactsTable contacts={candidates.data?.contacts ?? []} renderRowActions={(contact) => <Button disabled={add.isPending || contact.listKeys.includes(list.key)} onClick={() => add.mutate({ listId: list.id, contactIds: [contact.id] })}>{t.directory.add}</Button>} /><DirectoryPagination cursor={candidateCursor} nextCursor={candidates.data?.nextCursor} onChange={setCandidateCursor} /></> : null}</> : null}
  </SectionCard>;
};

const ListForm = ({ list }: { list?: MarketingList }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(list?.name ?? '');
  const [key, setKey] = useState(list?.key ?? '');
  const [kind, setKind] = useState<'static' | 'dynamic'>(list?.kind ?? 'static');
  const [rule, setRule] = useState<MarketingListRule>(list?.rule ?? { kind: 'tag', tags: [], match: 'any' });
  const onSuccess = async () => cache.invalidateQueries(actions.directory.invalidates(tenant.id));
  const create = useMutation({ ...actions.directory.createMarketingList, onSuccess: async ({ list: saved }) => { await onSuccess(); await navigate({ to: '/panel/marketing/lists/$listId', params: { listId: saved.id } }); } });
  const update = useMutation({ ...actions.directory.updateMarketingList, onSuccess });
  const archive = useMutation({ ...actions.directory.archiveMarketingList, onSuccess });
  const valid = marketingListCreateSchema.safeParse({ key, name, rule: kind === 'dynamic' ? rule : null }).success;
  const pending = create.isPending || update.isPending || archive.isPending;
  return <SectionCard title={list?.name ?? t.directory.newList} onSubmit={(event) => { event.preventDefault(); if (!valid || pending) return; if (list) update.mutate({ listId: list.id, expectedRevision: list.revision, name, ...(kind === 'dynamic' ? { rule } : {}) }); else create.mutate({ key, name, rule: kind === 'dynamic' ? rule : null }); }} actions={<><Button type="submit" variant="contained" disabled={!valid || pending || list?.archivedAt != null}>{t.directory.save}</Button>{list && list.archivedAt === null ? <Button disabled={pending} onClick={() => archive.mutate({ listId: list.id, expectedRevision: list.revision })}>{t.directory.archive}</Button> : null}</>}>
    <DirectoryField label={t.directory.name} value={name} onChange={setName} required maxLength={200} /><DirectoryField label={t.directory.key} value={key} onChange={setKey} required disabled={list !== undefined} maxLength={120} />
    <DirectorySelect label={t.directory.kind} value={kind} onChange={setKind} disabled={list !== undefined} options={[{ value: 'static', label: t.directory.static }, { value: 'dynamic', label: t.directory.dynamic }]} />
    {kind === 'dynamic' ? <><MarketingListRuleEditor rule={rule} onChange={setRule} /><Alert severity="info">{t.directory.savePreview}</Alert></> : null}
    <DirectoryError error={create.error ?? update.error ?? archive.error} />
  </SectionCard>;
};

export const ListCreatePanel = () => {
  const t = useTranslations();
  return <PanelPage title={t.directory.newList} backTo={<PanelBackLink to="/panel/marketing/lists">{t.directory.listsTitle}</PanelBackLink>}><ListForm /></PanelPage>;
};

export const ListDetailPanel = () => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const { listId } = useParams({ strict: false });
  const detail = useQuery(actions.directory.list(tenant.id, { listId: listId ?? '' }));
  return <PanelPage title={detail.data?.list.name ?? t.directory.listsTitle} backTo={<PanelBackLink to="/panel/marketing/lists">{t.directory.listsTitle}</PanelBackLink>}><DirectoryError error={detail.error} />{detail.isPending ? <StatusView state={{ kind: 'loading', label: t.directory.loading }} /> : null}{detail.data ? <><ListForm key={`${detail.data.list.id}:${detail.data.list.revision}`} list={detail.data.list} /><ListMemberships list={detail.data.list} /></> : null}</PanelPage>;
};
