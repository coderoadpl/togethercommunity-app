import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { computeCreatorOnboarding, computeTenantSetupReadiness } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { StudioChecklistDock, StudioChecklistPanel } from './StudioChecklistDock.js';

const stubViewport = (wide: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

const renderDock = async (scope = 'tenant-akademia:creator3@together.dev') => {
  server.use(
    http.get('/api/onboarding', () =>
      HttpResponse.json({
        ok: true,
        data: {
          onboarding: computeCreatorOnboarding(
            {
              hasCourseWithLesson: true,
              hasProductWithActivePrice: false,
              hasPublishedProduct: false,
              hasMember: false,
              paymentsConfigured: false,
            },
            false,
          ),
        },
      }),
    ),
    http.get('/api/onboarding/setup', () =>
      HttpResponse.json({
        ok: true,
        data: {
          setup: computeTenantSetupReadiness({
            stripeConfigured: false,
            emailSendingConfigured: false,
            storageConfigured: false,
            legalTermsConfigured: false,
            publicHomeConfigured: false,
            billingPortalConfigured: false,
            videoConfigured: false,
            brandingConfigured: false,
            invoicingConfigured: false,
          }),
        },
      }),
    ),
  );

  const rootRoute = createRootRoute();
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel',
    component: () => (
      <main tabIndex={-1}>
        <StudioChecklistDock scope={scope} />
      </main>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([dashboardRoute]),
    history: createMemoryHistory({ initialEntries: ['/panel'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

const renderPanel = async (scope = 'tenant-akademia:creator3@together.dev') => {
  server.use(
    http.get('/api/onboarding', () =>
      HttpResponse.json({
        ok: true,
        data: {
          onboarding: computeCreatorOnboarding(
            {
              hasCourseWithLesson: true,
              hasProductWithActivePrice: false,
              hasPublishedProduct: false,
              hasMember: false,
              paymentsConfigured: false,
            },
            false,
          ),
        },
      }),
    ),
    http.get('/api/onboarding/setup', () =>
      HttpResponse.json({
        ok: true,
        data: {
          setup: computeTenantSetupReadiness({
            stripeConfigured: false,
            emailSendingConfigured: false,
            storageConfigured: false,
            legalTermsConfigured: false,
            publicHomeConfigured: false,
            billingPortalConfigured: false,
            videoConfigured: false,
            brandingConfigured: false,
            invoicingConfigured: false,
          }),
        },
      }),
    ),
  );

  const rootRoute = createRootRoute();
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel',
    component: () => (
      <main tabIndex={-1}>
        <StudioChecklistPanel scope={scope} />
      </main>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([dashboardRoute]),
    history: createMemoryHistory({ initialEntries: ['/panel'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

afterEach(() => vi.unstubAllGlobals());

describe('StudioChecklistDock', () => {
  it('does not render a fixed dock at lg and above', async () => {
    stubViewport(true);
    await renderDock();

    expect(screen.queryByTestId('studio-checklist-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-checklist-launcher')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-checklist-bar')).not.toBeInTheDocument();
  });

  it('renders both checklists inside a regular panel', async () => {
    stubViewport(true);
    await renderPanel();

    const panel = await screen.findByTestId('studio-checklist-panel');
    expect(panel).toHaveAttribute('aria-label', en.studioSetup.panelTitle);
    expect(await screen.findByTestId('tenant-setup-checklist')).toBeInTheDocument();
    expect(await screen.findByTestId('onboarding-checklist')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-checklist-launcher')).not.toBeInTheDocument();
  });

  it('renders no regular panel below lg', async () => {
    stubViewport(false);
    await renderPanel();

    expect(screen.queryByTestId('studio-checklist-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tenant-setup-checklist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument();
  });

  it('honours a dismissed checklist preference for the regular panel', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    const closer = 'tenant-akademia:panel-closer@together.dev';
    const dock = await renderDock(closer);

    await user.click(await screen.findByTestId('studio-checklist-close'));

    dock.unmount();
    stubViewport(true);
    await renderPanel(closer);

    expect(screen.queryByTestId('studio-checklist-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tenant-setup-checklist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument();
  });

  it('starts as the bottom bar below sm so the dashboard stays visible on a phone', async () => {
    stubViewport(false);
    await renderDock();

    expect(await screen.findByTestId('studio-checklist-bar')).toBeInTheDocument();
    expect(screen.getByTestId('studio-checklist-launcher')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-checklist-panel')).not.toBeInTheDocument();
  });

  it('opens from the bottom bar, moves focus to the panel and collapses back to the launcher', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    await renderDock();

    await user.click(await screen.findByTestId('studio-checklist-launcher'));

    const panel = await screen.findByTestId('studio-checklist-panel');
    expect(panel).toHaveFocus();
    const collapse = screen.getByTestId('studio-checklist-collapse');
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(collapse).toHaveAttribute('aria-controls', 'studio-checklist-panel');

    await user.click(collapse);

    const bar = screen.getByTestId('studio-checklist-bar');
    expect(bar).toHaveTextContent(en.studioSetup.panelTitle);
    const launcher = screen.getByTestId('studio-checklist-launcher');
    expect(launcher).toHaveAttribute('aria-expanded', 'false');
    expect(launcher).not.toHaveAttribute('aria-controls');
    expect(launcher).toHaveAccessibleName(en.studioSetup.expand({ title: en.studioSetup.panelTitle }));
    expect(launcher).toHaveFocus();
    expect(screen.queryByTestId('studio-checklist-panel')).not.toBeInTheDocument();
  });

  it('closes the dock to a launcher pill and keeps it closed across mounts', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    const closer = 'tenant-akademia:closer@together.dev';
    const first = await renderDock(closer);

    await user.click(await screen.findByTestId('studio-checklist-close'));

    expect(screen.queryByTestId('studio-checklist-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-checklist-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('studio-checklist-reopen')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();

    first.unmount();
    const second = await renderDock(closer);

    expect(await screen.findByTestId('studio-checklist-reopen')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-checklist-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-checklist-bar')).not.toBeInTheDocument();

    second.unmount();
    await renderDock('tenant-akademia:closer-other@together.dev');

    expect(await screen.findByTestId('studio-checklist-bar')).toBeInTheDocument();
  });

  it('reopens a closed dock from the launcher pill and keeps it available across mounts', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    const closer = 'tenant-akademia:reopener@together.dev';
    const first = await renderDock(closer);

    await user.click(await screen.findByTestId('studio-checklist-close'));
    await user.click(screen.getByTestId('studio-checklist-reopen'));

    const launcher = await screen.findByTestId('studio-checklist-launcher');
    expect(launcher).toHaveFocus();
    expect(screen.queryByTestId('studio-checklist-reopen')).not.toBeInTheDocument();

    first.unmount();
    await renderDock(closer);

    expect(await screen.findByTestId('studio-checklist-bar')).toBeInTheDocument();
  });

  it('collapses on Escape and keeps the collapsed state across mounts', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    const { unmount } = await renderDock();

    await user.click(await screen.findByTestId('studio-checklist-launcher'));
    (await screen.findByTestId('studio-checklist-panel')).focus();
    await user.keyboard('{Escape}');

    expect(screen.getByTestId('studio-checklist-bar')).toBeInTheDocument();

    unmount();
    await renderDock();

    expect(await screen.findByTestId('studio-checklist-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-checklist-panel')).not.toBeInTheDocument();
  });

  it('keeps the stored state out of another account on the same browser', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    const { unmount } = await renderDock('tenant-akademia:creator3@together.dev');

    await user.click(await screen.findByTestId('studio-checklist-launcher'));
    expect(await screen.findByTestId('studio-checklist-panel')).toBeInTheDocument();

    unmount();
    await renderDock('tenant-akademia:other@together.dev');

    expect(await screen.findByTestId('studio-checklist-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-checklist-panel')).not.toBeInTheDocument();
  });
});
