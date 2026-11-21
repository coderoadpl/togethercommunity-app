import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { changeProposalImageMissingNote, type ChangeProposalGroupOwnerView, type ChangeProposalOwnerView } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ToastProvider } from '../../../components/ui/Toast.js';
import { en } from '../../../i18n/en.js';
import { formatPrice } from '../../../lib/format.js';
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

const normalized = (text: string): string => text.replace(/\s+/gu, ' ');

const renderPanel = (
  staffRole: 'owner' | 'admin' = 'owner',
  { emailVerified = true, impersonating = false }: { emailVerified?: boolean; impersonating?: boolean } = {},
) => {
  const rootRoute = createRootRoute();
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/proposals',
    component: () => (
      <PanelContextProvider
        value={{ tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole, memberId: null }, email: 'owner@example.org', emailVerified, impersonating }}
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
    expect(group).toHaveTextContent(t.groupTitleAttribution({ key: 'Catalogue agent' }));
    expect(within(group).getByText(t.groupStep({ position: 5, operation: t.operation['sales-link.create'] }))).toBeInTheDocument();
    expect(group).toHaveTextContent('the product from step 1 (“Field Guide (print)”)');
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
    expect(delta).toHaveTextContent(t.stockReason({ reason: 'New delivery from the printer' }));
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
    expect(within(dialog).getByText(t.approveGroupBody({ count: 5 }))).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('Launch the printed field guide');
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
    expect(await screen.findByTestId('proposal-approve-summary'))
      .toHaveTextContent(`${t.approveStockAdded({ target: 'Creator Workbook (print)', count: 50 })} ${t.approveNothingElse}`);
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

  it('shows an image awaiting approval only through the owner preview, with its loading and failed states', async () => {
    const digest = 'c'.repeat(64);
    const proposed = `/api/public/assets/logo/${digest}.png`;
    usePending([{
      ...settingsProposal,
      id: 'proposal-quarantined-logo',
      input: { logoUrl: proposed },
      effect: { logoUrl: { before: '/api/public/assets/logo/current.png', after: proposed } },
    }]);

    const { container } = renderPanel();

    const row = await screen.findByTestId('proposal-field-logoUrl');
    const preview = within(row).getByTestId('proposed-image');
    expect(preview).toHaveAttribute('data-state', 'loading');
    expect(within(preview).getByRole('status')).toHaveTextContent(t.proposedImageLoading);
    expect(within(preview).getByTestId('proposed-image-facts')).toHaveTextContent(t.proposedImageFacts({ format: 'PNG', fingerprint: digest.slice(0, 12) }));
    expect(within(preview).getByText(t.proposedImagePrivate)).toBeInTheDocument();
    const sources = [...container.querySelectorAll('img')].map((image) => image.getAttribute('src'));
    expect(sources).toEqual(['/api/public/assets/logo/current.png', `/api/change-proposals/proposal-quarantined-logo/assets/${digest}`]);

    const image = within(preview).getByRole('img', { name: t.proposedImageAlt });
    fireEvent.load(image);
    expect(preview).toHaveAttribute('data-state', 'loaded');
    expect(within(preview).queryByRole('status')).toBeNull();
    fireEvent.error(image);
    expect(preview).toHaveAttribute('data-state', 'failed');
    expect(within(preview).getByRole('alert')).toHaveTextContent(t.proposedImageFailed);
    expect(within(preview).queryByRole('img')).toBeNull();
    expect(within(preview).queryByText(t.proposedImagePrivate)).toBeNull();
    expect(within(preview).getByText(proposed)).toBeInTheDocument();
    expect(within(preview).getByTestId('content-address')).toHaveAttribute('title', proposed);
    expect(within(preview).getByTestId('content-address-short')).toHaveTextContent(`/api/public/assets/logo/${digest.slice(0, 12)}…${digest.slice(-4)}.png`);
  });

  it('never renders a proposed SVG inline: it offers a download through the owner preview and says why', async () => {
    const digest = 'd'.repeat(64);
    const proposed = `/api/public/assets/logo/${digest}.svg`;
    usePending([{
      ...settingsProposal,
      id: 'proposal-quarantined-svg',
      input: { logoUrl: proposed },
      effect: { logoUrl: { before: null, after: proposed } },
    }]);

    const { container } = renderPanel();

    const row = await screen.findByTestId('proposal-field-logoUrl');
    const preview = within(row).getByTestId('proposed-image');
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(within(preview).getByText(t.proposedImageSvgReason)).toBeInTheDocument();
    const link = within(preview).getByRole('link', { name: t.proposedImageSvgDownload });
    expect(link).toHaveAttribute('href', `/api/change-proposals/proposal-quarantined-svg/assets/${digest}`);
    expect(link).toHaveAttribute('download', `${digest}.svg`);
    expect(within(preview).getByTestId('proposed-image-facts')).toHaveTextContent(t.proposedImageFacts({ format: 'SVG', fingerprint: digest.slice(0, 12) }));
  });

  it('loads a proposed address that an earlier approval already published through the owner preview too', async () => {
    const digest = 'e'.repeat(64);
    const published = `/api/public/assets/product-cover/${digest}.png`;
    usePending([{
      ...stockAdjustmentProposal,
      id: 'proposal-reused-cover',
      operation: 'product.update',
      target: { kind: 'product', id: 'product-field-guide' },
      targetLabel: 'Field Guide (print)',
      input: { id: 'product-field-guide', coverUrl: published },
      effect: { coverUrl: { before: null, after: published } },
    }]);

    const { container } = renderPanel();

    const row = await screen.findByTestId('proposal-field-coverUrl');
    const preview = within(row).getByTestId('proposed-image');
    expect([...container.querySelectorAll('img')].map((image) => image.getAttribute('src')))
      .toEqual([`/api/change-proposals/proposal-reused-cover/assets/${digest}`]);
    fireEvent.load(within(preview).getByRole('img', { name: t.proposedImageAlt }));
    expect(preview).toHaveAttribute('data-state', 'loaded');
    expect(within(preview).queryByRole('alert')).toBeNull();
    expect(within(preview).getByText(t.proposedImagePrivate)).toBeInTheDocument();
  });

  it('says the proposed image is gone, not that the shop changed, when an approval ends stale for a missing image', async () => {
    const digest = 'f'.repeat(64);
    const proposed = `/api/public/assets/logo/${digest}.png`;
    const pending = { ...settingsProposal, id: 'proposal-gone-logo', input: { logoUrl: proposed }, effect: { logoUrl: { before: null, after: proposed } } };
    const decided = settledView(pending, { status: 'stale' });
    usePending([pending]);
    server.use(
      http.post('/api/change-proposals/:id/approve', () => HttpResponse.json({ ok: true, data: { proposal: decided } })),
      http.get('/api/change-proposals/:id', () => HttpResponse.json({
        ok: true,
        data: {
          proposal: {
            ...decided,
            events: [
              { sequence: 1, kind: 'proposed', actorUserId: null, apiKeyId: 'key-1', note: null, at: '2026-11-19T12:00:00.000Z' },
              { sequence: 2, kind: 'stale', actorUserId: 'owner', apiKeyId: null, note: changeProposalImageMissingNote({ kind: 'logo', digest, extension: 'png' }), at: '2026-11-20T12:00:00.000Z' },
            ],
          },
        },
      })),
    );

    renderPanel();

    await userEvent.click(await screen.findByTestId('proposal-approve'));
    await userEvent.click(await screen.findByTestId('proposal-approve-confirm'));
    const outcome = await screen.findByTestId('proposal-outcome-proposal-gone-logo');
    expect(outcome).toHaveTextContent(t.outcomeImageUnavailable);
    expect(outcome).not.toHaveTextContent(t.outcomeStale);
  });

  it('explains a stale proposal of a missing image in the history row and its timeline, and any other stale proposal as before', async () => {
    const digest = 'a'.repeat(64);
    const proposed = `/api/public/assets/logo/${digest}.png`;
    const siblingCover = `/api/public/assets/product-cover/${'b'.repeat(64)}.png`;
    const gone = settledView({ ...settingsProposal, id: 'proposal-history-gone', input: { logoUrl: proposed }, effect: { logoUrl: { before: null, after: proposed } } }, { status: 'stale' });
    const moved = settledView({ ...settingsProposal, id: 'proposal-history-moved' }, { status: 'stale' });
    const sibling = settledView({
      ...stockAdjustmentProposal,
      id: 'proposal-history-sibling',
      groupId: 'group-history',
      groupPosition: 2,
      operation: 'product.update',
      input: { id: 'product-field-guide', coverUrl: siblingCover },
      effect: { coverUrl: { before: null, after: siblingCover } },
    }, { status: 'stale' });
    const detailsRead: string[] = [];
    usePending([]);
    server.use(
      http.get('/api/change-proposals', ({ request }) => HttpResponse.json({
        ok: true,
        data: { proposals: new URL(request.url).searchParams.get('status') === 'decided' ? [gone, moved, sibling] : [], nextCursor: null, hasMore: false },
      })),
      http.get('/api/change-proposals/:id', ({ params }) => {
        detailsRead.push(String(params['id']));
        const proposal = [gone, sibling].find((entry) => entry.id === params['id']) ?? moved;
        const note = params['id'] === gone.id
          ? changeProposalImageMissingNote({ kind: 'logo', digest, extension: 'png' })
          : params['id'] === sibling.id ? 'Not applied because item 1 of the group did not apply' : null;
        return HttpResponse.json({
          ok: true,
          data: { proposal: { ...proposal, events: [{ sequence: 1, kind: 'stale', actorUserId: 'owner', apiKeyId: null, note, at: '2026-11-20T12:00:00.000Z' }] } },
        });
      }),
    );

    renderPanel();

    await userEvent.click(await screen.findByRole('tab', { name: t.tabHistory }));
    const goneRow = await screen.findByTestId(`proposal-history-${gone.id}`);
    expect(await within(goneRow).findByText(t.outcomeImageUnavailable)).toBeInTheDocument();
    expect(goneRow).not.toHaveTextContent(t.outcomeStale);
    expect(within(goneRow).getByTestId('proposal-history-status')).toHaveTextContent(t.statusStaleImageUnavailable);
    const movedRow = screen.getByTestId(`proposal-history-${moved.id}`);
    expect(movedRow).toHaveTextContent(t.outcomeStale);
    expect(within(movedRow).getByTestId('proposal-history-status')).toHaveTextContent(t.status.stale);
    const siblingRow = screen.getByTestId(`proposal-history-${sibling.id}`);
    await waitFor(() => expect(detailsRead).toContain(sibling.id));
    expect(within(siblingRow).getByTestId('proposal-history-status')).toHaveTextContent(t.status.stale);
    expect(siblingRow).toHaveTextContent(t.outcomeStale);
    expect(detailsRead.toSorted()).toEqual([gone.id, sibling.id].toSorted());

    await userEvent.click(within(goneRow).getByTestId('proposal-history-toggle'));
    const timeline = await within(goneRow).findByTestId('proposal-timeline');
    expect(timeline).toHaveTextContent(t.eventStaleImageUnavailable);
    expect(timeline).not.toHaveTextContent(t.event.stale);
    expect(timeline).not.toHaveTextContent(t.outcomeImageUnavailable);
    expect(timeline).not.toHaveTextContent('image_unavailable');
    const address = within(within(goneRow).getByTestId('proposal-field-logoUrl')).getByTestId('content-address');
    expect(address).toHaveAttribute('title', proposed);
    expect(address).toHaveTextContent(`/api/public/assets/logo/${digest.slice(0, 12)}…${digest.slice(-4)}.png`);
  });

  it('lists decided proposals in the history tab with their status and note', async () => {
    usePending([]);
    server.use(http.get('/api/change-proposals', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status');
      return HttpResponse.json({
        ok: true,
        data: {
          proposals: status === 'decided' ? [settledView(settingsProposal, { status: 'rejected', decisionNote: 'Keep the old address' })] : [],
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
    expect(row).toHaveTextContent(t.decisionNote({ note: 'Keep the old address' }));
  });

  it('approves a group with the item ids in position order, whatever order the server serves them in', async () => {
    usePending(pendingChangeProposals.filter((proposal) => proposal.groupId !== null), { ...changeProposalGroup, items: changeProposalGroup.items.toReversed() });
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
    await userEvent.click(await screen.findByTestId('proposal-approve-confirm'));

    await waitFor(() => expect(body).toEqual({ itemIds: changeProposalGroup.items.map((item) => item.id) }));
  });

  it('closes the approval and sends nothing when a refetch changes the group while the dialog is open', async () => {
    const [first] = changeProposalGroup.items;
    if (first === undefined) throw new Error('missing fixture');
    const extra = { ...first, id: 'proposal-field-guide-extra', groupPosition: 6 };
    let grown = false;
    let approved = false;
    usePending(pendingChangeProposals.filter((proposal) => proposal.groupId !== null));
    server.use(
      http.get('/api/change-proposals/groups/:id', () => HttpResponse.json({
        ok: true,
        data: { group: grown ? { ...changeProposalGroup, items: [...changeProposalGroup.items, extra] } : changeProposalGroup },
      })),
      http.post('/api/change-proposals/groups/:id/approve', () => {
        approved = true;
        return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'unexpected' } }, { status: 500 });
      }),
    );

    const { queryClient } = renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: t.approveGroup({ count: 5 }) }));
    expect(await screen.findByTestId('proposal-approve-dialog')).toBeInTheDocument();
    grown = true;
    await queryClient.invalidateQueries(actions.changeProposalsInvalidates());

    expect(await screen.findByTestId('proposal-group-changed')).toHaveTextContent(t.groupChanged);
    await waitFor(() => expect(screen.queryByTestId('proposal-approve-dialog')).toBeNull());
    expect(approved).toBe(false);
    expect(await screen.findByRole('button', { name: t.approveGroup({ count: 6 }) })).toBeEnabled();
  });

  it('says the group changed without claiming an attempt when no dialog was open', async () => {
    const [first] = changeProposalGroup.items;
    if (first === undefined) throw new Error('missing fixture');
    let grown = false;
    usePending(pendingChangeProposals.filter((proposal) => proposal.groupId !== null));
    server.use(http.get('/api/change-proposals/groups/:id', () => HttpResponse.json({
      ok: true,
      data: { group: grown ? { ...changeProposalGroup, items: [...changeProposalGroup.items, { ...first, id: 'proposal-field-guide-extra', groupPosition: 6 }] } : changeProposalGroup },
    })));

    const { queryClient } = renderPanel();

    expect(await screen.findByRole('button', { name: t.approveGroup({ count: 5 }) })).toBeInTheDocument();
    grown = true;
    await queryClient.invalidateQueries(actions.changeProposalsInvalidates());

    const notice = await screen.findByTestId('proposal-group-changed');
    expect(notice).toHaveTextContent(t.groupChangedWhileReviewing);
    expect(notice).not.toHaveTextContent(t.groupChanged);
    expect(t.groupChangedWhileReviewing).not.toMatch(/applied/u);
  });

  it.each(['expired', 'withdrawn', 'applied'] as const)('closes an open dialog when the group is %s elsewhere', async (status) => {
    let closed = false;
    usePending(pendingChangeProposals.filter((proposal) => proposal.groupId !== null));
    server.use(http.get('/api/change-proposals/groups/:id', () => HttpResponse.json({
      ok: true,
      data: { group: closed ? { ...changeProposalGroup, status } : changeProposalGroup },
    })));

    const { queryClient } = renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: t.rejectGroup }));
    expect(await screen.findByTestId('proposal-reject-dialog')).toBeInTheDocument();
    closed = true;
    await queryClient.invalidateQueries(actions.changeProposalGroup(CHANGE_PROPOSAL_GROUP_ID));

    await waitFor(() => expect(screen.queryByTestId('proposal-reject-dialog')).toBeNull());
    const card = screen.getByTestId(`proposal-group-card-${CHANGE_PROPOSAL_GROUP_ID}`);
    expect(within(card).getByText(t.status[status])).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: t.rejectGroup })).toBeNull();
  });

  it('keeps text written by the key out of the application sentences and isolates it where it is shown', async () => {
    const title = 'Spring” \u202Elaunch';
    const keyName = 'Agent \u202Eone';
    const items = changeProposalGroup.items.map((item) => ({ ...item, groupTitle: title }));
    const group = { ...changeProposalGroup, title, proposedBy: { ...changeProposalGroup.proposedBy, keyName }, items };
    usePending(pendingChangeProposals.filter((proposal) => proposal.groupId !== null).map((proposal) => ({ ...proposal, groupTitle: title })), group);
    server.use(http.post('/api/change-proposals/groups/:id/approve', () => HttpResponse.json({
      ok: true,
      data: { group: { ...group, status: 'stale', items: items.map((item) => ({ ...item, status: 'stale' })) } },
    })));

    renderPanel();

    const titleElement = await screen.findByTestId('proposal-group-title');
    expect(titleElement.querySelector('bdi')).toHaveTextContent(title);
    const card = screen.getByTestId(`proposal-group-card-${CHANGE_PROPOSAL_GROUP_ID}`);
    expect([...card.querySelectorAll('bdi')].map((element) => element.textContent)).toContain(keyName);
    await userEvent.click(screen.getByRole('button', { name: t.approveGroup({ count: 5 }) }));
    const dialog = await screen.findByTestId('proposal-approve-dialog');
    expect(dialog).not.toHaveTextContent('Spring');
    await userEvent.click(within(dialog).getByTestId('proposal-approve-confirm'));

    const outcome = await screen.findByTestId(`proposal-outcome-${CHANGE_PROPOSAL_GROUP_ID}`);
    expect(outcome).toHaveTextContent(t.groupHeading({ count: 5 }));
    expect(outcome).not.toHaveTextContent('Spring');
  });

  it('confirms a single approval by naming the target and what will happen', async () => {
    usePending([{
      ...stockAdjustmentProposal,
      id: 'proposal-publish',
      operation: 'product.publish',
      target: { kind: 'product', id: 'product-field-guide' },
      targetLabel: 'Field Guide (print)',
      input: { id: 'product-field-guide' },
      effect: { published: { before: false, after: true } },
    }]);

    renderPanel();

    await userEvent.click(await screen.findByTestId('proposal-approve'));
    expect(await screen.findByTestId('proposal-approve-summary'))
      .toHaveTextContent(`${t.approveProductPublish({ target: 'Field Guide (print)' })} ${t.approveNothingElse}`);
  });

  it('shows a new record as one framed list with readable values and a fallback for an image that fails', async () => {
    const created = pendingChangeProposals.find((proposal) => proposal.id === 'proposal-field-guide-product');
    if (created === undefined) throw new Error('missing fixture');
    usePending([{ ...created, groupId: null, groupTitle: null, groupPosition: null }]);

    renderPanel();

    const card = await screen.findByTestId(`proposal-card-${created.id}`);
    const record = within(card).getByTestId('proposal-new-record');
    expect(within(card).getAllByText(t.newRecordCaption)).toHaveLength(1);
    expect(within(card).queryByText(t.columnAfter)).toBeNull();
    expect(within(record).getByText(en.salesLinks.physical)).toBeInTheDocument();
    expect(within(record).queryByText('physical')).toBeNull();
    const image = record.querySelector('img');
    if (image === null) throw new Error('missing image');
    fireEvent.error(image);
    expect(await within(record).findByText(t.imageNotShown)).toBeInTheDocument();
    expect(within(record).getByText('/api/public/assets/product-cover/field-guide.webp')).toBeInTheDocument();
    expect(record.querySelector('img')).toBeNull();
  });

  it('shows a new price as the framed new-record block with its terms on one line, alone and as a group step', async () => {
    const groupPrice = pendingChangeProposals.find((proposal) => proposal.id === 'proposal-field-guide-price');
    if (groupPrice === undefined) throw new Error('missing fixture');
    usePending([...pendingChangeProposals.filter((proposal) => proposal.groupId !== null), {
      ...groupPrice,
      id: 'proposal-club-yearly',
      groupId: null,
      groupTitle: null,
      groupPosition: null,
      target: { kind: 'product', id: 'product-club' },
      targetLabel: 'Studio Club',
      input: { productId: 'product-club', kind: 'recurring', interval: 'year', amountCents: 49000, currency: 'PLN' },
      effect: { activePrices: {
        before: [{ kind: 'recurring', interval: 'month', amountCents: 4900, currency: 'PLN' }],
        after: [{ kind: 'recurring', interval: 'month', amountCents: 4900, currency: 'PLN' }, { kind: 'recurring', interval: 'year', amountCents: 49000, currency: 'PLN' }],
      } },
    }]);

    renderPanel();

    const card = await screen.findByTestId('proposal-card-proposal-club-yearly');
    const record = within(card).getByTestId('proposal-new-record');
    expect(record).toHaveTextContent(t.newRecordCaption);
    expect(within(record).getByTestId('proposal-field-price')).toHaveTextContent(
      normalized(t.priceRecurring({ price: formatPrice(49000, 'PLN', 'en'), interval: t.priceInterval.year })),
    );
    expect(within(card).queryByText(t.columnNow)).toBeNull();
    expect(within(card).queryByText(t.columnAfter)).toBeNull();

    const step = await screen.findByTestId('proposal-group-item-proposal-field-guide-price');
    expect(within(step).getByTestId('proposal-field-price')).toHaveTextContent(normalized(t.priceOneTime({ price: formatPrice(3900, 'PLN', 'en') })));
    expect(within(step).queryByText(t.columnNow)).toBeNull();
  });

  it('names which price a price change touches, on the card and in the confirmation', async () => {
    usePending([{
      ...stockAdjustmentProposal,
      id: 'proposal-club-price-off',
      operation: 'price.deactivate',
      target: { kind: 'price', id: 'price-club-monthly' },
      targetLabel: 'Studio Club',
      targetPrice: { kind: 'recurring', interval: 'month', intervalCount: 1, amountCents: 4900, currency: 'PLN' },
      input: { id: 'price-club-monthly' },
      effect: { active: { before: true, after: false } },
    }]);
    const price = t.priceRecurring({ price: formatPrice(4900, 'PLN', 'en'), interval: t.priceInterval.month });

    renderPanel();

    const card = await screen.findByTestId('proposal-card-proposal-club-price-off');
    expect(within(card).getByTestId('proposal-target')).toHaveTextContent(normalized(t.targetWithPrice({ product: 'Studio Club', price })));
    expect(within(card).getByRole('heading', { level: 3, name: t.fields.activePrice })).toBeInTheDocument();
    await userEvent.click(within(card).getByTestId('proposal-approve'));
    expect(await screen.findByTestId('proposal-approve-summary'))
      .toHaveTextContent(normalized(`${t.approvePriceDeactivate({ target: 'Studio Club', price })} ${t.approveNothingElse}`));
  });

  it('says a target no longer exists instead of showing the proposed title', async () => {
    usePending([{
      ...stockAdjustmentProposal,
      id: 'proposal-gone',
      operation: 'product.update',
      target: { kind: 'product', id: 'product-removed' },
      targetLabel: null,
      input: { id: 'product-removed', title: 'Renamed workbook' },
      effect: { title: { before: 'Old workbook', after: 'Renamed workbook' } },
    }]);

    renderPanel();

    const target = await screen.findByTestId('proposal-target');
    expect(target).toHaveTextContent(`${t.targetKind.product}: ${t.targetGone}`);
    expect(target).not.toHaveTextContent('Renamed workbook');
  });

  it('starts a long text expanded when the collapsed beginnings of both sides are the same', async () => {
    const opening = 'This opening paragraph stays exactly the same in both versions. '.repeat(6);
    usePending([{
      ...stockAdjustmentProposal,
      id: 'proposal-description',
      operation: 'product.update',
      target: { kind: 'product', id: STOCK_PRODUCT_ID },
      input: { id: STOCK_PRODUCT_ID, description: `${opening}New ending.` },
      effect: { description: { before: `${opening}Old ending.`, after: `${opening}New ending.` } },
    }]);

    renderPanel();

    const row = await screen.findByTestId('proposal-field-description');
    expect(within(row).getAllByRole('button', { name: t.showLess })).toHaveLength(2);
    expect(within(row).getByText(/New ending\./u)).toBeInTheDocument();
  });

  it('appends the next page of waiting proposals and moves focus to the first new card', async () => {
    usePending([]);
    server.use(http.get('/api/change-proposals', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      return HttpResponse.json({
        ok: true,
        data: cursor === null
          ? { proposals: [stockAdjustmentProposal], nextCursor: stockAdjustmentProposal.id, hasMore: true }
          : { proposals: [settingsProposal], nextCursor: null, hasMore: false },
      });
    }));

    renderPanel();

    await userEvent.click(await screen.findByTestId('proposals-load-more'));

    const added = await screen.findByTestId(`proposal-card-${settingsProposal.id}`);
    expect(screen.getByTestId(`proposal-card-${stockAdjustmentProposal.id}`)).toBeInTheDocument();
    await waitFor(() => expect(added.parentElement).toHaveFocus());
    expect(screen.queryByTestId('proposals-load-more')).toBeNull();
  });

  it('keeps the list when the next page fails and retries only that page', async () => {
    usePending([]);
    let failNext = true;
    server.use(http.get('/api/change-proposals', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (cursor === null) return HttpResponse.json({ ok: true, data: { proposals: [stockAdjustmentProposal], nextCursor: stockAdjustmentProposal.id, hasMore: true } });
      if (failNext) return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'down' } }, { status: 500 });
      return HttpResponse.json({ ok: true, data: { proposals: [settingsProposal], nextCursor: null, hasMore: false } });
    }));

    renderPanel();

    await userEvent.click(await screen.findByTestId('proposals-load-more'));
    const failure = await screen.findByTestId('proposals-load-more-error');
    expect(failure).toHaveTextContent(t.loadMoreFailed);
    expect(screen.getByTestId(`proposal-card-${stockAdjustmentProposal.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('proposals-load-more')).toBeNull();

    failNext = false;
    await userEvent.click(within(failure).getByRole('button', { name: en.common.retry }));
    const added = await screen.findByTestId(`proposal-card-${settingsProposal.id}`);
    expect(screen.getByTestId(`proposal-card-${stockAdjustmentProposal.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('proposals-load-more-error')).toBeNull();
    await waitFor(() => expect(added.parentElement).toHaveFocus());
  });

  it('keeps the cards, an open dialog and the settled notices when a background refetch fails', async () => {
    usePending([stockAdjustmentProposal, settingsProposal]);
    server.use(http.post('/api/change-proposals/:id/approve', () => HttpResponse.json({
      ok: true,
      data: { proposal: settledView(stockAdjustmentProposal, { status: 'stale' }) },
    })));

    const { queryClient } = renderPanel();

    const stock = await screen.findByTestId(`proposal-card-${stockAdjustmentProposal.id}`);
    await userEvent.click(within(stock).getByTestId('proposal-approve'));
    await userEvent.click(await screen.findByTestId('proposal-approve-confirm'));
    expect(await screen.findByTestId(`proposal-outcome-${stockAdjustmentProposal.id}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('proposal-approve-dialog')).toBeNull());

    let failedReads = 0;
    server.use(http.get('/api/change-proposals', () => {
      failedReads += 1;
      return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'down' } }, { status: 500 });
    }));
    const settings = screen.getByTestId(`proposal-card-${settingsProposal.id}`);
    await userEvent.click(within(settings).getByTestId('proposal-reject'));
    expect(await screen.findByTestId('proposal-reject-dialog')).toBeInTheDocument();
    await queryClient.invalidateQueries(actions.changeProposalsInvalidates());

    await waitFor(() => expect(failedReads).toBeGreaterThan(0));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.getByTestId(`proposal-card-${settingsProposal.id}`)).toBeInTheDocument();
    expect(screen.getByTestId('proposal-reject-dialog')).toBeInTheDocument();
    expect(screen.getByTestId(`proposal-outcome-${stockAdjustmentProposal.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('proposals-load-more-error')).toBeNull();
  });

  it.each([
    [{ emailVerified: false }, t.unverifiedTitle],
    [{ impersonating: true }, t.impersonatingTitle],
  ] as const)('shows an owner who cannot decide (%o) why, without reading proposals', async (context, title) => {
    let listed = false;
    server.use(http.get('/api/change-proposals', () => {
      listed = true;
      return HttpResponse.json({ ok: true, data: { proposals: [], nextCursor: null, hasMore: false } });
    }));

    renderPanel('owner', context);

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.common.retry })).toBeNull();
    expect(listed).toBe(false);
  });
});
