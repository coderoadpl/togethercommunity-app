import { useEffect, useState } from 'react';
import type { Decorator } from '@storybook/react-vite';
import { CssBaseline, GlobalStyles } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useParams } from '@tanstack/react-router';
import { z } from 'zod';
import { TenantBrandingBoundary } from '../branding.js';
import { AppChromeProvider } from '../components/ui/app-chrome.js';
import { LanguageProvider } from '../i18n/index.js';
import { NotificationsTransportProvider } from '../notifications-transport.js';
import { colorSchemePreference, languagePreference, ThemeModeProvider } from '../theme-mode.js';
import { LessonPlayerPage } from '../features/member/LessonPlayerPage.js';
import { StartPage } from '../features/member/StartPage.js';
import { SpaceFeedPage } from '../features/member/SpaceFeedPage.js';
import { MemberShell } from '../features/member/shell/MemberShell.js';
import { fixtureCalls, fixtureErrors, selectFixture } from './fixture-client.js';
import { installStoryClock } from '../../../../scripts/story-clock.js';
import { fixtureSchema } from './fixture-key.js';

import { MemberAccountPage } from '../features/member/MemberAccountPage.js';
import { SpacesListPage } from '../features/member/SpacesListPage.js';
import { CourseStructurePage } from '../features/member/CourseStructurePage.js';
import { MyCoursesPage } from '../features/member/MyCoursesPage.js';
import { MyProductsPage } from '../features/member/MyProductsPage.js';
import { CoursePage } from '../features/member/CoursePage.js';
import { SearchPage } from '../features/member/SearchPage.js';

import { AnonHomePage } from '../features/member/AnonHomePage.js';

const pageParameters = z.object({ fixture: fixtureSchema, locale: z.enum(['pl', 'en']).default('pl') });
const LessonRoute = () => {
  const { courseId, lessonId } = useParams({ strict: false });
  return <LessonPlayerPage courseId={courseId ?? ''} lessonId={lessonId ?? ''} />;
};
const CourseRoute = () => <CourseStructurePage courseId={useParams({ strict: false }).courseId ?? ''} />;
const ProductRoute = () => <CoursePage productId={useParams({ strict: false }).productId ?? ''} />;
const FeedRoute = () => {
  const { spaceId } = useParams({ strict: false });
  return <SpaceFeedPage spaceId={spaceId ?? ''} />;
};
const PageStory = ({ parameters }: { parameters: z.infer<typeof pageParameters> }) => {
  const [state] = useState(() => {
    const fixture = selectFixture(parameters.fixture);
    languagePreference.save(parameters.locale);
    colorSchemePreference.save('auto');
    Object.defineProperty(window, 'EventSource', { configurable: true, value: undefined });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false }, mutations: { retry: false } } });
    const root = createRootRoute({ component: Outlet });
    const shell = createRoute({ getParentRoute: () => root, id: 'member', component: MemberShell });
    const start = createRoute({ getParentRoute: () => shell, path: '/start', component: StartPage });
    const lesson = createRoute({ getParentRoute: () => shell, path: '/my/courses/$courseId/lessons/$lessonId', component: LessonRoute });
    const feed = createRoute({ getParentRoute: () => shell, path: '/community/$spaceId', component: FeedRoute });
    const router = createRouter({ routeTree: root.addChildren([shell.addChildren([start, lesson, feed, createRoute({ getParentRoute: () => shell, path: '/', component: AnonHomePage }),
      createRoute({ getParentRoute: () => shell, path: '/account', component: MemberAccountPage }),      createRoute({ getParentRoute: () => shell, path: '/community', component: SpacesListPage }),      createRoute({ getParentRoute: () => shell, path: '/my/courses/$courseId', component: CourseRoute }),      createRoute({ getParentRoute: () => shell, path: '/my', component: MyCoursesPage }),      createRoute({ getParentRoute: () => shell, path: '/my/products', component: MyProductsPage }),      createRoute({ getParentRoute: () => shell, path: '/my/course/$productId', component: ProductRoute }),      createRoute({ getParentRoute: () => shell, path: '/search', component: SearchPage })])]), history: createMemoryHistory({ initialEntries: [fixture.route] }), defaultPendingMs: 0 });
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
