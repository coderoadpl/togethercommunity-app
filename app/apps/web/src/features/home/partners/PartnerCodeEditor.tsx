import { useState } from 'react';
import { Alert, Button, Checkbox, FormControl, FormControlLabel, FormLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { partnerCodeInputSchema, type PartnerCode, type PartnerProgram } from '#core/domain/partner-program.js';
import type { SalesLink } from '#core/domain/index.js';
import { SectionCard } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';

export const PartnerCodeEditor = ({ program, code, partners, salesLinks, onSave, onCancel, pending = false, error }: {
  program: PartnerProgram;
  code: PartnerCode | null;
  partners: Array<{ id: string; email: string; status: 'active' | 'archived' }>;
  salesLinks: SalesLink[];
  onSave: (input: ReturnType<typeof partnerCodeInputSchema.parse>) => void;
  onCancel: () => void;
  pending?: boolean;
  error?: string | undefined;
}) => {
  const t = useTranslations();
  const p = t.partnerPrograms;
  const [partnerId, setPartnerId] = useState(code?.partnerId ?? '');
  const [value, setValue] = useState(code?.code ?? '');
  const [discount, setDiscount] = useState(String(code?.discountPct ?? 0));
  const [salesLinkIds, setSalesLinkIds] = useState(code?.salesLinkIds ?? []);
  const [validFrom, setValidFrom] = useState(code?.validFrom?.slice(0, 16) ?? '');
  const [validTo, setValidTo] = useState(code?.validTo?.slice(0, 16) ?? '');
  const [maxRedemptions, setMaxRedemptions] = useState(code?.maxRedemptions === null || code?.maxRedemptions === undefined ? '' : String(code.maxRedemptions));
  const [status, setStatus] = useState(code?.status ?? 'active');
  const parsed = partnerCodeInputSchema.safeParse({ programId: program.id, partnerId, code: value, discountPct: Number(discount), salesLinkIds, validFrom: validFrom === '' ? null : `${validFrom}:00.000Z`, validTo: validTo === '' ? null : `${validTo}:00.000Z`, maxRedemptions: maxRedemptions === '' ? null : Number(maxRedemptions), status });
  const invalidDiscount = discount === '' || !Number.isInteger(Number(discount)) || Number(discount) < 0 || Number(discount) > program.commissionPct;
  const invalidRange = validFrom !== '' && validTo !== '' && validFrom >= validTo;
  return <SectionCard title={code?.code ?? p.newCode} onSubmit={(event) => { event.preventDefault(); if (parsed.success && !invalidDiscount && !invalidRange) onSave(parsed.data); }} data-testid="partner-code-editor">
    <TextField select disabled={code !== null} label={p.partner} value={partnerId} onChange={(event) => setPartnerId(event.target.value)} required>{partners.filter((partner) => partner.status === 'active' || partner.id === partnerId).map((partner) => <MenuItem key={partner.id} value={partner.id}>{partner.email}</MenuItem>)}</TextField>
    <TextField label={p.code} helperText={p.codeHelp} value={value} onChange={(event) => setValue(event.target.value.toUpperCase())} required slotProps={{ htmlInput: { maxLength: 40, pattern: '[A-Z0-9-]{2,40}' } }} />
    <TextField label={p.discount} helperText={`${p.discountRule} (${program.commissionPct} %).`} error={invalidDiscount} type="number" value={discount} onChange={(event) => setDiscount(event.target.value)} required slotProps={{ htmlInput: { min: 0, max: program.commissionPct, step: 1 } }} />
    {!invalidDiscount && Number(discount) === program.commissionPct ? <Alert severity="warning">{p.zeroCommission}</Alert> : <Typography>{p.partnerCommission}: {Math.max(0, program.commissionPct - Number(discount))} %</Typography>}
    <FormControl component="fieldset"><FormLabel component="legend">{p.scope}</FormLabel>{salesLinks.filter((link) => link.allowsCodes || salesLinkIds.includes(link.id)).map((link) => <FormControlLabel key={link.id} label={link.title} control={<Checkbox checked={salesLinkIds.includes(link.id)} onChange={(_, checked) => setSalesLinkIds((current) => checked ? [...current, link.id] : current.filter((id) => id !== link.id))} />} />)}</FormControl>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField fullWidth type="datetime-local" label={`${p.validFrom} (UTC)`} value={validFrom} onChange={(event) => setValidFrom(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      <TextField fullWidth type="datetime-local" label={`${p.validTo} (UTC)`} value={validTo} onChange={(event) => setValidTo(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
    </Stack>
    {invalidRange ? <Alert severity="error">{t.coupons.invalidDateRange}</Alert> : null}
    <TextField label={p.maxRedemptions} helperText={p.unlimited} type="number" value={maxRedemptions} onChange={(event) => setMaxRedemptions(event.target.value)} slotProps={{ htmlInput: { min: 1, step: 1 } }} />
    <TextField select label={p.status} value={status} onChange={(event) => setStatus(event.target.value === 'archived' ? 'archived' : 'active')}><MenuItem value="active">{p.active}</MenuItem><MenuItem value="archived">{p.archived}</MenuItem></TextField>
    {error === undefined ? null : <Alert severity="error">{error}</Alert>}
    <Stack direction="row" spacing={1}><Button type="submit" variant="contained" disabled={pending || !parsed.success || invalidDiscount || invalidRange}>{p.saveCode}</Button><Button onClick={onCancel}>{t.common.cancel}</Button></Stack>
  </SectionCard>;
};
