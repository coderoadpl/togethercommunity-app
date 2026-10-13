import { useState } from 'react';
import { Alert, Button, Chip, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { PartnerCode } from '#core/domain/partner-program.js';
import { actions } from '../../../api.js';
import { PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { SearchField } from '../../../components/ui/SearchField.js';
import { localizePanelError, serverMessageOf, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatPrice } from '../../../lib/format.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { usePanelContext } from '../panel-context.js';
import { PartnerProgramEditor } from './PartnerProgramEditor.js';
import { PartnerCodeEditor } from './PartnerCodeEditor.js';

const partnerCodeError = (error: unknown, t: Messages): string => {
  const message = serverMessageOf(error);
  if (message === 'A coupon with this code already exists') return t.partnerPrograms.couponTaken;
  if (message === 'A partner code with this code already exists') return t.partnerPrograms.partnerTaken;
  return message ?? localizePanelError(error, t);
};

const commissionTotalFields = ['pendingCents', 'payableCents', 'paidCents'] as const;

export const PartnerProgramsPanel = () => {
  const t = useTranslations();
  const p = t.partnerPrograms;
  const { language } = useLanguage();
  const { tenant } = usePanelContext();
  const list = useQuery(actions.partnerPrograms.list(tenant.id));
  const [status, setStatus] = useState('all');
  return <PanelPage title={p.title} description={p.description} data-testid="partner-programs-page" action={<Button component={Link} to="/panel/sales/partner-programs/new" variant="contained">{p.create}</Button>}>
    <SectionCard title={p.title}>
      <TextField select label={p.status} value={status} onChange={(event) => setStatus(event.target.value)}><MenuItem value="all">{t.products.filterAll}</MenuItem><MenuItem value="active">{p.active}</MenuItem><MenuItem value="archived">{p.archived}</MenuItem></TextField>
      {list.isPending ? <StatusView state={{ kind: 'loading', label: t.common.loading }} /> : list.isError ? <StatusView state={{ kind: 'error', message: localizePanelError(list.error, t), retry: { label: t.common.retry, onRetry: () => void list.refetch() } }} /> : <ResponsiveTable><Table><TableHead><TableRow>{[p.program, p.commission, p.grace, p.partners, p.codes, p.pending, p.payable, p.paid, p.status].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{list.data.programs.filter(({ program }) => status === 'all' || program.status === status).map((item) => <TableRow key={item.program.id}>
        <TableCell><Button component={Link} to={`/panel/sales/partner-programs/${encodeURIComponent(item.program.id)}`}>{item.program.name}</Button></TableCell><TableCell>{item.program.commissionPct} %</TableCell><TableCell>{item.program.graceDays}</TableCell><TableCell>{item.partnerCount}</TableCell><TableCell>{item.codeCount}</TableCell>{commissionTotalFields.map((field) => <TableCell key={field}>{item.currencyTotals.length === 0 ? '—' : <Stack>{item.currencyTotals.map((total) => <Typography key={total.currency}>{formatPrice(total[field], total.currency, language)}</Typography>)}</Stack>}</TableCell>)}<TableCell><Chip size="small" color={item.program.status === 'active' ? 'success' : 'default'} label={p[item.program.status]} /></TableCell>
      </TableRow>)}</TableBody></Table></ResponsiveTable>}
    </SectionCard>
  </PanelPage>;
};

export const PartnerProgramCreatePage = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({ ...actions.partnerPrograms.create, onSuccess: async ({ program }) => { await queryClient.invalidateQueries(actions.partnerPrograms.invalidates()); await navigate({ to: '/panel/sales/partner-programs/$programId', params: { programId: program.id } }); } });
  return <PanelPage title={t.partnerPrograms.create} backTo={<PanelBackLink to="/panel/sales/partner-programs">{t.partnerPrograms.title}</PanelBackLink>}><PartnerProgramEditor program={null} onSave={(input) => create.mutate(input)} pending={create.isPending} error={create.isError ? localizePanelError(create.error, t) : undefined} /></PanelPage>;
};

export const PartnerProgramDetailPage = ({ programId }: { programId: string }) => {
  const t = useTranslations();
  const p = t.partnerPrograms;
  const { tenant } = usePanelContext();
  const queryClient = useQueryClient();
  const detail = useQuery(actions.partnerPrograms.detail(programId));
  const members = useQuery(actions.members);
  const salesLinks = useQuery(actions.salesLinks.list(tenant.id));
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PartnerCode | null | undefined>();
  const refresh = () => queryClient.invalidateQueries(actions.partnerPrograms.invalidates());
  const update = useMutation({ ...actions.partnerPrograms.update, onSuccess: refresh });
  const assign = useMutation({ ...actions.partnerPrograms.assign, onSuccess: async () => { setSearch(''); await refresh(); } });
  const updatePartner = useMutation({ ...actions.partnerPrograms.updatePartner, onSuccess: refresh });
  const savedCode = async () => { setEditing(undefined); await refresh(); };
  const createCode = useMutation({ ...actions.partnerPrograms.createCode, onSuccess: savedCode });
  const updateCode = useMutation({ ...actions.partnerPrograms.updateCode, onSuccess: savedCode });
  if (detail.isPending) return <PanelPage title={p.title} state={{ kind: 'loading', label: t.common.loading }} />;
  if (detail.isError) return <PanelPage title={p.title} state={{ kind: 'error', message: localizePanelError(detail.error, t), retry: { label: t.common.retry, onRetry: () => void detail.refetch() } }} />;
  const { program, partners, codes } = detail.data;
  const codeError = createCode.error ?? updateCode.error;
  const memberError = assign.error ?? updatePartner.error ?? members.error;
  return <PanelPage title={program.name} data-testid="partner-program-detail-page" backTo={<PanelBackLink to="/panel/sales/partner-programs">{p.title}</PanelBackLink>}>
    <PartnerProgramEditor key={program.revision} program={program} onSave={(input) => update.mutate({ ...input, id: program.id, expectedRevision: program.revision })} pending={update.isPending} error={update.isError ? localizePanelError(update.error, t) : undefined} />
    <SectionCard title={p.partners}>
      <SearchField value={search} onChange={setSearch} label={p.memberSearch} placeholder={p.memberSearch} testId="partner-member-search" />
      <Typography variant="caption">{p.memberHelp}</Typography>
      {search.trim() === '' ? null : (members.data?.members ?? []).filter((member) => member.email.toLowerCase().includes(search.toLowerCase()) && !partners.some((partner) => partner.memberId === member.id)).slice(0, 10).map((member) => <Stack key={member.id} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}><Typography>{member.email}</Typography><Button disabled={assign.isPending} onClick={() => assign.mutate({ programId, email: member.email })}>{p.add}</Button></Stack>)}
      {memberError === null ? null : <Alert severity="error">{localizePanelError(memberError, t)}</Alert>}
      {partners.map((partner) => <Stack key={partner.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}><Typography>{partner.email}</Typography><Chip size="small" label={p[partner.status]} /><Button disabled={updatePartner.isPending} onClick={() => updatePartner.mutate({ id: partner.id, status: partner.status === 'active' ? 'archived' : 'active' })}>{partner.status === 'active' ? p.archive : p.active}</Button></Stack>)}
    </SectionCard>
    <SectionCard title={p.codes}>
      {codes.map((code) => <Stack key={code.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}><Typography>{code.code} · {partners.find((partner) => partner.id === code.partnerId)?.email}</Typography><Typography>{p.discount}: {code.discountPct} % · {p.partnerCommission}: {program.commissionPct - code.discountPct} %</Typography><Chip size="small" label={p[code.status]} /><Button onClick={() => setEditing(code)}>{p.edit}</Button></Stack>)}
      <Button onClick={() => setEditing(null)}>{p.newCode}</Button>
    </SectionCard>
    {salesLinks.isError ? <Alert severity="error">{localizePanelError(salesLinks.error, t)}</Alert> : null}
    {editing === undefined ? null : <PartnerCodeEditor key={editing?.id ?? 'new'} program={program} code={editing} partners={partners} salesLinks={salesLinks.data?.salesLinks ?? []} pending={createCode.isPending || updateCode.isPending} error={codeError === null ? undefined : partnerCodeError(codeError, t)} onCancel={() => setEditing(undefined)} onSave={(input) => editing === null ? createCode.mutate(input) : updateCode.mutate({ ...input, id: editing.id, expectedRevision: editing.revision })} />}
  </PanelPage>;
};
