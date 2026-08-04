import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-500.css';
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/fraunces/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-500.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/inter/latin-ext-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-ext-400.css';
import '@fontsource/manrope/latin-ext-500.css';
import '@fontsource/manrope/latin-ext-600.css';
import '@fontsource/manrope/latin-ext-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';

import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { MEMBER_ROUTE_PATHS } from '#core/contract/index.js';

import { TenantBrandingBoundary } from './branding.js';
import { AppChromeProvider } from './components/ui/app-chrome.js';
import { ErrorBoundary } from './components/ui/ErrorBoundary.js';
import { LanguageSwitcher } from './components/ui/LanguageSwitcher.js';
import { LanguageProvider } from './i18n/index.js';
import { initWebObservability, reportError } from './observability.js';
import { queryClient } from './query-client.js';
import { RefreshSnackbar } from './RefreshSnackbar.js';
import { renderRootErrorFallback } from './RootErrorFallback.js';
import { TenantGate } from './features/tenant-not-found/TenantNotFoundPage.js';
import { CheckoutRoute } from './routes/checkout.js';
import { HomeRoute } from './routes/home.js';
import { LoginRoute } from './routes/login.js';
import {
  CampaignCreatePage,
  CampaignDetailPage,
  CampaignsPanel,
  ConsentCreatePage,
  ConsentDetailPage,
  ConsentsPanel,
  DocumentCreatePage,
  DocumentDetailPage,
  DocumentsPanel,
  LayoutCreatePage,
  LayoutDetailPage,
  LayoutsPanel,
  MarketingSettingsPanel,
  SchedulerActivityDetailPage,
  SchedulerActivityPanel,
  SendDetailPage,
  SendsPanel,
  validateSendsSearch,
  PanelCourseDetailRoute,
  PanelCourseCreateRoute,
  PanelModuleCreateRoute,
  PanelCoursesRoute,
  PanelIndexRoute,
  PanelIntegrationsRoute,
  PanelLayout,
  PanelLessonsRoute,
  PanelLessonCreateRoute,
  PanelLessonEditRoute,
  PanelMemberDetailRoute,
  PanelMembersRoute,
  PanelReportsRoute,
  PanelProductsRoute,
  PanelProductCreateRoute,
  PanelProductDetailRoute,
  PanelSalesRoute,
  PanelOrderDetailRoute,
  PanelCouponsRoute,
  PanelCouponCreateRoute,
  PanelCouponDetailRoute,
  PanelSettingsRoute,
  PanelSpacesRoute,
  PanelSpaceCreateRoute,
  PanelSpaceDetailRoute,
} from './routes/panel.js';
import {
  CommunityRoute,
  CourseRoute,
  CourseStructureRoute,
  LessonPlayerRoute,
  MemberAccountRoute,
  MyCoursesRoute,
  MyProductsRoute,
  SpaceFeedRoute,
  SpaceThreadRoute,
} from './routes/member.js';
import { RegisterRoute } from './routes/register.js';
import { ForgotPasswordRoute } from './routes/forgot-password.js';
import { ResetPasswordRoute } from './routes/reset-password.js';
import { ThemeModeProvider } from './theme-mode.js';

/** Dev-only, lazy so the devtools chunk never reaches the production bundle. */
const ReactQueryDevtools = lazy(() =>
  import('@tanstack/react-query-devtools').then((module) => ({
    default: module.ReactQueryDevtools,
  })),
);

const rootRoute = createRootRoute({
  component: () => (
    <>
      <LanguageSwitcher />
      <Outlet />
    </>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginRoute,
});
const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/checkout/$productId',
  component: CheckoutRoute,
});
const myCoursesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/my',
  component: MyCoursesRoute,
});
const myProductsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/my/products',
  component: MyProductsRoute,
});
const courseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/my/course/$productId',
  component: CourseRoute,
});
const courseStructureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/my/courses/$courseId',
  component: CourseStructureRoute,
});
const lessonPlayerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: MEMBER_ROUTE_PATHS.lesson,
  component: LessonPlayerRoute,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterRoute,
});
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordRoute,
});
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordRoute,
});
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: MemberAccountRoute,
});
const communityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/community',
  component: CommunityRoute,
});
const spaceFeedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: MEMBER_ROUTE_PATHS.communitySpace,
  component: SpaceFeedRoute,
});
const spaceThreadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: MEMBER_ROUTE_PATHS.communityPost,
  component: SpaceThreadRoute,
});

const panelLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/panel',
  component: PanelLayout,
});
const panelIndexRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: '/',
  component: PanelIndexRoute,
});
const panelProductsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'products',
  component: PanelProductsRoute,
});
const panelProductCreateRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'products/new',
  component: PanelProductCreateRoute,
});
const panelProductDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'products/$productId',
  component: PanelProductDetailRoute,
});
const panelCoursesRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'courses',
  component: PanelCoursesRoute,
});
const panelCourseCreateRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'courses/new',
  component: PanelCourseCreateRoute,
});
const panelModuleCreateRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'courses/$courseId/modules/new',
  component: PanelModuleCreateRoute,
});
const panelCourseDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'courses/$courseId',
  component: PanelCourseDetailRoute,
});
const panelLessonsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'lessons',
  component: PanelLessonsRoute,
});
const panelLessonCreateRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'lessons/new',
  component: PanelLessonCreateRoute,
});
const panelLessonEditRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'lessons/$lessonId',
  component: PanelLessonEditRoute,
});
const panelMembersRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'members',
  component: PanelMembersRoute,
});
const panelReportsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'reports',
  component: PanelReportsRoute,
});
const panelMemberDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'members/$memberId',
  component: PanelMemberDetailRoute,
});
const panelSpacesRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'spaces',
  component: PanelSpacesRoute,
});
const panelSpaceCreateRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'spaces/new',
  component: PanelSpaceCreateRoute,
});
const panelSpaceDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'spaces/$spaceId',
  component: PanelSpaceDetailRoute,
});
const panelSalesRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'sales',
  component: PanelSalesRoute,
});
const panelOrderDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'sales/$orderId',
  component: PanelOrderDetailRoute,
});
const panelCouponsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'sales/coupons',
  component: PanelCouponsRoute,
});
const panelCouponCreateRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'sales/coupons/new',
  component: PanelCouponCreateRoute,
});
const panelCouponDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'sales/coupons/$couponId',
  component: PanelCouponDetailRoute,
});
const panelIntegrationsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'integrations',
  component: PanelIntegrationsRoute,
});
const panelSettingsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'settings',
  component: PanelSettingsRoute,
});
const panelMarketingCampaignsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/campaigns',
  component: CampaignsPanel,
});
const panelMarketingSendsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/sends',
  validateSearch: validateSendsSearch,
  component: SendsPanel,
});
const panelMarketingActivityRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/activity',
  component: SchedulerActivityPanel,
});
const panelMarketingActivityDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/activity/$runId',
  component: SchedulerActivityDetailPage,
});
const panelMarketingSendDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/sends/$kind/$sendId',
  component: SendDetailPage,
});
const panelMarketingCampaignCreateRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/campaigns/new',
  component: CampaignCreatePage,
});
const panelMarketingCampaignDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/campaigns/$campaignId',
  component: CampaignDetailPage,
});
const panelMarketingConsentsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/consents',
  component: ConsentsPanel,
});
const panelMarketingConsentCreateRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/consents/new',
  component: ConsentCreatePage,
});
const panelMarketingConsentDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/consents/$consentId',
  component: ConsentDetailPage,
});
const panelMarketingDocumentsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/documents',
  component: DocumentsPanel,
});
const panelMarketingDocumentCreateRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/documents/new',
  component: DocumentCreatePage,
});
const panelMarketingDocumentDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/documents/$documentId',
  component: DocumentDetailPage,
});
const panelMarketingLayoutsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/layouts',
  component: LayoutsPanel,
});
const panelMarketingLayoutCreateRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/layouts/new',
  component: LayoutCreatePage,
});
const panelMarketingLayoutDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/layouts/$layoutId',
  component: LayoutDetailPage,
});
const panelMarketingSettingsRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'marketing/settings',
  component: MarketingSettingsPanel,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    loginRoute,
    checkoutRoute,
    myCoursesRoute,
    myProductsRoute,
    courseRoute,
    courseStructureRoute,
    lessonPlayerRoute,
    registerRoute,
    forgotPasswordRoute,
    resetPasswordRoute,
    accountRoute,
    communityRoute,
    spaceFeedRoute,
    spaceThreadRoute,
    panelLayoutRoute.addChildren([
      panelIndexRoute,
      panelProductsRoute,
      panelProductCreateRoute,
      panelProductDetailRoute,
      panelCoursesRoute,
      panelCourseCreateRoute,
      panelModuleCreateRoute,
      panelCourseDetailRoute,
      panelLessonsRoute,
      panelLessonCreateRoute,
      panelLessonEditRoute,
      panelMembersRoute,
      panelReportsRoute,
      panelMemberDetailRoute,
      panelSpacesRoute,
      panelSpaceCreateRoute,
      panelSpaceDetailRoute,
      panelSalesRoute,
      panelOrderDetailRoute,
      panelCouponsRoute,
      panelCouponCreateRoute,
      panelCouponDetailRoute,
      panelIntegrationsRoute,
      panelSettingsRoute,
      panelMarketingActivityRoute,
      panelMarketingActivityDetailRoute,
      panelMarketingSendsRoute,
      panelMarketingSendDetailRoute,
      panelMarketingCampaignsRoute,
      panelMarketingCampaignCreateRoute,
      panelMarketingCampaignDetailRoute,
      panelMarketingConsentsRoute,
      panelMarketingConsentCreateRoute,
      panelMarketingConsentDetailRoute,
      panelMarketingDocumentsRoute,
      panelMarketingDocumentCreateRoute,
      panelMarketingDocumentDetailRoute,
      panelMarketingLayoutsRoute,
      panelMarketingLayoutCreateRoute,
      panelMarketingLayoutDetailRoute,
      panelMarketingSettingsRoute,
    ]),
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

initWebObservability();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <ThemeModeProvider>
      <LanguageProvider>
        <AppChromeProvider>
          <CssBaseline />
          <ErrorBoundary fallback={renderRootErrorFallback} onError={reportError}>
            <QueryClientProvider client={queryClient}>
              <RefreshSnackbar />
              <TenantBrandingBoundary>
                <TenantGate>
                  <RouterProvider router={router} />
                </TenantGate>
              </TenantBrandingBoundary>
              {import.meta.env.DEV ? (
                <Suspense fallback={null}>
                  <ReactQueryDevtools />
                </Suspense>
              ) : null}
            </QueryClientProvider>
          </ErrorBoundary>
        </AppChromeProvider>
      </LanguageProvider>
    </ThemeModeProvider>
  </StrictMode>,
);
