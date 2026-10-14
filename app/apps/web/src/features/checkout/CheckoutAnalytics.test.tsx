import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createBrowserHistory, createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CheckoutAnalytics } from './CheckoutAnalytics.js';

const analytics = vi.hoisted(() => ({ loadGoogleTag: vi.fn(), loadMetaPixel: vi.fn(), trackCheckoutPurchase: vi.fn() }));
vi.mock('./analytics.js', () => analytics);

const histories: ReturnType<typeof createBrowserHistory>[] = [];
const returnPath = '/checkout/course?status=success&session_id=cs_live_one';
const config = {
  metaPixelId: null,
  tagId: 'G-ABC1234', consentCookieName: 'consent', consentCookieValue: null,
  loadWithoutConsent: false,
};

const renderReturn = async (testMode = false, forward = false) => {
  window.history.replaceState(null, '', '/my?tab=recent#lesson');
  const location = window.location;
  const assign = vi.fn();
  vi.spyOn(window, 'location', 'get').mockImplementation(() => ({ ...location, assign }));
  const history = createBrowserHistory();
  histories.push(history);
  history.push(returnPath);
  history.flush();
  if (forward) {
    history.push('/my?tab=recent#lesson');
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
    component: function ReturnPage() {
      const [enabled, setEnabled] = useState(true);
      return <>
        {enabled ? <CheckoutAnalytics config={config} sessionId="cs_live_one" purchase={undefined} testMode={testMode} /> : <p>Analytics configuration removed</p>}
        <button onClick={() => setEnabled(false)}>Remove analytics configuration</button>
        <p>Purchase return</p>
        <Link to="/">Open Studio</Link>
      </>;
    },
  });
  const studio = createRoute({ getParentRoute: () => root, path: '/', component: () => <p>Studio destination</p> });
  const member = createRoute({ getParentRoute: () => root, path: '/my', component: () => <p>Member destination</p> });
  const router = createRouter({
    routeTree: root.addChildren([checkout, studio, member]),
    history,
  });
  render(<RouterProvider router={router} />);
  await screen.findByText('Purchase return');
  return { router, assign };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  analytics.loadGoogleTag.mockReturnValue(true);
  analytics.loadMetaPixel.mockReturnValue(false);
});
afterEach(() => {
  histories.splice(0).forEach((history) => history.destroy());
  vi.restoreAllMocks();
});

it('turns a Studio link into a document navigation before Studio can render', async () => {
  const { router, assign } = await renderReturn();
  await userEvent.click(screen.getByRole('link', { name: 'Open Studio' }));
  expect(assign).toHaveBeenCalledExactlyOnceWith('/');
  expect(router.state.location.pathname).toBe('/checkout/course');
  expect(screen.queryByText('Studio destination')).not.toBeInTheDocument();
});

it('turns programmatic member navigation into a document navigation', async () => {
  const { router, assign } = await renderReturn();
  act(() => { void router.navigate({ to: '/my', hash: 'lesson' }); });
  await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith('/my#lesson'));
  expect(router.state.location.pathname).toBe('/checkout/course');
  expect(screen.queryByText('Member destination')).not.toBeInTheDocument();
});

it.each([
  { source: 'router', action: 'back' },
  { source: 'router', action: 'forward' },
  { source: 'router', action: 'go' },
  { source: 'browser', action: 'back' },
  { source: 'browser', action: 'forward' },
  { source: 'browser', action: 'go' },
] as const)('turns $source history $action into a document navigation with the full destination URL', async ({ source, action }) => {
  const { router, assign } = await renderReturn(false, action === 'forward');
  const rollback = vi.spyOn(window.history, 'go');
  const history = source === 'browser' ? window.history : router.history;
  act(() => {
    if (action === 'go') history.go(-1);
    else history[action]();
  });
  await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith('/my?tab=recent#lesson'));
  expect(router.state.location.pathname).toBe('/checkout/course');
  expect(screen.queryByText('Member destination')).not.toBeInTheDocument();
  expect(rollback).toHaveBeenCalledTimes(action === 'go' ? 1 : 0);
});

it.each([false, true])('keeps normal client navigation without a loaded tag (test mode: %s)', async (testMode) => {
  analytics.loadGoogleTag.mockReturnValue(false);
  const { assign } = await renderReturn(testMode);
  await userEvent.click(screen.getByRole('link', { name: 'Open Studio' }));
  expect(await screen.findByText('Studio destination')).toBeVisible();
  expect(assign).not.toHaveBeenCalled();
});

it('allows same-return-page fragment navigation without leaving a pending blocker', async () => {
  const { router, assign } = await renderReturn();
  act(() => router.history.push(`${returnPath}#receipt`));
  await waitFor(() => expect(router.state.location.hash).toBe('receipt'));
  expect(assign).not.toHaveBeenCalled();
  expect(screen.getByText('Purchase return')).toBeVisible();
});


it('keeps the document navigation guard when analytics configuration disappears after loading', async () => {
  const { router, assign } = await renderReturn();
  await userEvent.click(screen.getByRole('button', { name: 'Remove analytics configuration' }));
  expect(screen.getByText('Analytics configuration removed')).toBeVisible();
  await userEvent.click(screen.getByRole('link', { name: 'Open Studio' }));
  expect(assign).toHaveBeenCalledExactlyOnceWith('/');
  expect(router.state.location.pathname).toBe('/checkout/course');
  expect(screen.queryByText('Studio destination')).not.toBeInTheDocument();
});


it('guards navigation when only Meta Pixel loaded', async () => {
  analytics.loadGoogleTag.mockReturnValue(false);
  analytics.loadMetaPixel.mockReturnValue(true);
  const { assign } = await renderReturn();
  await userEvent.click(screen.getByRole('link', { name: 'Open Studio' }));
  expect(assign).toHaveBeenCalledExactlyOnceWith('/');
  expect(screen.queryByText('Studio destination')).not.toBeInTheDocument();
});
