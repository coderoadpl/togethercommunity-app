import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ErasureRequestsSection } from './ErasureRequestsSection.js';

const renderSection = async () => {
  const rootRoute = createRootRoute({ component: ErasureRequestsSection });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/panel/members'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('ErasureRequestsSection', () => {
  it('lists and rejects an open erasure request', async () => {
    let rejected = false;
    server.use(
      http.get('*/api/members/erasure-requests', () =>
        HttpResponse.json({
          ok: true,
          data: {
            requests: [
              {
                id: 'request-1',
                tenantId: 'tenant-1',
                memberId: 'member-1',
                status: 'open',
                reason: null,
                requestedAt: '2026-07-29T10:00:00.000Z',
                dueAt: '2026-08-28T10:00:00.000Z',
                resolvedAt: null,
                resolvedByUserId: null,
                resolutionNote: null,
                member: {
                  id: 'member-1',
                  email: 'member@example.com',
                  displayName: null,
                },
              },
            ],
          },
        }),
      ),
      http.post('*/api/members/erasure-requests/request-1/reject', () => {
        rejected = true;
        return HttpResponse.json({
          ok: true,
          data: {
            request: {
              id: 'request-1',
              tenantId: 'tenant-1',
              memberId: 'member-1',
              status: 'rejected',
              reason: null,
              requestedAt: '2026-07-29T10:00:00.000Z',
              dueAt: '2026-08-28T10:00:00.000Z',
              resolvedAt: '2026-07-29T11:00:00.000Z',
              resolvedByUserId: 'staff-1',
              resolutionNote: 'Retained',
            },
          },
        });
      }),
    );
    await renderSection();
    expect(await screen.findByText(/member@example.com/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Powód odrzucenia'), 'Retained');
    await userEvent.click(screen.getByRole('button', { name: 'Odrzuć' }));
    await waitFor(() => expect(rejected).toBe(true));
  });
});
