import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { EmailEvent, EmailSendProjection } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SendDetailPage, SendsPanel, validateSendsSearch } from './SendsPanel.js';

const baseSend: EmailSendProjection = {
  id: 'send-1',
  tenantId: 'tenant-1',
  kind: 'marketing',
  recipient: 'contact@example.test',
  subject: 'Campaign update',
  source: 'campaign',
  sourceApp: null,
  status: 'sent',
  skipReason: null,
  failureCode: null,
  failureMessage: null,
  deliveryStatus: 'delivered',
  deliveryOccurredAt: '2026-09-09T10:05:30.000Z',
  campaignId: 'campaign-1',
  campaignName: 'September campaign',
  contactId: 'contact-1',
  audienceSnapshotId: null,
  sesMessageId: 'ses-1',
  transport: 'tenant-ses',
  createdAt: '2026-09-09T10:00:00.000Z',
  sentAt: '2026-09-09T10:01:00.000Z',
};

const bouncedEvent: EmailEvent = {
  id: 'event-1',
  tenantId: 'tenant-1',
  mailKind: 'marketing',
  refId: 'send-1',
  type: 'bounced',
  occurredAt: '2026-09-09T10:05:30.000Z',
  meta: { classification: 'hard', rawProviderPayload: { bounceType: 'Permanent' } },
  createdAt: '2026-09-09T10:05:30.000Z',
};

const renderSendsPanel = async (initialEntry: string) => {
  const root = createRootRoute();
  const sendsRoute = createRoute({
    getParentRoute: () => root,
    path: '/panel/marketing/sends',
    validateSearch: validateSendsSearch,
    component: SendsPanel,
  });
  const sendDetailRoute = createRoute({
    getParentRoute: () => root,
    path: '/panel/marketing/sends/$kind/$sendId',
    component: SendDetailPage,
  });
  const contactRoute = createRoute({
    getParentRoute: () => root,
    path: '/panel/marketing/contacts/$contactId',
    component: () => null,
  });
  const campaignRoute = createRoute({
    getParentRoute: () => root,
    path: '/panel/marketing/campaigns/$campaignId',
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([sendsRoute, sendDetailRoute, contactRoute, campaignRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

describe('sends panel scheduler run filter', () => {
  it('loads a linked run filter and can clear it', async () => {
    const requests: string[] = [];
    server.use(
      http.get('/api/marketing/campaigns', () =>
        HttpResponse.json({ ok: true, data: { campaigns: [] } })),
      http.get('/api/marketing/sends', ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json({ ok: true, data: { sends: [], nextCursor: null } });
      }),
    );
    const { router } = await renderSendsPanel('/panel/marketing/sends?runId=run-linked');

    expect(await screen.findByLabelText(en.marketing.runIdFilter)).toHaveValue('run-linked');
    await waitFor(() => {
      expect(requests.some((request) => new URL(request).searchParams.get('runId') === 'run-linked')).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: en.marketing.clearRunFilter }));

    await waitFor(() => {
      expect(requests.some((request) => !new URL(request).searchParams.has('runId'))).toBe(true);
    });
    expect(router.state.location.search).toEqual({});
  });
});

describe('sends panel delivery rendering', () => {
  it('keeps the log compact and reveals secondary columns behind a toggle', async () => {
    server.use(
      http.get('/api/marketing/campaigns', () =>
        HttpResponse.json({ ok: true, data: { campaigns: [] } })),
      http.get('/api/marketing/sends', () =>
        HttpResponse.json({ ok: true, data: { sends: [baseSend], nextCursor: null } })),
    );
    await renderSendsPanel('/panel/marketing/sends');

    const table = await screen.findByRole('table', { name: en.marketing.sendsTitle });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(6);
    expect(within(table).queryByRole('columnheader', { name: en.marketing.transportLabel })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: en.marketing.showSendLogDetails }));

    expect(within(table).getAllByRole('columnheader')).toHaveLength(10);
    expect(within(table).getByRole('columnheader', { name: en.marketing.transportLabel })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: en.marketing.sourceApp })).toBeInTheDocument();
  });

  it('surfaces bounced outcomes and localizes suppression details', async () => {
    const bouncedSend: EmailSendProjection = {
      ...baseSend,
      id: 'bounced-send',
      subject: 'Bounced campaign',
      skipReason: 'hard_bounce',
      deliveryStatus: 'bounced',
      deliveryOccurredAt: '2026-09-09T10:05:30.000Z',
    };
    server.use(
      http.get('/api/marketing/sends/:kind/:id', () =>
        HttpResponse.json({ ok: true, data: { send: bouncedSend, events: [bouncedEvent] } })),
    );

    await renderSendsPanel('/panel/marketing/sends/marketing/bounced-send');

    expect(await screen.findByText(en.marketing.deliveryOutcomeBounced)).toBeInTheDocument();
    expect(screen.getAllByText(en.marketing.deliveryBounced).length).toBeGreaterThan(0);
    expect(screen.getByText(en.marketing.suppressionReason)).toBeInTheDocument();
    expect(screen.getByText(en.marketing.suppressionReasons.hard_bounce)).toBeInTheDocument();
    expect(screen.getByText(en.marketing.bounceClassifications.hard)).toBeInTheDocument();
    expect(screen.queryByText('hard_bounce')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: bouncedSend.recipient })).toHaveAttribute('href', '/panel/marketing/contacts/contact-1');
    expect(screen.getByRole('link', { name: bouncedSend.campaignName ?? '' })).toHaveAttribute('href', '/panel/marketing/campaigns/campaign-1');
  });
});
