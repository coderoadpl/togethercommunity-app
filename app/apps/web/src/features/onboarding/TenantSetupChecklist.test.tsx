import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { computeTenantSetupReadiness, type TenantSetupFacts } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { TenantSetupChecklist } from './TenantSetupChecklist.js';

const facts = (overrides: Partial<TenantSetupFacts> = {}): TenantSetupFacts => ({
  stripeConfigured: false,
  emailSendingConfigured: false,
  storageConfigured: false,
  legalTermsConfigured: false,
  publicHomeConfigured: false,
  billingPortalConfigured: false,
  videoConfigured: false,
  brandingConfigured: false,
  invoicingConfigured: false,
  ...overrides,
});

const REQUIRED_CONFIGURED: Partial<TenantSetupFacts> = {
  stripeConfigured: true,
  emailSendingConfigured: true,
  storageConfigured: true,
  legalTermsConfigured: true,
  publicHomeConfigured: true,
};

const renderChecklist = async (overrides: Partial<TenantSetupFacts> = {}) => {
  server.use(
    http.get('/api/onboarding/setup', () =>
      HttpResponse.json({
        ok: true,
        data: { setup: computeTenantSetupReadiness(facts(overrides)) },
      }),
    ),
  );

  const rootRoute = createRootRoute();
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel',
    component: TenantSetupChecklist,
  });
  const integrationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/integrations',
    component: () => null,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/settings',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([dashboardRoute, integrationsRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ['/panel'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('TenantSetupChecklist', () => {
  it('lists every setup item with its consequence and deep link', async () => {
    await renderChecklist();

    expect(await screen.findByTestId('tenant-setup-checklist')).toBeInTheDocument();
    expect(
      screen.getByText(pl.tenantSetup.progress({ configured: 0, total: 9 })),
    ).toBeInTheDocument();
    expect(screen.getByText(pl.tenantSetup.requiredHeading)).toBeInTheDocument();
    expect(screen.getByText(pl.tenantSetup.optionalHeading)).toBeInTheDocument();
    expect(screen.getByText(pl.tenantSetup.items.storage.impact)).toBeInTheDocument();
    expect(screen.getAllByText(pl.tenantSetup.itemMissing)).toHaveLength(9);

    expect(
      screen.getByTestId('tenant-setup-item-stripe').querySelector('a'),
    ).toHaveAttribute('href', '/panel/integrations#stripe');
    expect(
      screen.getByTestId('tenant-setup-item-public_home').querySelector('a'),
    ).toHaveAttribute('href', '/panel/settings#public-access');
    expect(
      screen.getByTestId('tenant-setup-item-video').querySelector('a'),
    ).toHaveAttribute('href', '/panel/integrations#video');
  });

  it('marks configured items and keeps the outstanding ones visible', async () => {
    await renderChecklist({ storageConfigured: true, videoConfigured: true });

    expect(await screen.findByTestId('tenant-setup-checklist')).toBeInTheDocument();
    expect(
      screen.getByText(pl.tenantSetup.progress({ configured: 2, total: 9 })),
    ).toBeInTheDocument();
    expect(screen.getAllByText(pl.tenantSetup.itemConfigured)).toHaveLength(2);
    expect(screen.queryByTestId('tenant-setup-complete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tenant-setup-toggle')).not.toBeInTheDocument();
  });

  it('collapses to the all-configured state once every required item is green', async () => {
    await renderChecklist(REQUIRED_CONFIGURED);

    expect(await screen.findByTestId('tenant-setup-complete')).toBeInTheDocument();
    expect(screen.getByText(pl.tenantSetup.allConfigured)).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-setup-item-stripe')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('tenant-setup-toggle'));

    expect(screen.getByTestId('tenant-setup-item-stripe')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-setup-item-invoicing')).toBeInTheDocument();
  });

  it('never offers a way to dismiss the widget', async () => {
    await renderChecklist();

    await screen.findByTestId('tenant-setup-checklist');
    expect(screen.queryByTestId('tenant-setup-dismiss')).not.toBeInTheDocument();
  });

  it('surfaces a retryable error state', async () => {
    server.use(
      http.get('/api/onboarding/setup', () =>
        HttpResponse.json({ ok: false, error: { code: 'forbidden', message: 'nope' } }, { status: 403 }),
      ),
    );

    renderWithProviders(<TenantSetupChecklist />);

    await waitFor(() => expect(screen.getByText(pl.common.retry)).toBeInTheDocument());
  });
});
