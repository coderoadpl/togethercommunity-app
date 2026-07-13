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

import { ErrorBoundary } from './components/ui/ErrorBoundary.js';
import { LanguageSwitcher } from './components/ui/LanguageSwitcher.js';
import { ThemeSwitcher } from './components/ui/ThemeSwitcher.js';
import { LanguageProvider } from './i18n/index.js';
import { initWebObservability, reportError } from './observability.js';
import { queryClient } from './query-client.js';
import { RefreshSnackbar } from './RefreshSnackbar.js';
import { renderRootErrorFallback } from './RootErrorFallback.js';
import { CheckoutRoute } from './routes/checkout.js';
import { HomeRoute } from './routes/home.js';
import { LoginRoute } from './routes/login.js';
import {
  CourseRoute,
  CourseStructureRoute,
  LessonPlayerRoute,
  MyCoursesRoute,
  MyProductsRoute,
} from './routes/member.js';
import { RegisterRoute } from './routes/register.js';
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
        <CssBaseline />
        <ErrorBoundary fallback={renderRootErrorFallback} onError={reportError}>
          <QueryClientProvider client={queryClient}>
            <RefreshSnackbar />
            <RouterProvider router={router} />
            {import.meta.env.DEV ? (
              <Suspense fallback={null}>
                <ReactQueryDevtools />
              </Suspense>
            ) : null}
          </QueryClientProvider>
        </ErrorBoundary>
      </LanguageProvider>
    </ThemeModeProvider>
  </StrictMode>,
);
