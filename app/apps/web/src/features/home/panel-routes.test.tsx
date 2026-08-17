import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { PanelMarketingSettingsRedirectRoute } from './panel-routes.js';

describe('retired panel routes', () => {
  it('sends the old marketing sending settings URL to the integrations e-mail tab', async () => {
    const rootRoute = createRootRoute();
    const integrationsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/panel/integrations',
      component: () => <div data-testid="integrations-route" />,
    });
    const marketingSettingsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/panel/marketing/settings',
      component: PanelMarketingSettingsRedirectRoute,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([integrationsRoute, marketingSettingsRoute]),
      history: createMemoryHistory({ initialEntries: ['/panel/marketing/settings'] }),
    });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByTestId('integrations-route')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/panel/integrations');
    expect(router.state.location.hash).toBe('email');
  });
});
