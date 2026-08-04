import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
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
  bannedAt: null,
  bannedReason: null,
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
    type: 'course',
    slug: 'new-workshop',
    title: 'New Workshop',
    description: '',
    coverUrl: null,
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

const setup = (): { banBodies: unknown[]; grantBodies: unknown[]; revoked: string[] } => {
  const banBodies: unknown[] = [];
  const grantBodies: unknown[] = [];
  const revoked: string[] = [];
  server.use(
    http.get('/api/members/:memberId/grants', () => HttpResponse.json({ ok: true, data: { grants } })),
    http.get('/api/members/:memberId/commerce', () => HttpResponse.json({
      ok: true,
      data: {
        purchases: [{
          id: 'order-1',
          tenantId: 't1',
          memberId: member.id,
          productId: 'p1',
          priceId: 'price-1',
          kind: 'recurring',
          status: 'paid',
          amountCents: 4900,
          currency: 'PLN',
          provider: 'stripe',
          providerObjectIds: { subscription: 'sub_stripe_1' },
          couponId: null,
          discountCents: 0,
          createdAt: '1998-07-08T10:00:00.000Z',
          memberEmail: member.email,
          memberName: member.displayName,
          productTitle: 'Full Course',
          couponCode: null,
        }],
        activeSubscriptions: [{
          id: 'subscription-1',
          tenantId: 't1',
          memberId: member.id,
          productId: 'p1',
          priceId: 'price-1',
          provider: 'stripe',
          providerSubscriptionId: 'sub_stripe_1',
          status: 'active',
          currentPeriodEnd: '1998-08-08T10:00:00.000Z',
          cancelAtPeriodEnd: false,
          couponId: null,
          couponDiscountCents: 0,
          couponRecurringDuration: null,
          createdAt: '1998-07-08T10:00:00.000Z',
          updatedAt: '1998-07-08T10:00:00.000Z',
          productTitle: 'Full Course',
        }],
      },
    })),
    http.get('/api/members/:memberId/timeline', () => HttpResponse.json({
      ok: true,
      data: {
        events: [{
          id: 'purchase:order-1',
          tenantId: 't1',
          memberId: member.id,
          type: 'purchase',
          payload: {
            orderId: 'order-1',
            productId: 'p1',
            kind: 'recurring',
            status: 'paid',
            amountCents: 4900,
            currency: 'PLN',
            provider: 'stripe',
            productTitle: 'Full Course',
          },
          occurredAt: '1998-07-08T10:00:00.000Z',
        }],
      },
    })),
    http.get('/api/members/:memberId/learning-summary', () => HttpResponse.json({
      ok: true,
      data: {
        summary: {
          lastActivityAt: '1998-07-09T10:00:00.000Z',
          courses: [{
            courseId: 'course-1',
            courseName: 'JavaScript Foundations',
            completedLessonCount: 1,
            accessibleLessonCount: 4,
            lastActivityAt: '1998-07-09T10:00:00.000Z',
            latestCompletedLesson: { lessonId: 'lesson-1', name: 'Variables' },
          }],
        },
      },
    })),
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
    http.post('/api/members/ban', async ({ request }) => {
      banBodies.push(await request.json());
      return HttpResponse.json({
        ok: true,
        data: {
          member: {
            ...member,
            bannedAt: '1998-07-14T10:00:00.000Z',
            bannedReason: 'Repeated abuse',
            bannedByUserId: 'staff-1',
          },
        },
      });
    }),
  );
  return { banBodies, grantBodies, revoked };
};

const renderMemberDetail = (value: MemberWithProductIds = member) => {
  const rootRoute = createRootRoute();
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/members/$memberId',
    component: () => <MemberDetail member={value} onBack={() => undefined} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute]),
    history: createMemoryHistory({ initialEntries: [`/panel/members/${value.id}`] }),
  });
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('MemberDetail', () => {
  it('shows the complete 360 overview from account through commerce and domain events', async () => {
    setup();
    renderMemberDetail();

    expect(await screen.findByText(`${pl.members.accountName}: ${member.displayName ?? '—'}`))
      .toBeInTheDocument();
    expect(screen.getByText(`${pl.members.accountEmail}: ${member.email}`)).toBeInTheDocument();
    expect(await screen.findByTestId('member-purchase-row')).toHaveTextContent('Full Course');
    expect(screen.getByTestId('member-purchase-row')).toHaveTextContent('49,00 zł');
    expect(within(screen.getByTestId('member-purchase-row')).getByRole('link'))
      .toHaveAttribute('href', '/panel/sales/order-1');
    expect(await screen.findByTestId('member-subscription-row')).toHaveTextContent('Stripe');
    expect(screen.getByTestId('member-subscription-row')).toHaveTextContent(
      pl.members.subscriptionStatuses.active,
    );
    expect(await screen.findByTestId('member-timeline-row')).toHaveTextContent(
      pl.members.timelineEventLabels.purchase,
    );
    expect(screen.getByTestId('member-timeline-row')).toHaveTextContent('Full Course');
    const learningRow = await screen.findByTestId('learning-summary-row');
    expect(learningRow).toHaveTextContent('JavaScript Foundations');
    expect(learningRow).toHaveTextContent(pl.members.lessonsProgress({ completed: 1, total: 4 }));
    expect(learningRow).toHaveTextContent('25%');
    expect(learningRow).toHaveTextContent('Variables');
    expect(learningRow.querySelector('time'))
      .toHaveAttribute('datetime', '1998-07-09T10:00:00.000Z');
    expect(await screen.findAllByTestId('grant-row')).toHaveLength(2);
  });

  it('keeps grant and renew controls available for an active member', async () => {
    setup();
    renderMemberDetail();

    expect(await screen.findByText(pl.members.grantProduct)).toBeInTheDocument();
    expect(await screen.findAllByRole('button', { name: pl.members.renew })).toHaveLength(2);
    expect(screen.queryByTestId('member-tombstone-notice')).not.toBeInTheDocument();
  });

  it('shows the tombstone while keeping grant history and revoke controls', async () => {
    setup();
    renderMemberDetail({ ...member, deletedAt: '1998-07-20T10:00:00.000Z' });

    expect(await screen.findByTestId('member-tombstone-notice')).toHaveTextContent(
      pl.members.tombstoneNotice,
    );
    expect(screen.queryByText(pl.members.grantProduct)).not.toBeInTheDocument();
    expect(screen.queryByText(pl.members.renew)).not.toBeInTheDocument();
    expect(screen.queryByText(pl.members.moderationHeading)).not.toBeInTheDocument();
    expect(await screen.findAllByTestId('grant-row')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: pl.members.revoke })).toHaveLength(2);
  });

  it('renders active vs expired grants', async () => {
    setup();
    renderMemberDetail();

    expect(await screen.findAllByText('Full Course')).toHaveLength(3);
    expect(screen.getAllByTestId('grant-row')).toHaveLength(2);
    expect(screen.getByText(pl.members.active)).toBeInTheDocument();
    expect(screen.getByText(pl.members.expired)).toBeInTheDocument();
    expect(screen.getByText(/1999/)).toBeInTheDocument();
  });

  it('grants a product with the right mutation payload', async () => {
    const { grantBodies } = setup();
    renderMemberDetail();

    await userEvent.click(await screen.findByRole('combobox', { name: pl.members.productLabel }));
    await userEvent.click(await screen.findByRole('option', { name: 'New Workshop' }));
    await userEvent.click(screen.getByRole('button', { name: pl.members.grant }));

    await waitFor(() => expect(grantBodies).toHaveLength(1));
    expect(grantBodies[0]).toEqual({ memberId: 'member-1', productId: 'p3', expiresAt: null });
  });

  it('revokes a grant through the confirmation dialog', async () => {
    const { revoked } = setup();
    renderMemberDetail();

    const [firstRevoke] = await screen.findAllByRole('button', { name: pl.members.revoke });
    if (firstRevoke) await userEvent.click(firstRevoke);

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: pl.members.revoke }));

    await waitFor(() => expect(revoked).toEqual(['grant-active']));
  });

  it('bans a member with the staff-only reason from the confirmation dialog', async () => {
    const { banBodies } = setup();
    renderMemberDetail();

    await userEvent.click(await screen.findByRole('button', { name: pl.members.ban }));
    const dialog = await screen.findByRole('dialog', { name: pl.members.ban });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: pl.members.banReasonLabel }),
      'Repeated abuse',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: pl.members.ban }));

    await waitFor(() => expect(banBodies).toEqual([
      { memberId: 'member-1', banned: true, reason: 'Repeated abuse' },
    ]));
  });

  it('shows all email kinds newest-first in the email tab and links to send history', async () => {
    setup();
    renderMemberDetail();

    await userEvent.click(await screen.findByRole('tab', { name: pl.members.emailsTab }));

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
