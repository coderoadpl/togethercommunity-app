import { screen, within } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { partnerProgramSchema } from '#core/domain/partner-program.js';
import { formatPrice } from '../../../lib/format.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelContextProvider } from '../panel-context.js';
import { PartnerProgramsPanel } from './PartnerProgramsPanel.js';

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
