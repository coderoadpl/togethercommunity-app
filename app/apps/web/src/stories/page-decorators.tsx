import { useEffect, useState } from 'react';
import type { Decorator } from '@storybook/react-vite';
import { CssBaseline, GlobalStyles } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { z } from 'zod';
import { MEMBER_ROUTE_PATHS } from '#core/contract/index.js';
import { HomeRoute } from '../routes/home.js';
import { CommunityRoute, CourseRoute, CourseStructureRoute, LessonPlayerRoute, MemberAccountRoute, MemberShellRoute, MyCoursesRoute, MyProductsRoute, SearchRoute, SpaceFeedRoute, StartRoute, validateLessonSearch } from '../routes/member.js';
import { TenantBrandingBoundary } from '../branding.js';
import { AppChromeProvider } from '../components/ui/app-chrome.js';
import { LanguageProvider } from '../i18n/index.js';
import { NotificationsTransportProvider } from '../notifications-transport.js';
import { colorSchemePreference, languagePreference, ThemeModeProvider } from '../theme-mode.js';
import { fixtureCalls, fixtureErrors, selectFixture } from './fixture-client.js';
import { installStoryClock } from '../../../../scripts/story-clock.js';
import { fixtureSchema } from './fixture-key.js';

import { PanelLayout } from '../features/home/PanelLayout.js';
import { DashboardPanel } from '../features/home/DashboardPanel.js';
import { usePanelContext } from '../features/home/panel-context.js';
import { StudioChecklistDock } from '../features/onboarding/index.js';
import { PanelMemberDetailRoute, PanelCouponCreateRoute, PanelCouponDetailRoute, PanelCouponsRoute, PanelCourseDetailRoute, PanelIntegrationsRoute, PanelLessonEditRoute, PanelOrderDetailRoute, PanelProductDetailRoute, PanelProductsRoute, PanelRedirectsRoute, PanelSettingsRoute, PanelSpacesRoute } from '../features/home/panel-routes.js';
import { CampaignsPanel } from '../features/home/marketing/CampaignsPanel.js';
import { ConsentsPanel } from '../features/home/marketing/ConsentsPanel.js';
import { DocumentsPanel } from '../features/home/marketing/DocumentsPanel.js';
import { LayoutsPanel } from '../features/home/marketing/LayoutsPanel.js';
import { SchedulerActivityPanel, SchedulerActivityDetailPage } from '../features/home/marketing/SchedulerActivityPanel.js';
import { SendsPanel, SendDetailPage, validateSendsSearch } from '../features/home/marketing/SendsPanel.js';

const PanelDashboard = () => { const { tenant, email } = usePanelContext(); return <><DashboardPanel /><StudioChecklistDock scope={`${tenant.id}:${email}`} /></>; };

const pageParameters = z.object({ fixture: fixtureSchema, locale: z.enum(['pl', 'en']).default('pl') });
const PageStory = ({ parameters }: { parameters: z.infer<typeof pageParameters> }) => {
  const [state] = useState(() => {
    const fixture = selectFixture(parameters.fixture);
    languagePreference.save(parameters.locale);
    colorSchemePreference.save('auto');
    Object.defineProperty(window, 'EventSource', { configurable: true, value: undefined });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false }, mutations: { retry: false } } });
    const root = createRootRoute({ component: Outlet });
    const home = createRoute({ getParentRoute: () => root, path: '/', component: HomeRoute });
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
      createRoute({ getParentRoute: () => shell, path: '/account', component: MemberAccountRoute }),
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
      createRoute({ getParentRoute: () => panel, path: 'marketing/campaigns', component: CampaignsPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/activity', component: SchedulerActivityPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/activity/$runId', component: SchedulerActivityDetailPage }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/sends', component: SendsPanel, validateSearch: validateSendsSearch }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/sends/$kind/$sendId', component: SendDetailPage }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/consents', component: ConsentsPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/documents', component: DocumentsPanel }),
      createRoute({ getParentRoute: () => panel, path: 'marketing/layouts', component: LayoutsPanel }),
    ];
    const router = createRouter({
      routeTree: root.addChildren([home, panel.addChildren(panelRoutes), shell.addChildren(memberRoutes)]),
      history: createMemoryHistory({ initialEntries: [fixture.route] }),
      defaultPendingMs: 0,
    });
    return { queryClient, router };
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      document.documentElement.dataset['fixtureCalls'] = JSON.stringify([...fixtureCalls]);
      document.documentElement.dataset['fixtureErrors'] = JSON.stringify([...fixtureErrors]);
      document.documentElement.dataset['fixtureReady'] = String(state.queryClient.isFetching() === 0 && state.queryClient.isMutating() === 0);
    }, 50);
    return () => window.clearInterval(timer);
  }, [state]);
  return (
    <QueryClientProvider client={state.queryClient}>
      <ThemeModeProvider>
        <LanguageProvider><AppChromeProvider><NotificationsTransportProvider><TenantBrandingBoundary>
          <CssBaseline />
          <GlobalStyles styles={{ '*, *::before, *::after': { animation: 'none !important', transition: 'none !important', caretColor: 'transparent !important' } }} />
          <RouterProvider router={state.router} />
        </TenantBrandingBoundary></NotificationsTransportProvider></AppChromeProvider></LanguageProvider>
      </ThemeModeProvider>
    </QueryClientProvider>
  );
};
const ClockBoundary = ({ parameters }: { parameters: z.infer<typeof pageParameters> }) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const restore = installStoryClock();
    setReady(true);
    return restore;
  }, []);
  return ready ? <PageStory parameters={parameters} /> : null;
};
export const withPage: Decorator = (_Story, context) => <ClockBoundary key={context.id} parameters={pageParameters.parse(context.parameters)} />;
