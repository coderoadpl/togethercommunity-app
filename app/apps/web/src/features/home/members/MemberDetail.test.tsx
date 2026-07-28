import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type {
  EmailSendProjection,
  MemberGrant,
  MemberWithProductIds,
  Product,
} from '#core/domain/index.js';

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
  createdAt: '1998-07-01T10:00:00.000Z',
  deletedAt: null,
  productIds: ['p1'],
  activeProductIds: ['p1'],
};

const grants: MemberGrant[] = [
  {
    id: 'grant-active',
    productId: 'p1',
    productName: 'Full Course',
    startsAt: '1998-01-01T00:00:00.000Z',
    expiresAt: '1999-01-01T00:00:00.000Z',
    source: 'manual',
    active: true,
  },
  {
    id: 'grant-expired',
    productId: 'p2',
    productName: 'Old Bundle',
    startsAt: '1997-01-01T00:00:00.000Z',
    expiresAt: '1997-06-01T00:00:00.000Z',
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
    createdAt: '1998-07-01T10:00:00.000Z',
  },
];

const emailSends: EmailSendProjection[] = [
  {
    id: 'marketing-send',
    tenantId: 't1',
    kind: 'marketing',
    recipient: member.email,
    subject: 'July news',
    source: 'broadcast',
    status: 'sent',
    skipReason: null,
    failureCode: null,
    failureMessage: null,
    deliveryStatus: 'delivered',
    deliveryOccurredAt: '1998-07-10T10:01:00.000Z',
    campaignId: 'campaign-1',
    campaignName: 'July',
    sesMessageId: 'ses-marketing',
    transport: 'tenant-ses',
    createdAt: '1998-07-10T10:00:00.000Z',
    sentAt: '1998-07-10T10:00:30.000Z',
  },
  {
    id: 'transactional-send',
    tenantId: 't1',
    kind: 'transactional',
    recipient: member.email,
    subject: 'Welcome',
    source: 'welcome-set-password',
    status: 'sent',
    skipReason: null,
    failureCode: null,
    failureMessage: null,
    deliveryStatus: null,
    deliveryOccurredAt: null,
    transport: 'platform',
    campaignId: null,
    campaignName: null,
    sesMessageId: 'ses-transactional',
    createdAt: '1998-07-09T10:00:00.000Z',
    sentAt: '1998-07-09T10:00:30.000Z',
  },
];

const setup = (): { grantBodies: unknown[]; revoked: string[] } => {
  const grantBodies: unknown[] = [];
  const revoked: string[] = [];
  server.use(
    http.get('/api/members/:memberId/grants', () => HttpResponse.json({ ok: true, data: { grants } })),
    http.get('/api/members/:memberId/emails', () => HttpResponse.json({
      ok: true,
      data: { sends: emailSends },
    })),
    http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products } })),
    http.post('/api/grants', async ({ request }) => {
      grantBodies.push(await request.json());
      return HttpResponse.json({ ok: true, data: { memberId: member.id, grantId: 'grant-new', renewed: false } });
    }),
    http.delete('/api/grants/:grantId', ({ params }) => {
      revoked.push(String(params.grantId));
      return HttpResponse.json({ ok: true, data: { grantId: String(params.grantId), expiresAt: '1998-07-13T00:00:00.000Z' } });
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
    expect(screen.getByText(/1999/)).toBeInTheDocument();
  });

  it('grants a product with the right mutation payload', async () => {
    const { grantBodies } = setup();
    renderWithProviders(<MemberDetail member={member} onBack={() => undefined} />);

    await userEvent.click(await screen.findByRole('combobox', { name: pl.members.productLabel }));
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

  it('shows all email kinds newest-first in the email tab and links to send history', async () => {
    setup();
    renderWithProviders(<MemberDetail member={member} onBack={() => undefined} />);

    await userEvent.click(screen.getByRole('tab', { name: pl.members.emailsTab }));

    const rows = await screen.findAllByTestId('member-email-send');
    expect(rows).toHaveLength(2);
    const marketingRow = rows[0];
    const transactionalRow = rows[1];
    if (marketingRow === undefined || transactionalRow === undefined) return;
    expect(within(marketingRow).getByText('July news')).toBeInTheDocument();
    expect(within(transactionalRow).getByText('Welcome')).toBeInTheDocument();
    expect(within(marketingRow).getByRole('link', { name: pl.marketing.sendDetails }))
      .toHaveAttribute('href', '/panel/marketing/sends/marketing/marketing-send');
  });
});
