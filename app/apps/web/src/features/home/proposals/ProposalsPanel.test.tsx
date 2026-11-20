import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ChangeProposalGroupOwnerView, ChangeProposalOwnerView } from '#core/domain/index.js';

import { ToastProvider } from '../../../components/ui/Toast.js';
import { en } from '../../../i18n/en.js';
import {
  CHANGE_PROPOSAL_GROUP_ID,
  changeProposalGroup,
  pendingChangeProposals,
  settingsProposal,
  STOCK_PRODUCT_ID,
  stockAdjustmentProposal,
} from '../../../test/change-proposal-fixtures.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelContextProvider } from '../panel-context.js';
import { ProposalsPanel } from './ProposalsPanel.js';

const t = en.changeProposals;

const renderPanel = (staffRole: 'owner' | 'admin' = 'owner') => {
  const rootRoute = createRootRoute();
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/proposals',
    component: () => (
      <PanelContextProvider
        value={{ tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole, memberId: null }, email: 'owner@example.org', emailVerified: true }}
      >
        <ProposalsPanel />
      </PanelContextProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/panel/proposals'] }),
  });
  return renderWithProviders(<ToastProvider><RouterProvider router={router} /></ToastProvider>);
};

const stockLevel = {
  productId: STOCK_PRODUCT_ID,
  onHand: 12,
  reserved: 2,
  available: 10,
  lowStockThreshold: null,
  lowStockNotifiedAt: null,
  low: false,
  soldOut: false,
  updatedAt: '2026-11-19T15:00:00.000Z',
};

const usePending = (proposals: ChangeProposalOwnerView[], group: ChangeProposalGroupOwnerView = changeProposalGroup) => {
  server.use(
    http.get('/api/change-proposals', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status');
      return HttpResponse.json({ ok: true, data: { proposals: status === 'pending' ? proposals : [], nextCursor: null, hasMore: false } });
    }),
    http.get('/api/change-proposals/groups/:id', () => HttpResponse.json({ ok: true, data: { group } })),
    http.get('/api/products/:productId/stock', () => HttpResponse.json({ ok: true, data: { stock: stockLevel } })),
  );
};

const settledView = (proposal: ChangeProposalOwnerView, fields: Partial<ChangeProposalOwnerView>): ChangeProposalOwnerView => ({
  ...proposal,
  decidedByUserId: 'owner',
  decidedByEmail: 'owner@example.org',
  decidedAt: '2026-11-20T12:00:00.000Z',
  ...fields,
});

describe('ProposalsPanel', () => {
  it('shows an admin the owner-only state without reading proposals', async () => {
    let listed = false;
    server.use(http.get('/api/change-proposals', () => {
      listed = true;
      return HttpResponse.json({ ok: true, data: { proposals: [], nextCursor: null, hasMore: false } });
    }));

    renderPanel('admin');

    expect(await screen.findByText(t.ownerOnlyTitle)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: t.tabPending })).toBeNull();
    expect(listed).toBe(false);
  });

  it('shows the owner a card per group and per single proposal, oldest first', async () => {
    usePending(pendingChangeProposals);

    renderPanel();

    const group = await screen.findByTestId(`proposal-group-card-${CHANGE_PROPOSAL_GROUP_ID}`);
    expect(await within(group).findByTestId('proposal-group-title')).toHaveTextContent('Launch the printed field guide');
    expect(within(group).getByText(t.groupTitleAttribution({ key: 'Catalogue agent' }))).toBeInTheDocument();
    expect(within(group).getByText(t.groupStep({ position: 5, operation: t.operation['sales-link.create'] }))).toBeInTheDocument();
    expect(within(group).getByText('the product from step 1 (“Field Guide (print)”)')).toBeInTheDocument();
    const cards = screen.getAllByTestId(/^proposal-(card|group-card)-/u).map((card) => card.dataset['testid']);
    expect(cards).toEqual([
      `proposal-card-${stockAdjustmentProposal.id}`,
      `proposal-group-card-${CHANGE_PROPOSAL_GROUP_ID}`,
      `proposal-card-${settingsProposal.id}`,
    ]);
    const settings = screen.getByTestId(`proposal-card-${settingsProposal.id}`);
    expect(within(settings).getByText(t.warningKeyExpired)).toBeInTheDocument();
    expect(within(settings).getByText(t.yes)).toBeInTheDocument();
    expect(within(settings).getAllByText(t.operation['settings.update'])).toHaveLength(1);
  });

  it('words a stock adjustment as a delta with its reason and the live balance', async () => {
    usePending([stockAdjustmentProposal]);

    renderPanel();

    const delta = await screen.findByTestId('proposal-stock-delta');
    expect(within(delta).getByText('+50 pieces')).toBeInTheDocument();
    expect(within(delta).getByText(t.stockReason({ reason: 'New delivery from the printer' }))).toBeInTheDocument();
    expect(await within(delta).findByText(t.stockOnHandNow({ count: 12 }))).toBeInTheDocument();
    expect(within(delta).getByText(t.stockDeltaRule)).toBeInTheDocument();
    expect(within(delta).queryByText(/62/u)).toBeNull();
  });

  it('approves a group with exactly the item ids it shows', async () => {
    usePending(pendingChangeProposals.filter((proposal) => proposal.groupId !== null));
    let body: unknown;
    server.use(http.post('/api/change-proposals/groups/:id/approve', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({
        ok: true,
        data: { group: { ...changeProposalGroup, status: 'applied', items: changeProposalGroup.items.map((item) => ({ ...item, status: 'applied' })) } },
      });
    }));

    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: t.approveGroup({ count: 5 }) }));
    const dialog = await screen.findByTestId('proposal-approve-dialog');
    expect(within(dialog).getByText(t.approveGroupBody({ count: 5, title: 'Launch the printed field guide' }))).toBeInTheDocument();
    await userEvent.click(within(dialog).getByTestId('proposal-approve-confirm'));

    await waitFor(() => expect(body).toEqual({ itemIds: changeProposalGroup.items.map((item) => item.id) }));
    expect(await screen.findByText(t.outcomeGroupApplied({ count: 5 }))).toBeInTheDocument();
  });

  it('reloads a group that changed on the server and says so', async () => {
    const [first] = changeProposalGroup.items;
    if (first === undefined) throw new Error('missing fixture');
    const extra = { ...first, id: 'proposal-field-guide-extra', groupPosition: 6 };
    let groupReads = 0;
    usePending(pendingChangeProposals.filter((proposal) => proposal.groupId !== null));
    server.use(
      http.get('/api/change-proposals/groups/:id', () => {
        groupReads += 1;
        const group = groupReads === 1 ? changeProposalGroup : { ...changeProposalGroup, items: [...changeProposalGroup.items, extra] };
        return HttpResponse.json({ ok: true, data: { group } });
      }),
      http.post('/api/change-proposals/groups/:id/approve', () => HttpResponse.json({
        ok: false,
        error: { code: 'conflict', message: 'The group changed', details: { changeProposalGroupItemIds: [...changeProposalGroup.items.map((item) => item.id), extra.id] } },
      }, { status: 409 })),
    );

    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: t.approveGroup({ count: 5 }) }));
    await userEvent.click(await screen.findByTestId('proposal-approve-confirm'));

    expect(await screen.findByTestId('proposal-group-changed')).toHaveTextContent(t.groupChanged);
    expect(await screen.findByRole('button', { name: t.approveGroup({ count: 6 }) })).toBeInTheDocument();
  });

  it('rejects with a note that is sent to the server', async () => {
    usePending([settingsProposal]);
    let body: unknown;
    server.use(http.post('/api/change-proposals/:id/reject', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ ok: true, data: { proposal: settledView(settingsProposal, { status: 'rejected', decisionNote: 'Not now' }) } });
    }));

    renderPanel();

    await userEvent.click(await screen.findByTestId('proposal-reject'));
    const dialog = await screen.findByTestId('proposal-reject-dialog');
    expect(within(dialog).getByText(t.rejectNoteHelp)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByTestId('proposal-reject-note'), 'Not now');
    await userEvent.click(within(dialog).getByTestId('proposal-reject-confirm'));

    await waitFor(() => expect(body).toEqual({ note: 'Not now' }));
    expect(await screen.findByText(t.outcomeRejected)).toBeInTheDocument();
  });

  it.each([
    ['stale', null, t.outcomeStale],
    ['failed', 'Stock cannot go below zero', t.outcomeFailed({ reason: 'Stock cannot go below zero' })],
  ] as const)('explains a %s approval on the card', async (status, failureMessage, explanation) => {
    usePending([stockAdjustmentProposal]);
    server.use(http.post('/api/change-proposals/:id/approve', () => HttpResponse.json({
      ok: true,
      data: { proposal: settledView(stockAdjustmentProposal, { status, failureMessage, failureCode: failureMessage === null ? null : 'conflict' }) },
    })));

    renderPanel();

    await userEvent.click(await screen.findByTestId('proposal-approve'));
    expect(await screen.findByText(t.approveBody({ what: t.operation['stock.adjust'] }))).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('proposal-approve-confirm'));

    const outcome = await screen.findByTestId(`proposal-outcome-${stockAdjustmentProposal.id}`);
    expect(outcome).toHaveTextContent(explanation);
    expect(outcome).toHaveFocus();
  });

  it('tells the owner to retry when the shop is busy and changes nothing', async () => {
    usePending([settingsProposal]);
    server.use(http.post('/api/change-proposals/:id/approve', () => HttpResponse.json(
      { ok: false, error: { code: 'unavailable', message: 'busy', details: { retryAfterSeconds: 5 } } },
      { status: 503 },
    )));

    renderPanel();

    await userEvent.click(await screen.findByTestId('proposal-approve'));
    await userEvent.click(await screen.findByTestId('proposal-approve-confirm'));

    expect(await screen.findByTestId('proposal-busy')).toHaveTextContent(t.busy);
    expect(screen.getByTestId(`proposal-card-${settingsProposal.id}`)).toBeInTheDocument();
    expect(screen.getByTestId('proposal-approve')).toBeEnabled();
  });

  it('does not let the owner approve an operation the page does not know', async () => {
    usePending([{ ...settingsProposal, id: 'proposal-future', operation: 'coupon.create', target: { kind: 'settings', id: null } }]);

    renderPanel();

    const card = await screen.findByTestId('proposal-card-proposal-future');
    expect(within(card).getByText(t.unknownOperation)).toBeInTheDocument();
    expect(within(card).getByText(t.unknownOperationName({ operation: 'coupon.create' }))).toBeInTheDocument();
    expect(within(card).getByText(t.unknownOperationNotApprovable)).toBeInTheDocument();
    expect(within(card).getByTestId('proposal-approve')).toBeDisabled();
    expect(within(card).getByTestId('proposal-reject')).toBeEnabled();
  });

  it('shows a foreign image address as text, never as an image', async () => {
    usePending([{
      ...settingsProposal,
      id: 'proposal-logo',
      input: { logoUrl: 'https://images.example.org/logo.png' },
      effect: { logoUrl: { before: '/api/public/assets/logo/current.png', after: 'https://images.example.org/logo.png' } },
    }]);

    const { container } = renderPanel();

    const row = await screen.findByTestId('proposal-field-logoUrl');
    expect(within(row).getByText('https://images.example.org/logo.png')).toBeInTheDocument();
    const sources = [...container.querySelectorAll('img')].map((image) => image.getAttribute('src'));
    expect(sources).toEqual(['/api/public/assets/logo/current.png']);
  });

  it('lists decided proposals in the history tab with their status and note', async () => {
    usePending([]);
    server.use(http.get('/api/change-proposals', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status');
      return HttpResponse.json({
        ok: true,
        data: {
          proposals: status === 'pending' ? [] : [settledView(settingsProposal, { status: 'rejected', decisionNote: 'Keep the old address' })],
          nextCursor: null,
          hasMore: false,
        },
      });
    }));

    renderPanel();

    expect(await screen.findByText(t.pendingEmptyTitle)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: t.tabHistory }));
    const row = await screen.findByTestId(`proposal-history-${settingsProposal.id}`);
    expect(within(row).getByTestId('proposal-history-status')).toHaveTextContent(t.status.rejected);
    expect(within(row).getByText(t.decisionNote({ note: 'Keep the old address' }))).toBeInTheDocument();
  });
});
