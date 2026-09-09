import { useState } from 'react';
import { Button, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import type { MarketingContactListQuery, MarketingContactView } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { SearchField } from '../../../components/ui/SearchField.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { usePanelContext } from '../panel-context.js';
import { DirectoryActions, DirectoryError, DirectoryField, DirectoryListSelect, DirectoryPagination, DirectorySelect, directoryTokens, suppressionLabel } from './DirectoryFields.js';

export const ContactMemberLink = ({ memberId }: { memberId: string | null }) => {
  const t = useTranslations();
  return memberId === null ? <>{t.directory.noAccount}</> : <Link to="/panel/members/$memberId" params={{ memberId }}>{t.directory.linked}</Link>;
};

export const ContactArchiveAction = ({ contact }: { contact: Pick<MarketingContactView, 'id' | 'archivedAt'> }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const cache = useQueryClient();
  const onSuccess = async () => cache.invalidateQueries(actions.directory.invalidates(tenant.id));
  const archive = useMutation({ ...actions.directory.archiveMarketingContact, onSuccess });
  const restore = useMutation({ ...actions.directory.restoreMarketingContact, onSuccess });
  const action = contact.archivedAt === null ? archive : restore;
  return <><Button disabled={action.isPending} onClick={() => action.mutate({ contactId: contact.id })}>{contact.archivedAt === null ? t.directory.archive : t.directory.restore}</Button><DirectoryError error={action.error} /></>;
};

export const ContactsTable = ({ contacts, consentDefinition, renderRowActions }: { contacts: MarketingContactView[]; consentDefinition?: string; renderRowActions?: (contact: MarketingContactView) => React.ReactNode }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return <ResponsiveTable><Table size="small" aria-label={t.directory.contactsTitle}><TableHead><TableRow>{[t.directory.name, t.directory.tags, t.directory.listsTitle, `${t.directory.consentState}${consentDefinition ? ` · ${consentDefinition}` : ''}`, t.directory.suppression, t.directory.member, t.directory.source, t.directory.createdAt, t.directory.actions].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{contacts.map((contact) => <TableRow key={contact.id}>
    <TableCell><Link to="/panel/marketing/contacts/$contactId" params={{ contactId: contact.id }}>{contact.displayName ?? contact.email}</Link><Typography variant="body2">{contact.email}</Typography></TableCell>
    <TableCell>{contact.tags.join(' · ') || '—'}</TableCell><TableCell><span title={contact.listKeys.join(', ')}>{contact.listKeys.slice(0, 2).join(', ')}{contact.listKeys.length > 2 ? ` +${contact.listKeys.length - 2}` : ''}</span></TableCell>
    <TableCell>{consentDefinition && contact.consentState !== null ? (contact.consentState === 'active' ? t.directory.activeConsent : t.directory[contact.consentState]) : t.directory.selectConsent}</TableCell>
    <TableCell>{contact.suppressionReason === null ? t.directory.notSuppressed : <Chip size="small" color="warning" label={`${t.directory.suppressed}: ${suppressionLabel(contact.suppressionReason, t)}`} />}</TableCell>
    <TableCell><ContactMemberLink memberId={contact.memberId} /></TableCell><TableCell>{contact.source}</TableCell><TableCell>{formatDateTime(contact.createdAt, language)}</TableCell><TableCell>{renderRowActions ? renderRowActions(contact) : <ContactArchiveAction contact={contact} />}</TableCell>
  </TableRow>)}</TableBody></Table></ResponsiveTable>;
};

export const ContactsPanel = () => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const navigate = useNavigate();
  const [query, setQuery] = useState<MarketingContactListQuery>({ limit: 50, archived: false });
  const [tags, setTags] = useState('');
  const contacts = useQuery(actions.directory.contacts(tenant.id, query));
  const definitions = useQuery(actions.marketingConsents);
  const change = (input: Partial<MarketingContactListQuery>) => setQuery((previous) => ({ ...previous, ...input, cursor: undefined }));
  const definition = definitions.data?.definitions.find((item) => item.id === query.consentDefinitionId);
  return <PanelPage title={t.directory.contactsTitle} description={t.directory.contactsDescription} action={<DirectoryActions><Button onClick={() => void navigate({ to: "/panel/marketing/contacts/import", search: { kind: 'suppressions' } })}>{t.directory.suppressionImport}</Button><Button component={Link} to="/panel/marketing/contacts/import" variant="contained">{t.directory.importTitle}</Button></DirectoryActions>}>
    <SectionCard title={t.directory.contactsTitle}>
      <SearchField value={query.search ?? ''} onChange={(search) => change({ search })} label={t.directory.search} placeholder={t.directory.search} testId="contacts-search" />
      <Stack direction={{ xs: 'column', md: 'row' }} useFlexGap spacing="1rem"><DirectoryField label={t.directory.tags} value={tags} onChange={(value) => { setTags(value); change({ tags: directoryTokens(value) }); }} /><DirectoryListSelect value={query.listId ?? ''} onChange={(listId) => change({ listId: listId || undefined })} /><DirectorySelect label={t.directory.consentDefinition} value={query.consentDefinitionId ?? ''} onChange={(consentDefinitionId) => change({ consentDefinitionId: consentDefinitionId || undefined, consentState: undefined })} options={[{ value: '', label: t.directory.all }, ...(definitions.data?.definitions.map((item) => ({ value: item.id, label: item.key })) ?? [])]} /></Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} useFlexGap spacing="1rem">
        <DirectorySelect label={t.directory.consentState} value={query.consentState ?? ''} disabled={!query.consentDefinitionId} onChange={(consentState) => change({ consentState: consentState || undefined })} options={(['', 'none', 'pending_confirmation', 'active', 'withdrawn'] as const).map((value) => ({ value, label: value === '' ? t.directory.all : value === 'none' ? t.directory.none : value === 'pending_confirmation' ? t.directory.pending_confirmation : value === 'active' ? t.directory.activeConsent : t.directory.withdrawn }))} />
        <DirectorySelect label={t.directory.suppression} value={query.suppressed === undefined ? '' : String(query.suppressed)} onChange={(value) => change({ suppressed: value ? value === 'true' : undefined })} options={[{ value: '', label: t.directory.all }, { value: 'true', label: t.directory.suppressed }, { value: 'false', label: t.directory.notSuppressed }]} />
        <DirectorySelect label={t.directory.member} value={query.linkedMember === undefined ? '' : String(query.linkedMember)} onChange={(value) => change({ linkedMember: value ? value === 'true' : undefined })} options={[{ value: '', label: t.directory.all }, { value: 'true', label: t.directory.linked }, { value: 'false', label: t.directory.noAccount }]} />
        <DirectorySelect label={t.directory.archiveState} value={query.archived ? 'true' : 'false'} onChange={(value) => change({ archived: value === 'true' })} options={[{ value: 'false', label: t.directory.active }, { value: 'true', label: t.directory.archived }]} />
      </Stack>
      <DirectoryError error={definitions.error ?? contacts.error} />
      {contacts.isPending ? <StatusView state={{ kind: 'loading', label: t.directory.loading }} /> : contacts.data?.contacts.length === 0 ? <StatusView state={{ kind: 'empty', title: t.directory.empty }} /> : <ContactsTable contacts={contacts.data?.contacts ?? []} {...(definition ? { consentDefinition: definition.key } : {})} />}
      <DirectoryPagination cursor={query.cursor} nextCursor={contacts.data?.nextCursor} onChange={(cursor) => setQuery((previous) => ({ ...previous, cursor }))} />
    </SectionCard>
  </PanelPage>;
};
