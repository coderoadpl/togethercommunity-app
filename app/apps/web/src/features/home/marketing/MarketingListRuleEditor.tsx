import { useId, useState } from 'react';
import { Alert, FormControl, FormLabel, MenuItem, Select, Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import type { MarketingListRule } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { useTranslations } from '../../../i18n/index.js';
import { DirectoryError, DirectoryField, DirectorySelect, directoryTokens } from './DirectoryFields.js';

export const MarketingListRuleEditor = ({ rule, onChange }: { rule: MarketingListRule; onChange: (rule: MarketingListRule) => void }) => {
  const t = useTranslations();
  const productsLabelId = useId();
  const [tagsText, setTagsText] = useState(rule.kind === 'tag' ? rule.tags.join('|') : '');
  const products = useQuery({ ...actions.products, enabled: rule.kind === 'product_grant' });
  const consents = useQuery({ ...actions.marketingConsents, enabled: rule.kind === 'consent_definition' });
  return <Stack useFlexGap spacing="1rem">
    <DirectorySelect label={t.directory.rule} value={rule.kind} onChange={(kind) => { setTagsText(''); onChange(kind === 'tag' ? { kind, tags: [], match: 'any' } : kind === 'product_grant' ? { kind, productIds: [], state: 'active' } : { kind, definitionId: '', state: 'active' }); }} options={[{ value: 'tag', label: t.directory.tagRule }, { value: 'product_grant', label: t.directory.productRule }, { value: 'consent_definition', label: t.directory.consentRule }]} />
    {rule.kind === 'tag' ? <><DirectoryField label={t.directory.tags} value={tagsText} onChange={(value) => { setTagsText(value); onChange({ ...rule, tags: directoryTokens(value) }); }} /><DirectorySelect label={t.directory.match} value={rule.match} onChange={(match) => onChange({ ...rule, match })} options={[{ value: 'any', label: t.directory.any }, { value: 'all', label: t.directory.allTags }]} /></> : rule.kind === 'product_grant' ? <>
      <FormControl fullWidth><FormLabel id={productsLabelId}>{t.directory.products}</FormLabel><Select multiple labelId={productsLabelId} value={rule.productIds} onChange={(event) => { const value = event.target.value; onChange({ ...rule, productIds: typeof value === 'string' ? value.split(',') : value }); }}>{products.data?.products.map((product) => <MenuItem key={product.id} value={product.id}>{product.title}</MenuItem>)}</Select></FormControl>
      <DirectorySelect label={t.directory.grantState} value={rule.state} onChange={(state) => onChange({ ...rule, state })} options={[{ value: 'active', label: t.directory.activeGrant }, { value: 'ever', label: t.directory.ever }]} /><Alert severity="info">{t.directory.grantHint}</Alert><DirectoryError error={products.error} />
    </> : <><DirectorySelect label={t.directory.consentDefinition} value={rule.definitionId} onChange={(definitionId) => onChange({ ...rule, definitionId })} options={[{ value: '', label: t.directory.selectConsent }, ...(consents.data?.definitions.filter((item) => item.status === 'active').map((item) => ({ value: item.id, label: item.key })) ?? [])]} /><DirectoryError error={consents.error} /></>}
  </Stack>;
};
