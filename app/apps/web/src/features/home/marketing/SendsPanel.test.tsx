import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SendsPanel, validateSendsSearch } from './SendsPanel.js';

const renderSendsPanel = async (initialEntry: string) => {
  const root = createRootRoute();
  const sendsRoute = createRoute({
    getParentRoute: () => root,
    path: '/panel/marketing/sends',
    validateSearch: validateSendsSearch,
    component: SendsPanel,
  });
  const router = createRouter({
    routeTree: root.addChildren([sendsRoute]),
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

  it('loads a linked failed status filter', async () => {
    const requests: string[] = [];
    server.use(
      http.get('/api/marketing/campaigns', () =>
        HttpResponse.json({ ok: true, data: { campaigns: [] } })),
      http.get('/api/marketing/sends', ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json({ ok: true, data: { sends: [], nextCursor: null } });
      }),
    );

    await renderSendsPanel('/panel/marketing/sends?runId=run-linked&status=failed');

    expect(await screen.findByLabelText(en.marketing.runIdFilter)).toHaveValue('run-linked');
    await waitFor(() => {
      expect(requests.some((request) => {
        const params = new URL(request).searchParams;
        return params.get('runId') === 'run-linked' && params.get('status') === 'failed';
      })).toBe(true);
    });
  });
});
