import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { sampleBundleOrder } from '../../../test/sales-link-fixtures.js';
import { PanelContextProvider } from '../panel-context.js';
import { OrderVerificationPage } from './OrderVerificationPage.js';

const renderPage = async (reference: string) => {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/panel/orders/verify/$token', component: () => <PanelContextProvider value={{ tenant: { id: 't1', slug: 'acme', name: 'Workspace', staffRole: 'admin', memberId: null }, email: 'staff@example.org', emailVerified: true }}><OrderVerificationPage reference={reference} /></PanelContextProvider> });
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/panel/orders/verify/${reference}`] }) });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

it('looks up a token and refreshes the issue count after an issue', async () => {
  let issued = false;
  server.use(
    http.get('/api/orders/verify/:reference', ({ params }) => {
      expect(params['reference']).toBe(sampleBundleOrder.verificationToken);
      return HttpResponse.json({ ok: true, data: { order: { ...sampleBundleOrder, lines: sampleBundleOrder.lines?.map((line) => line.productType === 'physical' && issued ? { ...line, issuedCount: 1, issuedAt: '2026-10-08T12:00:00.000Z', issuedBy: 'staff-1', issuedByDisplayName: 'staff@example.org' } : line) } } });
    }),
    http.post('/api/orders/:orderId/lines/:productId/issue', ({ params }) => {
      expect(params).toMatchObject({ orderId: sampleBundleOrder.id, productId: 'product-1' });
      issued = true;
      return HttpResponse.json({ ok: true, data: { order: sampleBundleOrder } });
    }),
  );
  await renderPage(sampleBundleOrder.verificationToken ?? '');
  await userEvent.click(await screen.findByRole('button', { name: 'Mark as issued' }));
  expect(await screen.findByText('Issued 1 of 1')).toBeVisible();
  expect(screen.getByText(/First issued:/)).toBeVisible();
  expect(screen.getByText('Issued by: staff@example.org')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Mark as issued' })).toBeNull();
});

it('shows not found without buyer information for an unknown token', async () => {
  server.use(http.get('/api/orders/verify/:reference', () => HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'Order was not found' } }, { status: 404 })));
  await renderPage('unknown');
  await waitFor(() => expect(screen.getByText('Order not found')).toBeVisible());
  expect(screen.queryByText('buyer@example.org')).toBeNull();
});

it('refreshes the same manual reference when another staff member issued the item', async () => {
  let issuedCount = 0;
  server.use(http.get('/api/orders/verify/:reference', () => HttpResponse.json({ ok: true, data: { order: { ...sampleBundleOrder, lines: sampleBundleOrder.lines.map((line) => line.productType === 'physical' ? { ...line, issuedCount } : line) } } })));
  await renderPage('order-2026-001');
  expect(await screen.findByText('Issued 0 of 1')).toBeVisible();
  issuedCount = 1;
  await userEvent.click(screen.getByRole('button', { name: 'Find order' }));
  expect(await screen.findByText('Issued 1 of 1')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Mark as issued' })).toBeNull();
});
