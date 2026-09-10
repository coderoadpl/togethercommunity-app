import { useEffect, useState, type ReactNode } from 'react';
import { Box, Button, Chip, FormControl, FormHelperText, FormLabel, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import type { MarketingContactListQuery, MarketingContactView } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { SearchField } from '../../../components/ui/SearchField.js';
import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { usePanelContext } from '../panel-context.js';
import { DirectoryActions, DirectoryError, DirectoryField, DirectoryListSelect, DirectoryPagination, DirectorySelect, directoryTokens, suppressionLabel } from './DirectoryFields.js';

const DirectoryTableLink = styled(Link)(({ theme }) => ({
  color: theme.palette.text.primary,
  fontWeight: 600,
  textDecoration: 'none',
  '&:hover': { textDecoration: 'underline' },
}));

export const ContactMemberLink = ({ memberId }: { memberId: string | null }) => {
  const t = useTranslations();
  return memberId === null ? <>{t.directory.noAccount}</> : <DirectoryTableLink to={`/panel/members/${encodeURIComponent(memberId)}`}>{t.directory.linked}</DirectoryTableLink>;
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

const consentStateLabel = (state: NonNullable<MarketingContactView['consentState']>, t: Messages): string =>
  state === 'active' ? t.directory.activeConsent : state === 'none' ? t.directory.none : state === 'pending_confirmation' ? t.directory.pending_confirmation : t.directory.withdrawn;

const ConsentStateCell = ({ state }: { state: MarketingContactView['consentState'] }) => {
  const t = useTranslations();
  if (state === null) return <>—</>;
  const color = state === 'active' ? 'success' : state === 'pending_confirmation' ? 'info' : state === 'withdrawn' ? 'warning' : 'default';
  return <Chip size="small" color={color} variant={state === 'none' ? 'outlined' : 'filled'} label={consentStateLabel(state, t)} />;
};

export const ContactsTable = ({ contacts, consentDefinition, renderRowActions }: { contacts: MarketingContactView[]; consentDefinition?: string; renderRowActions?: (contact: MarketingContactView) => ReactNode }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return <ResponsiveTable><Table size="small" aria-label={t.directory.contactsTitle}><TableHead><TableRow>{[t.directory.name, t.directory.tags, t.directory.listsTitle, `${t.directory.consentState}${consentDefinition ? ` · ${consentDefinition}` : ''}`, t.directory.suppression, t.directory.member, t.directory.source, t.directory.createdAt, t.directory.actions].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{contacts.map((contact) => <TableRow key={contact.id}>
    <TableCell><DirectoryTableLink to={`/panel/marketing/contacts/${encodeURIComponent(contact.id)}`}>{contact.displayName ?? contact.email}</DirectoryTableLink><Typography variant="body2">{contact.email}</Typography></TableCell>
    <TableCell>{contact.tags.join(' · ') || '—'}</TableCell><TableCell><span title={contact.listKeys.join(', ')}>{contact.listKeys.slice(0, 2).join(', ')}{contact.listKeys.length > 2 ? ` +${contact.listKeys.length - 2}` : ''}</span></TableCell>
    <TableCell><ConsentStateCell state={consentDefinition ? contact.consentState : null} /></TableCell>
    <TableCell>{contact.suppressionReason === null ? t.directory.notSuppressed : <Chip size="small" color="warning" label={`${t.directory.suppressed}: ${suppressionLabel(contact.suppressionReason, t)}`} />}</TableCell>
    <TableCell><ContactMemberLink memberId={contact.memberId} /></TableCell><TableCell>{contact.source}</TableCell><TableCell>{formatDateTime(contact.createdAt, language)}</TableCell><TableCell>{renderRowActions ? renderRowActions(contact) : <ContactArchiveAction contact={contact} />}</TableCell>
  </TableRow>)}</TableBody></Table></ResponsiveTable>;
};

const hasFilters = (query: MarketingContactListQuery): boolean =>
  (query.search ?? '').trim().length > 0 ||
  (query.tags ?? []).length > 0 ||
  query.listId !== undefined ||
  query.consentState !== undefined ||
  query.suppressed !== undefined ||
  query.linkedMember !== undefined ||
  query.archived === true;

const FilterGrid = ({ children }: { children: ReactNode }) => (
  <Box
    sx={{
      display: 'grid',
      gap: '1rem',
      gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' },
    }}
  >
    {children}
  </Box>
);

export const ContactsPanel = () => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const navigate = useNavigate();
  const [query, setQuery] = useState<MarketingContactListQuery>({ limit: 50, archived: false });
  const [tags, setTags] = useState('');
  const [defaultConsentApplied, setDefaultConsentApplied] = useState(false);
  const definitions = useQuery(actions.marketingConsents);
  const activeDefinitions = (definitions.data?.definitions ?? []).filter((item) => item.status === 'active' && item.kind === 'optional_marketing');
  const defaultConsentDefinitionId = activeDefinitions.length === 1 ? activeDefinitions[0]?.id : undefined;
  useEffect(() => {
    if (!defaultConsentApplied && query.consentDefinitionId === undefined && defaultConsentDefinitionId !== undefined) {
      setQuery((previous) => ({ ...previous, consentDefinitionId: previous.consentDefinitionId ?? defaultConsentDefinitionId }));
      setDefaultConsentApplied(true);
    }
  }, [defaultConsentApplied, defaultConsentDefinitionId, query.consentDefinitionId]);
  const contactsQueryEnabled = !definitions.isPending && (defaultConsentDefinitionId === undefined || defaultConsentApplied || query.consentDefinitionId !== undefined);
  const contacts = useQuery({ ...actions.directory.contacts(tenant.id, query), enabled: contactsQueryEnabled });
  const change = (input: Partial<MarketingContactListQuery>) => setQuery((previous) => ({ ...previous, ...input, cursor: undefined }));
  const resetFilters = () => { setTags(''); setQuery({ limit: 50, archived: false }); };
  const definition = definitions.data?.definitions.find((item) => item.id === query.consentDefinitionId);
  const filtered = hasFilters(query);
  const empty = contacts.data?.contacts.length === 0;
  const emptyDirectory = empty && !filtered;
  return <PanelPage title={t.directory.contactsTitle} description={t.directory.contactsDescription} action={<DirectoryActions><Button onClick={() => void navigate({ to: "/panel/marketing/contacts/import", search: { kind: 'suppressions' } })}>{t.directory.suppressionImport}</Button><Button component={Link} to="/panel/marketing/contacts/import" variant="contained">{t.directory.importTitle}</Button></DirectoryActions>}>
    <SectionCard title={t.directory.contactsSectionTitle}>
        {emptyDirectory ? null : <FilterGrid>
          <FormControl fullWidth sx={{ minWidth: 0 }}><FormLabel htmlFor="contacts-search-input">{t.directory.searchLabel}</FormLabel><SearchField id="contacts-search-input" fullWidth value={query.search ?? ''} onChange={(search) => change({ search })} label={t.directory.searchLabel} placeholder={t.directory.search} testId="contacts-search" /><FormHelperText>{t.directory.searchHint}</FormHelperText></FormControl>
          <DirectoryField label={t.directory.tags} value={tags} onChange={(value) => { setTags(value); change({ tags: directoryTokens(value) }); }} helperText={t.directory.tagsHint} />
          <DirectoryListSelect value={query.listId ?? ''} onChange={(listId) => change({ listId: listId || undefined })} helperText={t.directory.listHint} />
          <DirectorySelect label={t.directory.consentDefinition} value={query.consentDefinitionId ?? ''} onChange={(consentDefinitionId) => change({ consentDefinitionId: consentDefinitionId || undefined, consentState: undefined })} helperText={t.directory.consentDefinitionHint} options={[{ value: '', label: t.directory.all }, ...(definitions.data?.definitions.map((item) => ({ value: item.id, label: item.key })) ?? [])]} />
          <DirectorySelect label={t.directory.consentState} value={query.consentState ?? ''} disabled={query.consentDefinitionId === undefined} helperText={query.consentDefinitionId === undefined ? t.directory.consentStateDisabledHint : t.directory.consentStateHint} onChange={(consentState) => change({ consentState: consentState || undefined })} options={(['', 'none', 'pending_confirmation', 'active', 'withdrawn'] as const).map((value) => ({ value, label: value === '' ? t.directory.all : consentStateLabel(value, t) }))} />
          <DirectorySelect label={t.directory.suppression} value={query.suppressed === undefined ? '' : String(query.suppressed)} onChange={(value) => change({ suppressed: value ? value === 'true' : undefined })} helperText={t.directory.suppressionHint} options={[{ value: '', label: t.directory.all }, { value: 'true', label: t.directory.suppressed }, { value: 'false', label: t.directory.notSuppressed }]} />
          <DirectorySelect label={t.directory.member} value={query.linkedMember === undefined ? '' : String(query.linkedMember)} onChange={(value) => change({ linkedMember: value ? value === 'true' : undefined })} helperText={t.directory.memberHint} options={[{ value: '', label: t.directory.all }, { value: 'true', label: t.directory.linked }, { value: 'false', label: t.directory.noAccount }]} />
          <DirectorySelect label={t.directory.archiveState} value={query.archived ? 'true' : 'false'} onChange={(value) => change({ archived: value === 'true' })} helperText={t.directory.archiveStateHint} options={[{ value: 'false', label: t.directory.active }, { value: 'true', label: t.directory.archived }]} />
        </FilterGrid>}
        <DirectoryError error={definitions.error ?? contacts.error} />
        {contacts.isPending || definitions.isPending ? <StatusView state={{ kind: 'loading', label: t.directory.loading }} /> : emptyDirectory ? <StatusView surface={false} state={{ kind: 'empty', title: t.directory.emptyDirectoryTitle, body: t.directory.emptyDirectoryBody, action: <Button component={Link} to="/panel/marketing/contacts/import" variant="contained">{t.directory.importTitle}</Button> }} /> : empty ? <StatusView surface={false} state={{ kind: 'empty', title: t.directory.empty, action: <Button onClick={resetFilters}>{t.directory.clearFilters}</Button> }} /> : <>{definition === undefined ? <Typography variant="body2" color="text.secondary">{t.directory.selectConsent}</Typography> : null}<ContactsTable contacts={contacts.data?.contacts ?? []} {...(definition ? { consentDefinition: definition.key } : {})} /></>}
        <DirectoryPagination cursor={query.cursor} nextCursor={contacts.data?.nextCursor} onChange={(cursor) => setQuery((previous) => ({ ...previous, cursor }))} />
    </SectionCard>
  </PanelPage>;
};
