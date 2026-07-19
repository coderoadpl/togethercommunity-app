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

import { TenantBrandingBoundary } from './branding.js';
import { AppChromeProvider } from './components/ui/app-chrome.js';
import { ErrorBoundary } from './components/ui/ErrorBoundary.js';
import { LanguageSwitcher } from './components/ui/LanguageSwitcher.js';
import { ThemeSwitcher } from './components/ui/ThemeSwitcher.js';
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
  PanelProductsRoute,
  PanelProductCreateRoute,
  PanelProductDetailRoute,
  PanelSalesRoute,
  PanelSettingsRoute,
} from './routes/panel.js';
import {
  CourseRoute,
  CourseStructureRoute,
  LessonPlayerRoute,
  MemberAccountRoute,
  MyCoursesRoute,
  MyProductsRoute,
} from './routes/member.js';
import { RegisterRoute } from './routes/register.js';
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
      <ThemeSwitcher />
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
  path: '/my/courses/$courseId/lessons/$lessonId',
  component: LessonPlayerRoute,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterRoute,
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
const panelMemberDetailRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'members/$memberId',
  component: PanelMemberDetailRoute,
});
const panelSalesRoute = createRoute({
  getParentRoute: () => panelLayoutRoute,
  path: 'sales',
  component: PanelSalesRoute,
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
    resetPasswordRoute,
    accountRoute,
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
      panelMemberDetailRoute,
      panelSalesRoute,
      panelIntegrationsRoute,
      panelSettingsRoute,
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
