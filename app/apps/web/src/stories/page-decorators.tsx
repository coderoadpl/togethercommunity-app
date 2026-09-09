import { useEffect, useState } from 'react';
import type { Decorator } from '@storybook/react-vite';
import { CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { z } from 'zod';
import { MEMBER_ROUTE_PATHS } from '#core/contract/index.js';
import { RegisterRoute } from '../routes/register.js';
import { LoginRoute } from '../routes/login.js';
import { ForgotPasswordRoute } from '../routes/forgot-password.js';
import { ResetPasswordRoute } from '../routes/reset-password.js';
import { CheckoutRoute } from '../routes/checkout.js';
import { HomeRoute } from '../routes/home.js';
import { CommunityRoute, CourseRoute, CourseStructureRoute, LessonPlayerRoute, MemberAccountRoute, MemberShellRoute, MyCoursesRoute, MyProductsRoute, SearchRoute, SpaceFeedRoute, StartRoute, validateAccountSearch, validateLessonSearch } from '../routes/member.js';
import { TenantBrandingBoundary } from '../branding.js';
import { ToastProvider } from '../components/ui/Toast.js';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher.js';
import { TenantGate } from '../features/tenant-not-found/TenantNotFoundPage.js';
import { AppChromeProvider } from '../components/ui/app-chrome.js';
import { LanguageProvider } from '../i18n/index.js';
import { NotificationsTransportProvider } from '../notifications-transport.js';
import { colorSchemePreference, languagePreference, ThemeModeProvider } from '../theme-mode.js';
import { fixtureCalls, fixtureErrors, fixtureExpectationErrors, fixturePendingCalls, fixtureQueriesReady, selectFixture } from './fixture-client.js';
import { installStoryClock } from '../../../../scripts/story-clock.js';
import { fixtureSchema } from './fixture-key.js';

import { PanelLayout } from '../features/home/PanelLayout.js';
import { DashboardPanel } from '../features/home/DashboardPanel.js';
import { usePanelContext } from '../features/home/panel-context.js';
import { StudioChecklistDock, StudioChecklistPanel } from '../features/onboarding/index.js';
import { PanelMemberDetailRoute, PanelCouponCreateRoute, PanelCouponDetailRoute, PanelCouponsRoute, PanelCourseDetailRoute, PanelIntegrationsRoute, PanelLessonEditRoute, PanelOrderDetailRoute, PanelProductDetailRoute, PanelProductsRoute, PanelRedirectsRoute, PanelSettingsRoute, PanelSpacesRoute } from '../features/home/panel-routes.js';
import { CampaignsPanel, CampaignCreatePage, CampaignDetailPage } from '../features/home/marketing/CampaignsPanel.js';
import { ConsentsPanel } from '../features/home/marketing/ConsentsPanel.js';
import { DocumentsPanel } from '../features/home/marketing/DocumentsPanel.js';
import { LayoutsPanel } from '../features/home/marketing/LayoutsPanel.js';
import { SchedulerActivityPanel, SchedulerActivityDetailPage } from '../features/home/marketing/SchedulerActivityPanel.js';
import { SendsPanel, SendDetailPage, validateSendsSearch } from '../features/home/marketing/SendsPanel.js';
import { ContactsPanel, ContactDetailPanel, ContactImportWizard, validateContactImportSearch, ListsPanel, ListCreatePanel, ListDetailPanel } from '../routes/panel.js';

const PageRoot = () => <><LanguageSwitcher /><Outlet /></>;

const PanelDashboard = () => { const { tenant, email } = usePanelContext(); return <><DashboardPanel aside={<StudioChecklistPanel scope={`${tenant.id}:${email}`} />} /><StudioChecklistDock scope={`${tenant.id}:${email}`} /></>; };

const pageParameters = z.object({ fixture: fixtureSchema, locale: z.enum(['pl', 'en']).default('en'), colorScheme: z.enum(['light', 'dark', 'auto']).default('auto'), preloadFonts: z.boolean().optional() });
const PageStory = ({ parameters }: { parameters: z.infer<typeof pageParameters> }) => {
  const [state] = useState(() => {
    const fixture = selectFixture(parameters.fixture);
    const location = new URL(window.location.href);
    const routeLocation = new URL(fixture.route, location.origin);
    for (const key of ['token', 'error', 'status', 'purchase_kind', 'code']) {
      location.searchParams.delete(key);
      const value = routeLocation.searchParams.get(key);
      if (value !== null) location.searchParams.set(key, value);
    }
    window.history.replaceState(null, '', location);
    languagePreference.save(parameters.locale);
    colorSchemePreference.save(parameters.colorScheme);
    Object.defineProperty(window, 'EventSource', { configurable: true, value: undefined });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false }, mutations: { retry: false } } });
    const root = createRootRoute({ component: PageRoot });
    const home = createRoute({ getParentRoute: () => root, path: '/', component: HomeRoute });
    const publicRoutes = [
      createRoute({ getParentRoute: () => root, path: '/register', component: RegisterRoute }),
      createRoute({ getParentRoute: () => root, path: '/login', component: LoginRoute }),
      createRoute({ getParentRoute: () => root, path: '/forgot-password', component: ForgotPasswordRoute }),
      createRoute({ getParentRoute: () => root, path: '/reset-password', component: ResetPasswordRoute }),
      createRoute({ getParentRoute: () => root, path: '/checkout/$productRef', component: CheckoutRoute }),
    ];
    const shell = createRoute({ getParentRoute: () => root, id: 'member-shell', component: MemberShellRoute });
    const memberRoutes = [
      createRoute({ getParentRoute: () => shell, path: '/start', component: StartRoute }),
      createRoute({
        getParentRoute: () => shell,
        path: MEMBER_ROUTE_PATHS.lesson,
        validateSearch: validateLessonSearch,
        component: LessonPlayerRoute,
      }),
      createRoute({ getParentRoute: () => shell, path: MEMBER_ROUTE_PATHS.communitySpace, component: SpaceFeedRoute }),
      createRoute({ getParentRoute: () => shell, path: '/account', validateSearch: validateAccountSearch, component: MemberAccountRoute }),
      createRoute({ getParentRoute: () => shell, path: '/community', component: CommunityRoute }),
      createRoute({ getParentRoute: () => shell, path: MEMBER_ROUTE_PATHS.course, component: CourseStructureRoute }),
      createRoute({ getParentRoute: () => shell, path: MEMBER_ROUTE_PATHS.courseList, component: MyCoursesRoute }),
      createRoute({ getParentRoute: () => shell, path: '/my/products', component: MyProductsRoute }),
      createRoute({ getParentRoute: () => shell, path: '/my/course/$productId', component: CourseRoute }),
      createRoute({ getParentRoute: () => shell, path: '/search', component: SearchRoute }),
    ];
    const panel = createRoute({ getParentRoute: () => root, path: '/panel', component: PanelLayout });
    const panelRoutes = [
      createRoute({ getParentRoute: () => panel, path: 'members/$memberId', component: PanelMemberDetailRoute }),
      createRoute({ getParentRoute: () => panel, path: '/', component: PanelDashboard }),
      createRoute({ getParentRoute: () => panel, path: 'spaces', component: PanelSpacesRoute }),
      createRoute({ getParentRoute: () => panel, path: 'products', component: PanelProductsRoute }),
      createRoute({ getParentRoute: () => panel, path: 'products/$productId', component: PanelProductDetailRoute }),
      createRoute({ getParentRoute: () => panel, path: 'courses/$courseId', component: PanelCourseDetailRoute }),
      createRoute({ getParentRoute: () => panel, path: 'lessons/$lessonId', component: PanelLessonEditRoute }),
      createRoute({ getParentRoute: () => panel, path: 'sales/coupons', component: PanelCouponsRoute }),
      createRoute({ getParentRoute: () => panel, path: 'sales/coupons/new', component: PanelCouponCreateRoute }),
      createRoute({ getParentRoute: () => panel, path: 'sales/coupons/$couponId', component: PanelCouponDetailRoute }),
      createRoute({ getParentRoute: () => panel, path: 'sales/$orderId', component: PanelOrderDetailRoute }),
      createRoute({ getParentRoute: () => panel, path: 'settings/redirects', component: PanelRedirectsRoute }),
      createRoute({ getParentRoute: () => panel, path: 'settings', component: PanelSettingsRoute }),
      createRoute({ getParentRoute: () => panel, path: 'integrations', component: PanelIntegrationsRoute }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/contacts', component: ContactsPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/contacts/import', component: ContactImportWizard, validateSearch: validateContactImportSearch }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/contacts/$contactId', component: ContactDetailPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/lists', component: ListsPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/lists/new', component: ListCreatePanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/lists/$listId', component: ListDetailPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/campaigns', component: CampaignsPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/campaigns/new', component: CampaignCreatePage }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/campaigns/$campaignId', component: CampaignDetailPage }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/activity', component: SchedulerActivityPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/activity/$runId', component: SchedulerActivityDetailPage }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/sends', component: SendsPanel, validateSearch: validateSendsSearch }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/sends/$kind/$sendId', component: SendDetailPage }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/consents', component: ConsentsPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/documents', component: DocumentsPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/layouts', component: LayoutsPanel }),
    ];
    const router = createRouter({
      routeTree: root.addChildren([home, ...publicRoutes, panel.addChildren(panelRoutes), shell.addChildren(memberRoutes)]),
      history: createMemoryHistory({ initialEntries: [fixture.route] }),
      defaultPendingMs: 0,
    });
    return { queryClient, router };
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      document.documentElement.dataset['fixtureCalls'] = JSON.stringify([...fixtureCalls]);
      document.documentElement.dataset['fixtureErrors'] = JSON.stringify([...fixtureErrors, ...fixtureExpectationErrors()]);
      document.documentElement.dataset['fixturePending'] = JSON.stringify([...fixturePendingCalls]);
      const fetchingKeys = state.queryClient.getQueryCache().findAll({ fetchStatus: 'fetching' }).map((query) => query.queryKey);
      document.documentElement.dataset['fixtureFetching'] = JSON.stringify(fetchingKeys);
      document.documentElement.dataset['fixtureReady'] = String(fixtureQueriesReady(fetchingKeys) && state.queryClient.isMutating() === 0);
    }, 50);
    return () => window.clearInterval(timer);
  }, [state]);
  return (
    <QueryClientProvider client={state.queryClient}>
      <ThemeModeProvider>
        <LanguageProvider><ToastProvider><AppChromeProvider>
          <CssBaseline />
          <NotificationsTransportProvider><TenantBrandingBoundary>
          <TenantGate><RouterProvider router={state.router} /></TenantGate>
        </TenantBrandingBoundary></NotificationsTransportProvider></AppChromeProvider></ToastProvider></LanguageProvider>
      </ThemeModeProvider>
    </QueryClientProvider>
  );
};
const ClockBoundary = ({ parameters }: { parameters: z.infer<typeof pageParameters> }) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const restore = installStoryClock();
    let disposed = false;
    if (parameters.preloadFonts ?? parameters.fixture.route.startsWith('/panel')) {
      void Promise.all([...document.fonts]
        .filter((font) => font.family.includes('Inter') || font.family.includes('Poppins'))
        .map((font) => font.load())).then(() => {
        if (!disposed) setReady(true);
      });
    } else setReady(true);
    return () => { disposed = true; restore(); };
  }, [parameters.fixture.route, parameters.preloadFonts]);
  return ready ? <PageStory parameters={parameters} /> : null;
};
export const withPage: Decorator = (_Story, context) => <ClockBoundary key={context.id} parameters={pageParameters.parse(context.parameters)} />;
