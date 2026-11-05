import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createBrowserHistory, createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { InpostGeowidget } from './InpostGeowidget.js';

const histories: ReturnType<typeof createBrowserHistory>[] = [];
const formPath = '/checkout/accessory';

const renderForm = async (input: { mapShown: boolean; forward?: boolean }) => {
  window.history.replaceState(null, '', '/my?tab=orders#latest');
  const location = window.location;
  const assign = vi.fn();
  const reload = vi.fn();
  vi.spyOn(window, 'location', 'get').mockImplementation(() => ({ ...location, assign, reload }));
  const history = createBrowserHistory();
  histories.push(history);
  history.push(formPath);
  history.flush();
  if (input.forward === true) {
    history.push('/my?tab=orders#latest');
    history.flush();
    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      history.back({ ignoreBlocker: true });
    });
  }
  const root = createRootRoute({ component: Outlet });
  const checkout = createRoute({
    getParentRoute: () => root,
    path: '/checkout/$ref',
    component: function CheckoutForm() {
      const [mapShown, setMapShown] = useState(input.mapShown);
      return <>
        {mapShown ? <InpostGeowidget token="public-map-token" language="en" dispatch={() => undefined} /> : <p>Courier selected</p>}
        <button onClick={() => setMapShown(false)}>Choose courier</button>
        <p>Checkout form</p>
        <Link to="/login">Go to sign-in</Link>
      </>;
    },
  });
  const login = createRoute({ getParentRoute: () => root, path: '/login', component: () => <p>Sign-in view</p> });
  const member = createRoute({ getParentRoute: () => root, path: '/my', component: () => <p>Member view</p> });
  const router = createRouter({ routeTree: root.addChildren([checkout, login, member]), history });
  render(<RouterProvider router={router} />);
  await screen.findByText('Checkout form');
  return { router, assign, reload };
};

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => {
  histories.splice(0).forEach((history) => history.destroy());
  document.getElementById('inpost-geowidget-script')?.remove();
  document.getElementById('inpost-geowidget-style')?.remove();
  vi.restoreAllMocks();
});

it('turns the sign-in link into a document navigation once the map script is injected', async () => {
  const { router, assign } = await renderForm({ mapShown: true });
  expect(document.getElementById('inpost-geowidget-script')).toHaveAttribute('src', 'https://geowidget.inpost.pl/inpost-geowidget.js');
  await userEvent.click(screen.getByRole('link', { name: 'Go to sign-in' }));
  expect(assign).toHaveBeenCalledExactlyOnceWith('/login');
  expect(router.state.location.pathname).toBe(formPath);
  expect(screen.queryByText('Sign-in view')).not.toBeInTheDocument();
});

it('turns programmatic member navigation into a document navigation', async () => {
  const { router, assign } = await renderForm({ mapShown: true });
  act(() => { void router.navigate({ to: '/my', hash: 'latest' }); });
  await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith('/my#latest'));
  expect(router.state.location.pathname).toBe(formPath);
  expect(screen.queryByText('Member view')).not.toBeInTheDocument();
});

it.each([
  { source: 'router', action: 'back' },
  { source: 'router', action: 'forward' },
  { source: 'browser', action: 'back' },
  { source: 'browser', action: 'go' },
] as const)('turns $source history $action into a document navigation', async ({ source, action }) => {
  const { router, assign, reload } = await renderForm({ mapShown: true, forward: action === 'forward' });
  const history = source === 'browser' ? window.history : router.history;
  act(() => {
    if (action === 'go') history.go(-1);
    else history[action]();
  });
  await waitFor(() => expect(reload).toHaveBeenCalledExactlyOnceWith());
  expect(assign).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe(formPath);
  expect(screen.queryByText('Member view')).not.toBeInTheDocument();
});

it('keeps the document navigation guard after the map is removed by choosing another rate', async () => {
  const { router, assign } = await renderForm({ mapShown: true });
  await userEvent.click(screen.getByRole('button', { name: 'Choose courier' }));
  expect(screen.getByText('Courier selected')).toBeVisible();
  expect(screen.queryByTestId('checkout-inpost-geowidget')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Go to sign-in' }));
  expect(assign).toHaveBeenCalledExactlyOnceWith('/login');
  expect(router.state.location.pathname).toBe(formPath);
  expect(screen.queryByText('Sign-in view')).not.toBeInTheDocument();
});

it('keeps client navigation while the map was never shown', async () => {
  const { assign } = await renderForm({ mapShown: false });
  await userEvent.click(screen.getByRole('link', { name: 'Go to sign-in' }));
  expect(await screen.findByText('Sign-in view')).toBeVisible();
  expect(assign).not.toHaveBeenCalled();
  expect(document.getElementById('inpost-geowidget-script')).toBeNull();
});

it('allows same-form fragment navigation after the map loaded', async () => {
  const { router, assign } = await renderForm({ mapShown: true });
  act(() => router.history.push(`${formPath}#delivery`));
  await waitFor(() => expect(router.state.location.hash).toBe('delivery'));
  expect(assign).not.toHaveBeenCalled();
  expect(screen.getByText('Checkout form')).toBeVisible();
});
