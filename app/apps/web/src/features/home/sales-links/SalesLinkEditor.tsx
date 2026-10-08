import { useState } from 'react';
import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { SALES_LINK_TIME_ZONE, salesLinkInputSchema, type Product, type SalesLink } from '#core/domain/index.js';
import { SectionCard } from '../../../components/layout/index.js';
import { MarkdownEditor } from '../../../components/ui/MarkdownEditor.js';
import { useTranslations } from '../../../i18n/index.js';
import { formatValidityTime, parseValidityTime } from './validity-time.js';

type SalesLinkInput = Parameters<typeof salesLinkInputSchema.parse>[0];

export const SalesLinkEditor = ({ salesLink, products, onSave, onCancel, pending = false, error }: {
  salesLink: SalesLink | null;
  products: Product[];
  onSave: (input: ReturnType<typeof salesLinkInputSchema.parse>) => void;
  onCancel: () => void;
  pending?: boolean;
  error?: string | undefined;
}) => {
  const t = useTranslations();
  const [title, setTitle] = useState(salesLink?.title ?? '');
  const [heading, setHeading] = useState(salesLink?.heading ?? '');
  const [slug, setSlug] = useState(salesLink?.slug ?? '');
  const [description, setDescription] = useState(salesLink?.description ?? '');
  const [productIds, setProductIds] = useState(salesLink?.productIds ?? []);
  const [active, setActive] = useState(salesLink?.active ?? false);
  const [listed, setListed] = useState(salesLink?.listed ?? false);
  const [validFrom, setValidFrom] = useState(formatValidityTime(salesLink?.validFrom ?? null, SALES_LINK_TIME_ZONE));
  const [validTo, setValidTo] = useState(formatValidityTime(salesLink?.validTo ?? null, SALES_LINK_TIME_ZONE));
  const [invalid, setInvalid] = useState(false);
  const move = (index: number, step: number) => setProductIds((current) => {
    const result = [...current];
    const selected = result.splice(index, 1)[0];
    if (selected !== undefined) result.splice(index + step, 0, selected);
    return result;
  });
  const save = () => {
    const from = parseValidityTime(validFrom, SALES_LINK_TIME_ZONE);
    const to = parseValidityTime(validTo, SALES_LINK_TIME_ZONE);
    const input: SalesLinkInput = { title, heading, slug, description, productIds, active, listed, validFrom: from, validTo: to };
    const parsed = salesLinkInputSchema.safeParse(input);
    setInvalid(!parsed.success || from === undefined || to === undefined);
    if (parsed.success && from !== undefined && to !== undefined) onSave(parsed.data);
  };
  return <SectionCard title={salesLink === null ? t.salesLinks.create : t.salesLinks.edit} description={t.salesLinks.activationHelp} onSubmit={(event) => { event.preventDefault(); save(); }} data-testid="sales-link-editor">
    <TextField label={t.salesLinks.internalTitle} value={title} onChange={(event) => setTitle(event.target.value)} required />
    <TextField label={t.salesLinks.publicHeading} value={heading} onChange={(event) => setHeading(event.target.value)} required />
    <TextField label={t.salesLinks.slug} value={slug} onChange={(event) => setSlug(event.target.value)} required />
    <Typography component="h3">{t.salesLinks.description}</Typography>
    <MarkdownEditor aria-label={t.salesLinks.description} value={description} onChange={setDescription} minRows={3} maxLength={50000} />
    <Typography component="h3">{t.salesLinks.products}</Typography>
    {productIds.map((id, index) => <Stack key={id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
      <Typography sx={{ flex: 1 }}>{index + 1}. {products.find((product) => product.id === id)?.title ?? id}</Typography>
      <Stack direction="row" spacing={1}>
        <Button disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${t.salesLinks.moveUp}: ${index + 1}`}>↑</Button>
        <Button disabled={index === productIds.length - 1} onClick={() => move(index, 1)} aria-label={`${t.salesLinks.moveDown}: ${index + 1}`}>↓</Button>
        <Button color="error" onClick={() => setProductIds((current) => current.filter((value) => value !== id))}>{t.common.remove}</Button>
      </Stack>
    </Stack>)}
    <TextField select label={t.salesLinks.addProduct} value="" onChange={(event) => setProductIds((current) => [...current, event.target.value])}>
      {products.filter((product) => !productIds.includes(product.id) && product.type !== 'membership').map((product) => <MenuItem key={product.id} value={product.id}>{product.title}{product.published ? '' : ` · ${t.products.filterDraft}`}</MenuItem>)}
    </TextField>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField type="datetime-local" label={t.salesLinks.validFrom} value={validFrom} onChange={(event) => setValidFrom(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
      <TextField type="datetime-local" label={t.salesLinks.validTo} value={validTo} onChange={(event) => setValidTo(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
    </Stack>
    <Typography variant="caption">{t.salesLinks.timezone}: {SALES_LINK_TIME_ZONE}</Typography>
    <FormControlLabel control={<Switch checked={listed} onChange={(_, checked) => setListed(checked)} />} label={t.salesLinks.listed} />
    <FormControlLabel control={<Switch checked={active} onChange={(_, checked) => setActive(checked)} />} label={t.salesLinks.active} />
    {invalid ? <Alert severity="error">{t.salesLinks.invalid}</Alert> : null}
    {error === undefined ? null : <Alert severity="error">{error}</Alert>}
    <Stack direction="row" spacing={1}><Button type="submit" variant="contained" disabled={pending}>{t.salesLinks.save}</Button><Button onClick={onCancel} disabled={pending}>{t.common.cancel}</Button></Stack>
  </SectionCard>;
};
