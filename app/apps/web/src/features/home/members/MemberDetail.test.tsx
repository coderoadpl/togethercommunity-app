import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { MemberGrant, MemberWithProductIds, Product } from '@core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { MemberDetail } from './MemberDetail.js';

const member: MemberWithProductIds = {
  id: 'member-1',
  email: 'student@together.dev',
  displayName: 'Student One',
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: '2026-07-01T10:00:00.000Z',
  productIds: ['p1'],
};

const grants: MemberGrant[] = [
  {
    id: 'grant-active',
    productId: 'p1',
    productName: 'Full Course',
    startsAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    source: 'manual',
    active: true,
  },
  {
    id: 'grant-expired',
    productId: 'p2',
    productName: 'Old Bundle',
    startsAt: '2025-01-01T00:00:00.000Z',
    expiresAt: '2025-06-01T00:00:00.000Z',
    source: 'simulated',
    active: false,
  },
];

const products: Product[] = [
  {
    id: 'p3',
    tenantId: 't1',
    title: 'New Workshop',
    description: '',
    priceCents: 0,
    currency: 'PLN',
    published: true,
    accessItems: [],
    legacyId: null,
    createdAt: '2026-07-01T10:00:00.000Z',
  },
];

const setup = (): { grantBodies: unknown[]; revoked: string[] } => {
  const grantBodies: unknown[] = [];
  const revoked: string[] = [];
  server.use(
    http.get('/api/members/:memberId/grants', () => HttpResponse.json({ ok: true, data: { grants } })),
    http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products } })),
    http.post('/api/grants', async ({ request }) => {
      grantBodies.push(await request.json());
      return HttpResponse.json({ ok: true, data: { memberId: member.id, grantId: 'grant-new', renewed: false } });
    }),
    http.delete('/api/grants/:grantId', ({ params }) => {
      revoked.push(String(params.grantId));
      return HttpResponse.json({ ok: true, data: { grantId: String(params.grantId), expiresAt: '2026-07-13T00:00:00.000Z' } });
    }),
  );
  return { grantBodies, revoked };
};

describe('MemberDetail', () => {
  it('renders active vs expired grants', async () => {
    setup();
    renderWithProviders(<MemberDetail member={member} onBack={() => undefined} />);

    expect(await screen.findByText('Full Course')).toBeInTheDocument();
    expect(screen.getAllByTestId('grant-row')).toHaveLength(2);
    expect(screen.getByText(pl.members.active)).toBeInTheDocument();
    expect(screen.getByText(pl.members.expired)).toBeInTheDocument();
    expect(screen.getByText(/2027/)).toBeInTheDocument();
  });

  it('grants a product with the right mutation payload', async () => {
    const { grantBodies } = setup();
    renderWithProviders(<MemberDetail member={member} onBack={() => undefined} />);

    await userEvent.click(await screen.findByRole('combobox', { name: 'grant product' }));
    await userEvent.click(await screen.findByRole('option', { name: 'New Workshop' }));
    await userEvent.click(screen.getByRole('button', { name: pl.members.grant }));

    await waitFor(() => expect(grantBodies).toHaveLength(1));
    expect(grantBodies[0]).toEqual({ memberId: 'member-1', productId: 'p3', expiresAt: null });
  });

  it('revokes a grant through the confirmation dialog', async () => {
    const { revoked } = setup();
    renderWithProviders(<MemberDetail member={member} onBack={() => undefined} />);

    const [firstRevoke] = await screen.findAllByRole('button', { name: pl.members.revoke });
    if (firstRevoke) await userEvent.click(firstRevoke);

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: pl.members.revoke }));

    await waitFor(() => expect(revoked).toEqual(['grant-active']));
  });
});
