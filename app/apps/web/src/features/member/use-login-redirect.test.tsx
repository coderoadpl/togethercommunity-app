import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { useRedirectToLogin } from './use-login-redirect.js';

const RedirectProbe = () => {
  const redirectToLogin = useRedirectToLogin();
  return <button type="button" onClick={() => void redirectToLogin()}>Redirect</button>;
};

const renderRedirectProbe = async (initialEntry: string) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const lessonRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/my/courses/$courseId/lessons/$lessonId',
    component: RedirectProbe,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: RedirectProbe,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([lessonRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return {
    ...renderWithProviders(
      <ThemeModeProvider>
        <RouterProvider router={router} />
      </ThemeModeProvider>,
    ),
    router,
  };
};

describe('useRedirectToLogin', () => {
  it('redirects to login with the protected path and query in returnTo', async () => {
    const { router } = await renderRedirectProbe('/my/courses/course-1/lessons/lesson-1?thread=t1');

    await userEvent.click(screen.getByRole('button', { name: 'Redirect' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.searchStr).toBe(
      '?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
    );
  });

  it('does not rewrite an unsafe returnTo while already on login', async () => {
    const { router } = await renderRedirectProbe('/login?returnTo=https%3A%2F%2Fevil.example%2Fmy');

    await userEvent.click(screen.getByRole('button', { name: 'Redirect' }));

    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.searchStr).toBe('?returnTo=https%3A%2F%2Fevil.example%2Fmy');
  });
});
