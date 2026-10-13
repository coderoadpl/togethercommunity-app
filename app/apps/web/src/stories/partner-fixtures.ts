import fixture from './fixtures/panel-coupons.json';

const calls = Object.fromEntries(Object.entries(fixture.calls).filter(([key]) => key !== 'listCouponStats:[{}]'));
const program = {
  id: 'program-studio-ambassadors', tenantId: 'tenant-studio', name: 'Ambassadors',
  commissionPct: 50, graceDays: 30, status: 'active',
  notes: 'Monthly settlement after the refund window.',
  createdAt: '2026-05-02T12:00:00.000Z', revision: 1,
};
const partners = [{
  id: 'partner-studio-alex', tenantId: 'tenant-studio', programId: program.id,
  memberId: 'member-studio-alex', email: 'alex@example.org', status: 'active',
  createdAt: program.createdAt,
}];
const codes = [{
  id: 'code-studio-alex10', tenantId: 'tenant-studio', programId: program.id,
  partnerId: 'partner-studio-alex', code: 'ALEX10', discountPct: 10,
  salesLinkIds: ['offer-studio-learning'], validFrom: null, validTo: null,
  maxRedemptions: null, status: 'active', stripeCouponId: null,
  stripePromotionCodeId: null, createdAt: program.createdAt, revision: 1,
}];

export const partnerProgramsFixture = {
  ...fixture,
  scenario: 'panel-partner-programs',
  route: '/panel/sales/partner-programs',
  calls: {
    ...calls,
    'listPartnerPrograms:[{}]': { ok: true, value: { programs: [{
      program, partnerCount: 1, codeCount: 1,
      currencyTotals: [{ currency: 'PLN', pendingCents: 29800, payableCents: 39400, paidCents: 75600 }],
    }] } },
  },
};

export const partnerProgramEditorFixture = {
  ...fixture,
  scenario: 'panel-partner-program-editor',
  route: '/panel/sales/partner-programs/program-studio-ambassadors',
  calls: {
    ...calls,
    'getPartnerProgram:[{"id":"program-studio-ambassadors"}]': { ok: true, value: { program, partners, codes, commissions: [] } },
    'listMembers:[]': { ok: true, value: { members: [] } },
    'listSalesLinks:[{}]': { ok: true, value: { salesLinks: [] } },
  },
};
