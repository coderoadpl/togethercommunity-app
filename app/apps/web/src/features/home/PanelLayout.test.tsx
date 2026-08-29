import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { DashboardPanel } from './DashboardPanel.js';
import {
  PanelCoursesRoute,
  PanelIntegrationsRoute,
  PanelLessonsRoute,
  PanelMembersRoute,
  PanelProductsRoute,
  PanelSalesRoute,
  PanelSettingsRoute,
} from './panel-routes.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { PanelLayout } from './PanelLayout.js';

const meWithTenant = {
  userId: 'u1',
  email: 'creator@together.dev',
  emailVerified: true,
  name: 'Demo',
  tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: null, banned: false },
};

const MarketingTestRoute = () => <div data-testid="marketing-route" />;

const stubViewport = (isDesktop: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

const commonHandlers = () => {
  server.use(
    http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithTenant })),
    http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })),
    http.get('/api/products/access-issues', () => HttpResponse.json({ ok: true, data: { issues: [] } })),
    http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [] } })),
    http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules: [] } })),
    http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
    http.get('/api/members', () => HttpResponse.json({ ok: true, data: { members: [] } })),
    http.get('/api/reports', () =>
      HttpResponse.json({ ok: true, data: { items: [], nextCursor: null, openCount: 3 } })),
    http.get('/api/sales/summary', () =>
      HttpResponse.json({
        ok: true,
        data: { summary: { revenueLast30Days: [], activeSubscriptions: 0, ordersLast30Days: 0 } },
      }),
    ),
    http.get('/api/orders', () =>
      HttpResponse.json({ ok: true, data: { orders: [], total: 0, page: 1, pageSize: 25 } }),
    ),
    http.get('/api/coupons/options', () =>
      HttpResponse.json({ ok: true, data: { coupons: [] } }),
    ),
    http.get('/api/orders/reconciliation', () =>
      HttpResponse.json({
        ok: true,
        data: { rows: [], checkedThrough: '2026-08-03T12:00:00.000Z' },
      }),
    ),
  );
};

interface RenderPanelOptions {
  preventNavigation?: boolean;
}

const renderPanelAt = async (
  initialPath: string,
  { preventNavigation = false }: RenderPanelOptions = {},
) => {
  const rootRoute = createRootRoute();
  const layoutRoute = createRoute({ getParentRoute: () => rootRoute, path: '/panel', component: PanelLayout });
  const indexRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/', component: DashboardPanel });
  const productsRoute = createRoute({ getParentRoute: () => layoutRoute, path: 'products', component: PanelProductsRoute });
  const coursesRoute = createRoute({ getParentRoute: () => layoutRoute, path: 'courses', component: PanelCoursesRoute });
  const lessonsRoute = createRoute({ getParentRoute: () => layoutRoute, path: 'lessons', component: PanelLessonsRoute });
  const membersRoute = createRoute({ getParentRoute: () => layoutRoute, path: 'members', component: PanelMembersRoute });
  const salesRoute = createRoute({ getParentRoute: () => layoutRoute, path: 'sales', component: PanelSalesRoute });
  const integrationsRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: 'integrations',
    component: PanelIntegrationsRoute,
  });
  const settingsRoute = createRoute({ getParentRoute: () => layoutRoute, path: 'settings', component: PanelSettingsRoute });
  const marketingRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: 'marketing/campaigns',
    component: MarketingTestRoute,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      layoutRoute.addChildren([
        indexRoute,
        productsRoute,
        coursesRoute,
        lessonsRoute,
        membersRoute,
        salesRoute,
        integrationsRoute,
        settingsRoute,
        marketingRoute,
      ]),
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  await router.load();
  const navigateSpy = preventNavigation ? vi.spyOn(router, 'navigate').mockResolvedValue() : null;
  return {
    router,
    navigateSpy,
    ...renderWithProviders(
      <ThemeModeProvider>
        <RouterProvider router={router} />
      </ThemeModeProvider>,
    ),
  };
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Creator panel routing', () => {
  it('renders only the branded splash while the session is pending', async () => {
    server.use(
      http.get('/api/me', async () => {
        await delay('infinite');
        return HttpResponse.json({ ok: true, data: meWithTenant });
      }),
    );

    await renderPanelAt('/panel');

    expect(await screen.findByRole('status', { name: pl.bootSplash.opening })).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-tiles')).not.toBeInTheDocument();
  });

  it('keeps the branded splash visible while redirecting an unauthorized visitor', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'unauthorized', message: 'sign in' } },
          { status: 401 },
        ),
      ),
    );

    const { navigateSpy } = await renderPanelAt('/panel', { preventNavigation: true });

    expect(await screen.findByRole('status', { name: pl.bootSplash.opening })).toBeInTheDocument();
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/login' }));
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it.each([
    [
      'tenant-less visitor',
      { ...meWithTenant, tenant: null },
      '/',
    ],
    [
      'member-only visitor',
      { ...meWithTenant, tenant: { ...meWithTenant.tenant, staffRole: null } },
      '/my',
    ],
  ])('keeps the branded splash visible while redirecting a %s', async (_label, me, destination) => {
    server.use(http.get('/api/me', () => HttpResponse.json({ ok: true, data: me })));

    const { navigateSpy } = await renderPanelAt('/panel', { preventNavigation: true });

    expect(await screen.findByRole('status', { name: pl.bootSplash.opening })).toBeInTheDocument();
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: destination }));
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders every group as an accessible toggle with the intended defaults', async () => {
    stubViewport(true);
    commonHandlers();

    await renderPanelAt('/panel/members');

    expect(await screen.findByTestId('tenant-name')).toHaveTextContent('Acme');
    expect(screen.getByTestId('panel-brand-lockup')).toHaveAttribute(
      'src',
      '/brand/together-horizontal-dark.svg',
    );
    const sidebar = screen.getByTestId('panel-brand-lockup').closest('aside');
    if (sidebar === null) throw new Error('Panel lockup must render inside the sidebar');
    expect(within(sidebar).getByTestId('tenant-name')).toBeInTheDocument();
    const banner = screen.getByTestId('color-scheme-switcher').closest('header');
    if (banner === null) throw new Error('The switchers must render inside the app bar');
    expect(banner).not.toHaveTextContent('Acme');
    expect(within(banner).getByTestId('color-scheme-switcher')).toBeInTheDocument();
    expect(within(banner).getByTestId('language-switcher')).toBeInTheDocument();
    expect(within(screen.getByRole('contentinfo')).queryByTestId('color-scheme-switcher')).toBeNull();
    const alwaysVisibleSectionIds = [
      'dashboard',
      'courses',
      'lessons',
      'products',
      'coupons',
      'members',
      'spaces',
      'reports',
      'sales',
      'integrations',
      'settings',
    ] as const;
    const marketingSectionIds = [
      'marketingCampaigns',
      'marketingActivity',
      'marketingSends',
      'marketingLayouts',
      'marketingConsents',
      'marketingDocuments',
    ] as const;
    for (const id of alwaysVisibleSectionIds) {
      expect(screen.getByTestId(`section-${id}`)).toBeInTheDocument();
    }
    for (const [id, label] of Object.entries(pl.navigationGroups)) {
      const group = screen.getByTestId(`group-${id}`);
      expect(group.querySelector('.MuiTypography-overline')).toHaveTextContent(label);
      expect(group).toHaveAttribute('aria-controls', `panel-navigation-${id}`);
      expect(group).toHaveAttribute('tabindex', '0');
      expect(group.querySelector('svg')).toBeInTheDocument();
    }
    expect(screen.queryByTestId('group-configuration')).toBeNull();
    expect(screen.getByTestId('group-content')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('group-offer')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('group-community')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('group-sales')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('group-marketing')).toHaveAttribute('aria-expanded', 'false');
    for (const id of marketingSectionIds) {
      expect(screen.queryByTestId(`section-${id}`)).not.toBeInTheDocument();
    }

    await userEvent.click(screen.getByTestId('group-marketing'));

    expect(screen.getByTestId('group-marketing')).toHaveAttribute('aria-expanded', 'true');
    for (const id of marketingSectionIds) {
      expect(screen.getByTestId(`section-${id}`)).toBeInTheDocument();
    }
    const sectionIds = [...alwaysVisibleSectionIds, ...marketingSectionIds];
    const iconPaths = sectionIds.map((id) =>
      screen.getByTestId(`section-${id}`).querySelector('path')?.getAttribute('d'),
    );
    expect(new Set(iconPaths).size).toBe(sectionIds.length);
    expect(screen.getByTestId('section-members')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('section-products')).not.toHaveAttribute('aria-current');
    expect(await screen.findByTestId('reports-open-count')).toHaveTextContent('3');
    expect(screen.getByRole('heading', { name: pl.members.heading, level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('build-stamp')).toBeInTheDocument();
  });

  it('keeps the two configuration entries ungrouped at the bottom', async () => {
    stubViewport(true);
    commonHandlers();

    await renderPanelAt('/panel/members');
    await screen.findByTestId('tenant-name');

    await userEvent.click(screen.getByTestId('group-sales'));

    expect(screen.queryByTestId('section-sales')).not.toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: pl.sections.aria });
    const entries = [...navigation.querySelectorAll('[data-testid^="section-"]')].map((entry) =>
      entry.getAttribute('data-testid'));
    expect(entries.slice(-2)).toEqual(['section-integrations', 'section-settings']);
  });

  it('persists each group preference across panel mounts', async () => {
    stubViewport(true);
    commonHandlers();

    const firstRender = await renderPanelAt('/panel/products');
    await screen.findByTestId('tenant-name');

    await userEvent.click(screen.getByTestId('group-content'));

    expect(screen.getByTestId('group-content')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('section-courses')).not.toBeInTheDocument();
    firstRender.unmount();

    await renderPanelAt('/panel/products');

    expect(await screen.findByTestId('group-content')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('section-courses')).not.toBeInTheDocument();
    expect(screen.getByTestId('group-offer')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('group-marketing')).toHaveAttribute('aria-expanded', 'false');
  });

  it('temporarily expands the active group without changing its stored preference', async () => {
    stubViewport(true);
    commonHandlers();

    const { router } = await renderPanelAt('/panel/products');
    expect(await screen.findByTestId('group-marketing')).toHaveAttribute('aria-expanded', 'false');

    await router.navigate({ to: '/panel/marketing/campaigns' });

    expect(await screen.findByTestId('marketing-route')).toBeInTheDocument();
    expect(screen.getByTestId('group-marketing')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('section-marketingCampaigns')).toHaveAttribute('aria-current', 'page');

    await router.navigate({ to: '/panel/products' });

    await waitFor(() => {
      expect(screen.getByTestId('group-marketing')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('section-marketingCampaigns')).not.toBeInTheDocument();
    });
  });

  it('uses the same collapsible group controls in the mobile drawer', async () => {
    stubViewport(false);
    commonHandlers();

    await renderPanelAt('/panel/products');
    await userEvent.click(await screen.findByTestId('open-navigation'));

    for (const id of Object.keys(pl.navigationGroups)) {
      expect(screen.getByTestId(`group-${id}`)).toHaveAttribute(
        'aria-controls',
        `panel-navigation-${id}`,
      );
    }

    await userEvent.click(screen.getByTestId('group-content'));

    expect(screen.getByTestId('group-content')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('section-courses')).not.toBeInTheDocument();
  });

  it('names the tenant in the mobile topbar and repeats the brand block in the drawer', async () => {
    stubViewport(false);
    commonHandlers();

    await renderPanelAt('/panel/products');
    await screen.findByTestId('open-navigation');

    const topbar = screen.getByTestId('open-navigation').closest('header');
    if (topbar === null) throw new Error('The menu button must render inside the app bar');
    expect(topbar).toHaveTextContent('Acme');
    expect(screen.queryByTestId('panel-brand-lockup')).toBeNull();

    await userEvent.click(screen.getByTestId('open-navigation'));

    expect(screen.getByTestId('tenant-name')).toHaveTextContent('Acme');
    expect(screen.getByTestId('panel-brand-lockup')).toBeInTheDocument();
  });

  it('shows the dashboard overview at /panel index', async () => {
    stubViewport(true);
    commonHandlers();

    const { router } = await renderPanelAt('/panel');

    expect(await screen.findByTestId('dashboard-tiles')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/panel');
    expect(screen.getByRole('heading', { name: pl.dashboard.heading, level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('section-dashboard')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('section-products')).not.toHaveAttribute('aria-current');
  });

  it('navigates between sections when a sidebar link is clicked', async () => {
    stubViewport(true);
    commonHandlers();

    const { router } = await renderPanelAt('/panel/products');

    await userEvent.click(await screen.findByTestId('section-courses'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/panel/courses'));
    expect(screen.getByTestId('section-courses')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: pl.courses.heading, level: 1 })).toBeInTheDocument();
  });

  it('shows the sales ledger empty state and keeps the navigation active', async () => {
    stubViewport(true);
    commonHandlers();

    await renderPanelAt('/panel/sales');

    expect(await screen.findByText(pl.sales.empty, {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.getByTestId('section-sales')).toHaveAttribute('aria-current', 'page');
  });

  it('signs out from the account menu in the app bar', async () => {
    stubViewport(true);
    commonHandlers();

    await renderPanelAt('/panel/products');

    await userEvent.click(await screen.findByTestId('user-menu'));
    expect(await screen.findByTestId('user-menu-email')).toHaveTextContent('creator@together.dev');
    expect(screen.getByText(pl.tenant.roleOwner)).toHaveClass('MuiChip-label');
    expect(screen.getByTestId('sign-out')).toBeInTheDocument();
  });
});
