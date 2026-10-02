import { useEffect, useId, type ReactNode } from 'react';
import { Alert, Button, Checkbox, FormControl, FormControlLabel, FormHelperText, FormLabel, MenuItem, Select, Stack, Tooltip, Typography, type MenuItemProps } from '@mui/material';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';

import type { ContactCampaignAudience } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { useTranslations } from '../../../i18n/index.js';
import { usePanelContext } from '../panel-context.js';
import { DirectoryError } from './DirectoryFields.js';

// A disabled MenuItem drops pointer and keyboard events, hiding the reason from both modalities; aria-disabled keeps it reachable and onChange enforces the conflict.
const AudienceOption = ({ name, reason, ...item }: MenuItemProps & { name: string; reason: string | null }) => reason === null
  ? <MenuItem {...item}>{name}</MenuItem>
  : <Tooltip describeChild title={reason}><MenuItem {...item} aria-disabled sx={{ opacity: (theme) => theme.palette.action.disabledOpacity }}>{name}</MenuItem></Tooltip>;

const AudienceSelect = ({ label, values, options, disabled, helperText, conflictLabel, onChange }: { label: string; values: string[]; options: { id: string; name: string }[]; disabled: boolean; helperText?: string | undefined; conflictLabel?: (id: string) => string | null; onChange: (ids: string[]) => void }) => {
  const id = useId();
  const helperId = helperText === undefined ? undefined : `${id}-helper`;
  const conflictOf = (optionId: string) => values.includes(optionId) ? null : conflictLabel?.(optionId) ?? null;
  const commit = (selection: string[] | string) => {
    const next = typeof selection === 'string' ? selection.split(',') : selection;
    if (next.every((value) => conflictOf(value) === null)) onChange(next);
  };
  return <FormControl fullWidth error={helperText !== undefined}><FormLabel id={id}>{label}</FormLabel><Select multiple labelId={id} value={values} disabled={disabled} aria-describedby={helperId} onChange={(event) => commit(event.target.value)} renderValue={(ids) => ids.map((value) => options.find((option) => option.id === value)?.name ?? value).join(', ')}>{options.map((option) => <AudienceOption key={option.id} value={option.id} name={option.name} reason={conflictOf(option.id)} />)}</Select>{helperText === undefined ? null : <FormHelperText id={helperId}>{helperText}</FormHelperText>}</FormControl>;
};

export const CampaignAudienceSection = ({ audience, consentDefinitionId, frozen, disabled, progress, overlapError, onChange }: { audience: ContactCampaignAudience; consentDefinitionId: string; frozen: boolean; disabled: boolean; progress?: ReactNode | undefined; overlapError?: string | undefined; onChange: (audience: ContactCampaignAudience) => void }) => {
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
    {progress}
    {frozen ? <Alert severity="info">{t.marketing.frozenAudience}</Alert> : <Typography>{t.marketing.audienceEstimateHint}</Typography>}
    <AudienceSelect label={t.marketing.includeLists} values={audience.includeLists} options={options} disabled={disabled || lists.isPending} helperText={overlapError} conflictLabel={(id) => audience.excludeLists.includes(id) ? t.marketing.listAlreadyExcluded : null} onChange={(includeLists) => onChange({ ...audience, includeLists })} />
    <AudienceSelect label={t.marketing.excludeLists} values={audience.excludeLists} options={options} disabled={disabled || lists.isPending} helperText={overlapError} conflictLabel={(id) => audience.includeLists.includes(id) ? t.marketing.listAlreadyIncluded : null} onChange={(excludeLists) => onChange({ ...audience, excludeLists })} />
    {lists.hasNextPage ? <Button disabled={lists.isFetchingNextPage} onClick={() => void lists.fetchNextPage()}>{t.directory.loadMore}</Button> : null}
    <FormControlLabel label={t.marketing.includeConsentedMembers} control={<Checkbox checked={audience.includeMembersWithConsent} disabled={disabled} onChange={(_event, includeMembersWithConsent) => onChange({ ...audience, includeMembersWithConsent })} />} />
    <AudienceSelect label={t.marketing.excludeProductGrants} values={audience.excludeProductIds} options={products.data?.products.map((product) => ({ id: product.id, name: product.title })) ?? []} disabled={disabled || products.isPending} onChange={(excludeProductIds) => onChange({ ...audience, excludeProductIds })} />
    <Typography variant="body2">{t.marketing.excludeProductGrantsHint}</Typography>
    {!frozen ? <Button disabled={!consentDefinitionId || preview.isPending} onClick={() => estimate({ audience, consentDefinitionId })}>{t.marketing.previewContacts}</Button> : null}
    {!frozen && data && !preview.isPending ? <Stack useFlexGap spacing="0.5rem"><Typography role="status">{t.marketing.audienceCount({ count: data.count })}</Typography><Typography>{t.marketing.audienceBreakdown({ candidates: data.candidateCount, excluded: data.excludedCount, suppressed: data.skipped.suppressed, withdrawn: data.skipped.withdrawn, pending: data.skipped.pendingConfirmation, noConsent: data.skipped.noConsent })}</Typography>{data.sample.map((contact) => <Typography key={contact.contactId}>{contact.displayName ? `${contact.displayName} · ` : ''}{contact.email}</Typography>)}</Stack> : null}
    <DirectoryError error={lists.error ?? products.error ?? preview.error} />
  </Stack>;
};
