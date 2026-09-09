import { useEffect, useId } from 'react';
import { Alert, Button, Checkbox, FormControl, FormControlLabel, FormLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';

import type { ContactCampaignAudience } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { useTranslations } from '../../../i18n/index.js';
import { usePanelContext } from '../panel-context.js';
import { DirectoryError } from './DirectoryFields.js';

const AudienceSelect = ({ label, values, options, disabled, onChange }: { label: string; values: string[]; options: { id: string; name: string }[]; disabled: boolean; onChange: (ids: string[]) => void }) => {
  const id = useId();
  return <FormControl fullWidth><FormLabel id={id}>{label}</FormLabel><Select multiple labelId={id} value={values} disabled={disabled} onChange={(event) => onChange(typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value)} renderValue={(ids) => ids.map((value) => options.find((option) => option.id === value)?.name ?? value).join(', ')}>{options.map((option) => <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>)}</Select></FormControl>;
};

export const CampaignAudienceSection = ({ audience, consentDefinitionId, frozen, disabled, onChange }: { audience: ContactCampaignAudience; consentDefinitionId: string; frozen: boolean; disabled: boolean; onChange: (audience: ContactCampaignAudience) => void }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const lists = useInfiniteQuery(actions.directory.listOptions(tenant.id));
  const products = useQuery(actions.products);
  const preview = useMutation(actions.previewMarketingAudience);
  const estimate = preview.mutate;
  useEffect(() => { if (!frozen && consentDefinitionId) estimate({ audience, consentDefinitionId }); }, [audience, consentDefinitionId, estimate, frozen]);
  const options = lists.data?.pages.flatMap((page) => page.lists).map((list) => ({ id: list.id, name: `${list.name} (${list.key})` })) ?? [];
  const data = preview.data && 'sample' in preview.data ? preview.data : null;
  return <Stack useFlexGap spacing="1rem">
    <Typography variant="h6" component="h3">{t.marketing.contactAudience}</Typography>
    {frozen ? <Alert severity="info">{t.marketing.frozenAudience}</Alert> : <Typography>{t.marketing.audienceEstimateHint}</Typography>}
    <AudienceSelect label={t.marketing.includeLists} values={audience.includeLists} options={options} disabled={disabled || lists.isPending} onChange={(includeLists) => onChange({ ...audience, includeLists })} />
    <AudienceSelect label={t.marketing.excludeLists} values={audience.excludeLists} options={options} disabled={disabled || lists.isPending} onChange={(excludeLists) => onChange({ ...audience, excludeLists })} />
    {lists.hasNextPage ? <Button disabled={lists.isFetchingNextPage} onClick={() => void lists.fetchNextPage()}>{t.directory.loadMore}</Button> : null}
    <FormControlLabel label={t.marketing.includeConsentedMembers} control={<Checkbox checked={audience.includeMembersWithConsent} disabled={disabled} onChange={(_event, includeMembersWithConsent) => onChange({ ...audience, includeMembersWithConsent })} />} />
    <AudienceSelect label={t.marketing.excludeProductGrants} values={audience.excludeProductIds} options={products.data?.products.map((product) => ({ id: product.id, name: product.title })) ?? []} disabled={disabled || products.isPending} onChange={(excludeProductIds) => onChange({ ...audience, excludeProductIds })} />
    <Typography variant="body2">{t.marketing.excludeProductGrantsHint}</Typography>
    {!frozen ? <Button disabled={!consentDefinitionId || preview.isPending} onClick={() => estimate({ audience, consentDefinitionId })}>{t.marketing.previewContacts}</Button> : null}
    {!frozen && data && !preview.isPending ? <Stack useFlexGap spacing="0.5rem"><Typography role="status">{t.marketing.audienceCount({ count: data.count })}</Typography><Typography>{t.marketing.audienceBreakdown({ candidates: data.candidateCount, excluded: data.excludedCount, suppressed: data.skipped.suppressed, withdrawn: data.skipped.withdrawn, pending: data.skipped.pendingConfirmation, noConsent: data.skipped.noConsent })}</Typography>{data.sample.map((contact) => <Typography key={contact.contactId}>{contact.displayName ? `${contact.displayName} · ` : ''}{contact.email}</Typography>)}</Stack> : null}
    <DirectoryError error={lists.error ?? products.error ?? preview.error} />
  </Stack>;
};
