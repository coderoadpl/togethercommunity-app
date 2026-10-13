import { useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField } from '@mui/material';
import { partnerProgramInputSchema, type PartnerProgram } from '#core/domain/partner-program.js';
import { SectionCard } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';

export const PartnerProgramEditor = ({ program, onSave, pending = false, error }: {
  program: PartnerProgram | null;
  onSave: (input: ReturnType<typeof partnerProgramInputSchema.parse>) => void;
  pending?: boolean;
  error?: string | undefined;
}) => {
  const t = useTranslations();
  const p = t.partnerPrograms;
  const [name, setName] = useState(program?.name ?? '');
  const [commission, setCommission] = useState(String(program?.commissionPct ?? 50));
  const [grace, setGrace] = useState(String(program?.graceDays ?? 14));
  const [notes, setNotes] = useState(program?.notes ?? '');
  const [status, setStatus] = useState(program?.status ?? 'active');
  const parsed = partnerProgramInputSchema.safeParse({ name, commissionPct: Number(commission), graceDays: Number(grace), notes, status });
  return <SectionCard title={program?.name ?? p.create} onSubmit={(event) => { event.preventDefault(); if (parsed.success) onSave(parsed.data); }} data-testid="partner-program-editor">
    <TextField label={p.name} value={name} onChange={(event) => setName(event.target.value)} required slotProps={{ htmlInput: { maxLength: 120 } }} />
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField fullWidth label={p.commission} type="number" value={commission} onChange={(event) => setCommission(event.target.value)} required slotProps={{ htmlInput: { min: 1, max: 100, step: 1 } }} />
      <TextField fullWidth label={p.grace} helperText={p.graceHelp} type="number" value={grace} onChange={(event) => setGrace(event.target.value)} required slotProps={{ htmlInput: { min: 0, max: 365, step: 1 } }} />
    </Stack>
    <TextField multiline minRows={3} label={p.notes} value={notes} onChange={(event) => setNotes(event.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />
    <TextField select label={p.status} helperText={p.statusHelp} value={status} onChange={(event) => setStatus(event.target.value === 'archived' ? 'archived' : 'active')}><MenuItem value="active">{p.active}</MenuItem><MenuItem value="archived">{p.archived}</MenuItem></TextField>
    {error === undefined ? null : <Alert severity="error">{error}</Alert>}
    <Button type="submit" variant="contained" disabled={pending || !parsed.success}>{p.save}</Button>
  </SectionCard>;
};
