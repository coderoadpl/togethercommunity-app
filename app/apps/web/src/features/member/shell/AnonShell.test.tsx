import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../../../components/ui/Toast.js';
import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ThemeModeProvider } from '../../../theme-mode.js';
import { AnonShell } from './AnonShell.js';

const LOGIN_IDENTIFIER_KEY = 'together-login-identifier';

const publicNavigation = () =>
  http.get('/api/public/navigation', () =>
    HttpResponse.json({
      ok: true,
      data: {
        navigation: { defaultHomeSpaceId: null, spaces: [], courses: [], lockedSpaces: [] },
      },
    }));

const publicOffer = () =>
  http.get('/api/public/offer', () =>
    HttpResponse.json({
      ok: true,
      data: {
        tenant: {
          slug: 'acme',
          name: 'Acme',
          branding: { logoUrl: null, accentColor: null, faviconUrl: null },
          socialLinks: [],
        },
        contentVersion: 1,
        products: [],
      },
    }));

const renderVisitorShell = async () => {
  const rootRoute = createRootRoute();
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/start',
      component: () => (
        <AnonShell visitorEmail="visitor@example.com">
          <p>Public start</p>
        </AnonShell>
      ),
    }),
    createRoute({ getParentRoute: () => rootRoute, path: '/login', component: () => <p>Sign-in page</p> }),
  ]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/start'] }) });
  await router.load();
  return {
    router,
    ...renderWithProviders(
      <ThemeModeProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </ThemeModeProvider>,
    ),
  };
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe('AnonShell visitor account', () => {
  it('signs a signed-in non-member out, forgets the session and sends them to sign-in', async () => {
    const signOutCalls: string[] = [];
    server.use(
      publicNavigation(),
      publicOffer(),
      http.post('*', ({ request }) => {
        signOutCalls.push(new URL(request.url).pathname);
        return HttpResponse.json({ success: true });
      }),
    );
    window.sessionStorage.setItem(LOGIN_IDENTIFIER_KEY, 'visitor@example.com');
    const { router, queryClient } = await renderVisitorShell();
    queryClient.setQueryData(['me'], { email: 'visitor@example.com' });

    expect(await screen.findByTestId('anon-visitor-email')).toHaveTextContent('visitor@example.com');
    await userEvent.click(screen.getByTestId('anon-sign-out'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(await screen.findByText('Sign-in page')).toBeInTheDocument();
    expect(signOutCalls).toHaveLength(1);
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
    expect(window.sessionStorage.getItem(LOGIN_IDENTIFIER_KEY)).toBeNull();
  });

  it('keeps the visitor on the page with an error toast when sign-out fails', async () => {
    let signOutCalls = 0;
    server.use(
      publicNavigation(),
      publicOffer(),
      http.post('*', () => {
        signOutCalls += 1;
        return HttpResponse.json(
          { code: 'TEST_FAILURE', message: 'Could not sign out' },
          { status: 500 },
        );
      }),
    );
    window.sessionStorage.setItem(LOGIN_IDENTIFIER_KEY, 'visitor@example.com');
    const { router } = await renderVisitorShell();

    await userEvent.click(await screen.findByTestId('anon-sign-out'));

    await waitFor(() => expect(signOutCalls).toBe(1));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.messageInternal);
    expect(router.state.location.pathname).toBe('/start');
    expect(window.sessionStorage.getItem(LOGIN_IDENTIFIER_KEY)).toBe('visitor@example.com');
    expect(screen.getByTestId('anon-sign-out')).toBeEnabled();
  });
});
