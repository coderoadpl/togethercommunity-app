import { ContactSendsSection } from './ContactSendsSection.js';
import { useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import type { MarketingContactPublic } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { usePanelContext } from '../panel-context.js';
import { ContactArchiveAction, ContactMemberLink } from './ContactsPanel.js';
import { DirectoryActions, DirectoryError, DirectoryField, DirectoryListSelect, DirectorySelect, directoryTokens, suppressionLabel, directoryEventLabel } from './DirectoryFields.js';

const ContactForm = ({ contact }: { contact: MarketingContactPublic }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const cache = useQueryClient();
  const [displayName, setDisplayName] = useState(contact.displayName ?? '');
  const [firstName, setFirstName] = useState(contact.firstName ?? '');
  const [lastName, setLastName] = useState(contact.lastName ?? '');
  const [source, setSource] = useState(contact.source);
  const [tags, setTags] = useState(contact.tags.join('|'));
  const update = useMutation({ ...actions.directory.updateMarketingContact, onSuccess: async () => cache.invalidateQueries(actions.directory.invalidates(tenant.id)) });
  return <SectionCard title={contact.email} onSubmit={(event) => { event.preventDefault(); update.mutate({ contactId: contact.id, displayName, firstName, lastName, source, tags: directoryTokens(tags) }); }} actions={<><ContactArchiveAction contact={contact} /><Button type="submit" variant="contained" disabled={update.isPending}>{t.directory.save}</Button></>}>
    <ContactMemberLink memberId={contact.memberId} /><DirectoryField label={t.directory.name} value={displayName} onChange={setDisplayName} maxLength={200} />
    <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem"><DirectoryField label={t.directory.firstName} value={firstName} onChange={setFirstName} maxLength={200} /><DirectoryField label={t.directory.lastName} value={lastName} onChange={setLastName} maxLength={200} /></Stack>
    <DirectoryField label={t.directory.source} value={source} onChange={setSource} required maxLength={120} /><DirectoryField label={t.directory.tags} value={tags} onChange={setTags} /><DirectoryError error={update.error} />
  </SectionCard>;
};

const ContactMemberships = ({ contact }: { contact: MarketingContactPublic }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const cache = useQueryClient();
  const [listId, setListId] = useState('');
  const [consentDefinitionId, setConsentDefinitionId] = useState('');
  const definitions = useQuery(actions.marketingConsents);
  const state = useQuery(actions.directory.contacts(tenant.id, { id: contact.id, archived: contact.archivedAt !== null, limit: 1, ...(consentDefinitionId ? { consentDefinitionId } : {}) }));
  const view = state.data?.contacts.find((item) => item.id === contact.id);
  const onSuccess = async () => cache.invalidateQueries(actions.directory.invalidates(tenant.id));
  const add = useMutation({ ...actions.directory.addMarketingListContacts, onSuccess });
  const remove = useMutation({ ...actions.directory.removeMarketingListContacts, onSuccess });
  return <SectionCard title={t.directory.memberships}>
    <Typography>{view?.listKeys.join(', ') || '—'}</Typography><DirectoryListSelect value={listId} onChange={setListId} staticOnly />
    <DirectoryActions><Button disabled={!listId || add.isPending} onClick={() => add.mutate({ listId, contactIds: [contact.id] })}>{t.directory.add}</Button><Button disabled={!listId || remove.isPending} onClick={() => remove.mutate({ listId, contactIds: [contact.id] })}>{t.directory.remove}</Button>{listId ? <Link to="/panel/marketing/lists/$listId" params={{ listId }}>{t.directory.list}</Link> : null}</DirectoryActions>
    <DirectorySelect label={t.directory.consentDefinition} value={consentDefinitionId} onChange={setConsentDefinitionId} options={[{ value: '', label: t.directory.selectConsent }, ...(definitions.data?.definitions.map((item) => ({ value: item.id, label: item.key })) ?? [])]} />
    <Typography>{t.directory.consentState}: {view?.consentState ? (view.consentState === 'active' ? t.directory.activeConsent : t.directory[view.consentState]) : t.directory.selectConsent}</Typography><Typography>{t.directory.suppression}: {view ? (view.suppressionReason ? suppressionLabel(view.suppressionReason, t) : t.directory.notSuppressed) : '—'}</Typography><Alert severity="info">{t.directory.evidenceHint}</Alert><DirectoryError error={state.error ?? definitions.error ?? add.error ?? remove.error} />
  </SectionCard>;
};

export const ContactDetailPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { tenant } = usePanelContext();
  const { contactId } = useParams({ strict: false });
  const detail = useQuery(actions.directory.contact(tenant.id, { contactId: contactId ?? '' }));
  return <PanelPage title={detail.data?.contact.displayName ?? t.directory.contactsTitle} backTo={<PanelBackLink to="/panel/marketing/contacts">{t.directory.contactsTitle}</PanelBackLink>}>
    <DirectoryError error={detail.error} />{detail.isPending ? <StatusView state={{ kind: 'loading', label: t.directory.loading }} /> : null}
    {detail.data ? <><ContactForm key={detail.data.contact.id} contact={detail.data.contact} /><ContactMemberships contact={detail.data.contact} /><ContactSendsSection key={detail.data.contact.id} contactId={detail.data.contact.id} email={detail.data.contact.email} /><SectionCard title={t.directory.history}>{detail.data.events.length === 0 ? <Typography>{t.directory.noHistory}</Typography> : detail.data.events.map((event) => <Typography key={event.id}>{directoryEventLabel(event.type, t)} · {formatDateTime(event.occurredAt, language)}{event.importId ? <> · <Link to="/panel/marketing/contacts/import" search={{ importId: event.importId }}>{t.directory.batchId}: {event.importId}</Link></> : null}</Typography>)}</SectionCard></> : null}
  </PanelPage>;
};
