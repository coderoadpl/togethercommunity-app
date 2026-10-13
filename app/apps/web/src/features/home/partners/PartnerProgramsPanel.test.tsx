import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { partnerCodeSchema, partnerProgramSchema } from '#core/domain/partner-program.js';
import { LanguageProvider } from '../../../i18n/index.js';
import { en } from '../../../i18n/en.js';
import { pl } from '../../../i18n/pl.js';
import { languagePreference } from '../../../theme-mode.js';
import { sampleSalesLink } from '../../../test/sales-link-fixtures.js';
import { formatPrice } from '../../../lib/format.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelContextProvider } from '../panel-context.js';
import { PartnerProgramDetailPage, PartnerProgramsPanel } from './PartnerProgramsPanel.js';

it('renders each commission currency without combining or relabelling it', async () => {
  const program = partnerProgramSchema.parse({ id: 'program', tenantId: 'tenant', name: 'Ambassadors', commissionPct: 50, createdAt: '2026-10-13T12:00:00.000Z', revision: 1 });
  server.use(http.get('/api/partner-programs', () => HttpResponse.json({ ok: true, data: { programs: [{ program, partnerCount: 1, codeCount: 2, currencyTotals: [
    { currency: 'EUR', pendingCents: 100, payableCents: 200, paidCents: 300 },
    { currency: 'USD', pendingCents: 400, payableCents: 500, paidCents: 600 },
  ] }] } })));
  const root = createRootRoute({ component: () => <PanelContextProvider value={{ tenant: { id: 'tenant', slug: 'acme', name: 'Workspace', staffRole: 'owner', memberId: null }, email: 'owner@example.org', emailVerified: true }}><PartnerProgramsPanel /></PanelContextProvider> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/panel/sales/partner-programs'] }) });
  renderWithProviders(<RouterProvider router={router} />);
  const row = await screen.findByRole('row', { name: /Ambassadors/u });
  for (const [index, currency] of ['EUR', 'USD'].entries()) {
    for (const amount of [100, 200, 300]) {
      expect(within(row).getByText(formatPrice(amount + index * 300, currency, 'en'))).toBeInTheDocument();
    }
  }
  expect(row).not.toHaveTextContent('PLN');
});

describe.each([{ language: 'en', t: en }, { language: 'pl', t: pl }] as const)('partner code errors in $language', ({ language, t }) => {
  it.each([
    { reason: 'discount_exceeds_commission', message: 'Code discount cannot exceed the program commission', expected: t.partnerPrograms.discountRule },
    { reason: 'invalid_date_range', message: 'Code expiry must be after its start', expected: t.coupons.invalidDateRange },
    { reason: 'coupon_code_taken', message: 'A coupon with this code already exists', expected: t.partnerPrograms.couponTaken },
    { reason: 'partner_code_taken', message: 'A partner code with this code already exists', expected: t.partnerPrograms.partnerTaken },
    { reason: 'partner_program_mismatch', message: 'Partner must belong to this program', expected: t.errors.messageValidation },
    { reason: 'sales_link_codes_disabled', message: 'Discount codes are disabled for offer: The offer', expected: t.errors.messageValidation },
    { reason: 'unknown_reason', message: 'Unmapped provider validation message', expected: t.errors.messageValidation },
  ])('localizes $reason after saving a code', async ({ reason, message, expected }) => {
    const program = partnerProgramSchema.parse({ id: 'program', tenantId: 'tenant', name: 'Ambassadors', commissionPct: 50, createdAt: '2026-10-13T12:00:00.000Z', revision: 1 });
    const partner = { id: 'partner', tenantId: 'tenant', programId: program.id, memberId: 'member', email: 'partner@example.org', status: 'active', createdAt: program.createdAt };
    const code = partnerCodeSchema.parse({ id: 'code', tenantId: 'tenant', programId: program.id, partnerId: partner.id, code: 'FRIEND10', discountPct: 10, salesLinkIds: [sampleSalesLink.id], stripeCouponId: null, stripePromotionCodeId: null, createdAt: program.createdAt, revision: 1 });
    server.use(
      http.get('/api/partner-programs/program', () => HttpResponse.json({ ok: true, data: { program, partners: [partner], codes: [code], commissions: [] } })),
      http.get('/api/members', () => HttpResponse.json({ ok: true, data: { members: [] } })),
      http.get('/api/sales-links', () => HttpResponse.json({ ok: true, data: { salesLinks: [{ ...sampleSalesLink, allowsCodes: true }] } })),
      http.post('/api/partner-codes/code', () => HttpResponse.json({ ok: false, error: { code: 'validation', message, details: { reason } } }, { status: 400 })),
    );
    const root = createRootRoute({ component: () => <PanelContextProvider value={{ tenant: { id: 'tenant', slug: 'acme', name: 'Workspace', staffRole: 'owner', memberId: null }, email: 'owner@example.org', emailVerified: true }}><PartnerProgramDetailPage programId={program.id} /></PanelContextProvider> });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/panel/sales/partner-programs/program'] }) });
    languagePreference.save(language);
    renderWithProviders(<LanguageProvider><RouterProvider router={router} /></LanguageProvider>);
    await userEvent.click(await screen.findByRole('button', { name: t.partnerPrograms.edit }));
    await userEvent.click(screen.getByRole('button', { name: t.partnerPrograms.saveCode }));
    const alert = await within(screen.getByTestId('partner-code-editor')).findByRole('alert');
    expect(alert).toHaveTextContent(expected);
    expect(alert).not.toHaveTextContent(message);
  });
});
