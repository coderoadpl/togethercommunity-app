import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { partnerProgramSchema, partnerCodeSchema } from '#core/domain/partner-program.js';
import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { sampleSalesLink } from '../../../test/sales-link-fixtures.js';
import { PartnerProgramEditor } from './PartnerProgramEditor.js';
import { PartnerCodeEditor } from './PartnerCodeEditor.js';

const program = partnerProgramSchema.parse({ id: 'program-1', tenantId: 'tenant-1', name: 'Ambassadors', commissionPct: 50, createdAt: '2026-10-13T12:00:00.000Z', revision: 1 });
const partner = { id: 'partner-1', email: 'alex@example.org', status: 'active' as const };
const code = partnerCodeSchema.parse({ id: 'code-1', tenantId: 'tenant-1', programId: program.id, partnerId: partner.id, code: 'ALEX10', discountPct: 10, salesLinkIds: ['link-1'], stripeCouponId: null, stripePromotionCodeId: null, createdAt: program.createdAt, revision: 1 });

it('saves the program with integer terms and default grace', async () => {
  const onSave = vi.fn();
  renderWithProviders(<PartnerProgramEditor program={null} onSave={onSave} />);
  await userEvent.type(screen.getByRole('textbox', { name: en.partnerPrograms.name }), 'Ambassadors');
  await userEvent.click(screen.getByRole('button', { name: en.partnerPrograms.save }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ambassadors', commissionPct: 50, graceDays: 14 }));
});

it('rejects fractional program commission', async () => {
  renderWithProviders(<PartnerProgramEditor program={program} onSave={vi.fn()} />);
  const commission = screen.getByRole('spinbutton', { name: en.partnerPrograms.commission });
  await userEvent.clear(commission);
  await userEvent.type(commission, '50.5');
  expect(screen.getByRole('button', { name: en.partnerPrograms.save })).toBeDisabled();
});

it('caps the discount at program commission and warns at zero partner earnings', async () => {
  const onSave = vi.fn();
  renderWithProviders(<PartnerCodeEditor program={program} code={code} partners={[partner]} salesLinks={[{ ...sampleSalesLink, allowsCodes: true }]} onSave={onSave} onCancel={vi.fn()} />);
  const discount = screen.getByRole('spinbutton', { name: en.partnerPrograms.discount });
  await userEvent.clear(discount);
  await userEvent.type(discount, '51');
  expect(screen.getByRole('button', { name: en.partnerPrograms.saveCode })).toBeDisabled();
  await userEvent.clear(discount);
  await userEvent.type(discount, '50');
  expect(screen.getByRole('alert')).toHaveTextContent(en.partnerPrograms.zeroCommission);
  await userEvent.click(screen.getByRole('button', { name: en.partnerPrograms.saveCode }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ discountPct: 50, salesLinkIds: ['link-1'] }));
});

it('uppercases codes and requires an eligible offer', async () => {
  renderWithProviders(<PartnerCodeEditor program={program} code={code} partners={[partner]} salesLinks={[{ ...sampleSalesLink, allowsCodes: true }, { ...sampleSalesLink, id: 'disabled', title: 'No codes offer', allowsCodes: false }]} onSave={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByRole('checkbox', { name: 'No codes offer' })).not.toBeInTheDocument();
  const input = screen.getByRole('textbox', { name: en.partnerPrograms.code });
  await userEvent.clear(input);
  await userEvent.type(input, 'alex-new');
  expect(input).toHaveValue('ALEX-NEW');
  await userEvent.click(screen.getByRole('checkbox', { name: sampleSalesLink.title }));
  expect(screen.getByRole('button', { name: en.partnerPrograms.saveCode })).toBeDisabled();
});

it('lets an archived code drop an offer whose codes were disabled', async () => {
  renderWithProviders(<PartnerCodeEditor program={program} code={{ ...code, status: 'archived' }} partners={[partner]} salesLinks={[{ ...sampleSalesLink, allowsCodes: false }]} onSave={vi.fn()} onCancel={vi.fn()} />);
  await userEvent.click(screen.getByRole('checkbox', { name: sampleSalesLink.title }));
  expect(screen.queryByRole('checkbox', { name: sampleSalesLink.title })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: en.partnerPrograms.saveCode })).toBeDisabled();
});
