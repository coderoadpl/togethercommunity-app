import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ConsentForm } from './ConsentsPanel.js';

describe('ConsentForm', () => {
  it('shows localized field guidance for an invalid consent key', async () => {
    server.use(
      http.get('/api/marketing/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [] } })),
    );
    const root = createRootRoute();
    const route = createRoute({
      getParentRoute: () => root,
      path: '/panel/marketing/consents/new',
      component: ConsentForm,
    });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/panel/marketing/consents/new'] }),
    });
    await router.load();
    renderWithProviders(<RouterProvider router={router} />);

    const key = await screen.findByLabelText(en.marketing.keyLabel);
    await userEvent.type(key, 'Product_News');
    await userEvent.type(screen.getByLabelText(en.marketing.wordingLabel), 'Product news');
    await userEvent.type(screen.getByLabelText(en.marketing.documentUrlLabel), 'https://example.test/news');
    await userEvent.click(screen.getByRole('button', { name: en.marketing.createConsentAction }));

    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(en.marketing.keyFormatHint)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toHaveTextContent(/validation error/i);
  }, 20_000);
});
