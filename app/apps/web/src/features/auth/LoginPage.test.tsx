import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import pkg from '../../../../../package.json' with { type: 'json' };

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { denySiteData } from '../../test/site-data.js';
import { LoginPage } from './LoginPage.js';

const stubAuthConfig = (exposeMagicLinks = false) =>
  server.use(
    http.get('*/api/public/auth-config', () =>
      HttpResponse.json({
        ok: true,
        data: {
          googleEnabled: false,
          passkeysEnabled: true,
          totpEnabled: true,
          exposeMagicLinks,
        },
      }),
    ),
  );

const stubSignInMethods = (methods: readonly string[]) =>
  server.use(
    http.post('*/api/public/auth-resolve', () => HttpResponse.json({ ok: true, data: { methods } })),
  );

const failSignInMethods = () =>
  server.use(
    http.post('*/api/public/auth-resolve', () =>
      HttpResponse.json({ ok: false, error: { code: 'unavailable', message: 'down' } }, { status: 503 }),
    ),
  );

const renderLoginPage = async (
  exposeMagicLinks = false,
  initialEntry = '/login',
  hostname?: string,
  methods: readonly string[] = ['password', 'magic-link'],
) => {
  stubAuthConfig(exposeMagicLinks);
  stubSignInMethods(methods);
  window.history.pushState({}, '', initialEntry);
  const rootRoute = createRootRoute({
    component: () => hostname === undefined ? <LoginPage /> : <LoginPage hostname={hostname} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

afterEach(() => {
  vi.unstubAllEnvs();
  window.sessionStorage.clear();
});

const continueWithEmail = async (email = 'creator@together.dev') => {
  await userEvent.type(screen.getByLabelText(pl.auth.emailLabel), email);
  await userEvent.click(screen.getByRole('button', { name: pl.auth.identifierContinue }));
};

const fillCredentials = async () => {
  await continueWithEmail();
  await userEvent.type(await screen.findByLabelText(pl.auth.passwordLabel), 'wrong-password');
};

describe('LoginPage', () => {
  it.each([
    ['configured base domain', 'togethercommunity.app'],
    ['derived start host', 'start.togethercommunity.app'],
  ])('uses platform login on the %s without resolving a tenant', async (_surface, hostname) => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    let offerCalls = 0;
    server.use(
      http.get('*/api/public/offer', () => {
        offerCalls += 1;
        return HttpResponse.json(
          { ok: false, error: { code: 'tenant_not_found', message: 'Unknown tenant' } },
          { status: 404 },
        );
      }),
    );

    await renderLoginPage(false, '/login', hostname);

    expect(screen.getByText(pl.auth.signInPlatformEyebrow)).toBeInTheDocument();
    expect(screen.queryByText(/przestrzeń togethercommunity\.app/u)).not.toBeInTheDocument();
    expect(screen.queryByText(pl.errors.messageTenantNotFound)).not.toBeInTheDocument();
    await waitFor(() => expect(offerCalls).toBe(0));
  });

  it('keeps single-tenant login usable with a platform caption when no sole tenant exists', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');
    server.use(
      http.get('*/api/public/offer', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'tenant_not_found', message: 'Unknown tenant' } },
          { status: 404 },
        ),
      ),
    );

    await renderLoginPage(false, '/login', 'preview.example');

    const error = await screen.findByText(pl.errors.messageTenantNotFound);
    const retry = screen.getByRole('button', { name: pl.common.retry });
    const signupPrompt = screen.getByText(pl.auth.registerPrompt);
    expect(screen.getByText(pl.auth.signInPlatformEyebrow)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.auth.identifierContinue })).toBeEnabled();
    expect(retry).toHaveClass('MuiButton-fullWidth');
    expect(error.compareDocumentPosition(signupPrompt)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('lands a successful base-domain login on the workspace picker', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'localhost');
    let offerCalls = 0;
    stubAuthConfig();
    server.use(
      http.get('*/api/public/offer', () => {
        offerCalls += 1;
        return HttpResponse.json(
          { ok: false, error: { code: 'tenant_not_found', message: 'Unknown tenant' } },
          { status: 404 },
        );
      }),
      http.post('*', () =>
        HttpResponse.json({ user: { id: 'u1', email: 'creator@together.dev' } }),
      ),
    );
    stubSignInMethods(['password', 'magic-link']);
    window.history.pushState({}, '', '/login');
    const rootRoute = createRootRoute({ component: Outlet });
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <div>{pl.tenant.choose}</div>,
    });
    const loginRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/login',
      component: () => <LoginPage hostname="localhost" />,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute, loginRoute]),
      history: createMemoryHistory({ initialEntries: ['/login'] }),
    });
    await router.load();
    renderWithProviders(<RouterProvider router={router} />);

    await continueWithEmail();
    await userEvent.type(await screen.findByLabelText(pl.auth.passwordLabel), 'demo-password-15');
    await userEvent.click(screen.getByRole('button', { name: pl.auth.signInIdle }));

    expect(await screen.findByText(pl.tenant.choose)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(offerCalls).toBe(0);
  });

  it('asks for the identifier alone before any credential', async () => {
    await renderLoginPage();

    expect(screen.getByLabelText(pl.auth.emailLabel)).toHaveFocus();
    expect(screen.getByRole('button', { name: pl.auth.identifierContinue })).toBeInTheDocument();
    expect(screen.getByTestId('signin-passkey')).toBeInTheDocument();
    expect(screen.queryByLabelText(pl.auth.passwordLabel)).not.toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password')).not.toBeInTheDocument();
    expect(screen.getByTestId('build-stamp')).toHaveTextContent(`v${pkg.version}`);
    expect(screen.queryByText('creator@together.dev')).not.toBeInTheDocument();
  });

  it('opens the password step for an account that has a password', async () => {
    await renderLoginPage();
    await continueWithEmail();

    expect(await screen.findByLabelText(pl.auth.passwordLabel)).toHaveFocus();
    const identifier = screen.getByLabelText(pl.auth.emailLabel);
    expect(identifier).toHaveValue('creator@together.dev');
    expect(identifier).toHaveAttribute('readonly');
    expect(identifier).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByRole('link', { name: pl.auth.forgotPasswordLink })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByTestId('use-magic-link')).toHaveTextContent(pl.auth.useMagicLinkInstead);
    expect(screen.queryByTestId('login-identity')).not.toBeInTheDocument();
  });

  it('opens the magic-link step for a passwordless account', async () => {
    await renderLoginPage(false, '/login', undefined, ['magic-link']);
    await continueWithEmail('kursant@together.dev');

    expect(await screen.findByTestId('send-magic-link')).toBeInTheDocument();
    expect(screen.getByText(pl.auth.magicLinkStepBody)).toBeInTheDocument();
    expect(screen.getByTestId('send-magic-link')).toHaveAccessibleDescription(
      pl.auth.magicLinkStepBody,
    );
    expect(screen.queryByLabelText(pl.auth.passwordLabel)).not.toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password')).not.toBeInTheDocument();
    expect(screen.getByTestId('use-password')).toHaveTextContent(pl.auth.usePasswordInstead);
  });

  it('answers an unknown address exactly like a passwordless account', async () => {
    await renderLoginPage(false, '/login', undefined, ['magic-link']);
    await continueWithEmail('nobody@example.com');

    expect(await screen.findByTestId('send-magic-link')).toBeInTheDocument();
    expect(screen.getByTestId('login-identity')).toHaveTextContent(
      pl.auth.signingInAs({ email: 'nobody@example.com' }),
    );
    expect(screen.queryByLabelText(pl.auth.passwordLabel)).not.toBeInTheDocument();
  });

  it('lets each step reach the other method without leaving the page', async () => {
    await renderLoginPage(false, '/login', undefined, ['magic-link']);
    await continueWithEmail();

    await userEvent.click(await screen.findByTestId('use-password'));
    expect(await screen.findByLabelText(pl.auth.passwordLabel)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('use-magic-link'));
    expect(await screen.findByTestId('send-magic-link')).toBeInTheDocument();
  });

  it('returns to the identifier step with the address ready to edit', async () => {
    await renderLoginPage();
    await continueWithEmail();

    await userEvent.click(await screen.findByTestId('login-change-email'));

    expect(await screen.findByLabelText(pl.auth.emailLabel)).toHaveValue('creator@together.dev');
    expect(screen.queryByLabelText(pl.auth.passwordLabel)).not.toBeInTheDocument();
  });

  it('remembers the last identifier for the next visit in this tab only', async () => {
    const first = await renderLoginPage();
    await continueWithEmail();
    await screen.findByLabelText(pl.auth.passwordLabel);
    first.unmount();

    expect(window.localStorage.getItem('together-login-identifier')).toBeNull();

    await renderLoginPage();

    expect(screen.getByLabelText(pl.auth.emailLabel)).toHaveValue('creator@together.dev');
  });

  it('falls open to the magic link when the lookup fails', async () => {
    await renderLoginPage();
    failSignInMethods();
    await continueWithEmail();

    expect(await screen.findByTestId('send-magic-link')).toBeInTheDocument();
    expect(screen.getByTestId('sign-in-methods-unavailable')).toHaveTextContent(
      pl.auth.signInMethodsUnavailable,
    );

    await userEvent.click(screen.getByTestId('use-password'));

    expect(await screen.findByLabelText(pl.auth.passwordLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-methods-unavailable')).not.toBeInTheDocument();
  });

  it('keeps the identifier fixed while the lookup is in flight', async () => {
    await renderLoginPage();
    server.use(
      http.post('*/api/public/auth-resolve', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await continueWithEmail();

    expect(await screen.findByRole('button', { name: pl.auth.identifierPending })).toBeDisabled();
    expect(screen.getByLabelText(pl.auth.emailLabel)).toBeDisabled();
  });

  it('sends an expired-link visitor back to the magic link even with a password', async () => {
    await renderLoginPage(false, '/login?error=INVALID_TOKEN');
    await continueWithEmail();

    expect(await screen.findByTestId('send-magic-link')).toBeInTheDocument();
    expect(screen.queryByLabelText(pl.auth.passwordLabel)).not.toBeInTheDocument();
  });

  it('degrades to not remembering when the browser blocks session storage', async () => {
    window.sessionStorage.setItem('together-login-identifier', 'previous@together.dev');
    const allowSiteData = denySiteData();

    try {
      await renderLoginPage();

      expect(screen.getByLabelText(pl.auth.emailLabel)).toHaveValue('');

      await continueWithEmail();

      expect(await screen.findByLabelText(pl.auth.passwordLabel)).toBeInTheDocument();
    } finally {
      allowSiteData();
    }
  });

  it.each([
    ['/login?verification=verified', 'verified', pl.emailVerification.verified],
    [
      '/login?error=TOKEN_EXPIRED',
      'expired',
      pl.emailVerification.expired,
    ],
    ['/login?error=USER_NOT_FOUND', 'providerError', pl.emailVerification.providerError],
    ['/login?error=INVALID_USER', 'providerError', pl.emailVerification.providerError],
  ] as const)('renders the %s verification outcome', async (entry, outcome, message) => {
    await renderLoginPage(false, entry);

    expect(await screen.findByTestId(`email-verification-${outcome}`)).toHaveTextContent(message);
  });

  it('shows an expired magic-link error with the replacement form ready', async () => {
    await renderLoginPage(false, '/login?error=INVALID_TOKEN');

    expect(screen.getByRole('alert')).toHaveTextContent(pl.auth.magicLinkExpired);
    expect(screen.getByLabelText(pl.auth.emailLabel)).toHaveFocus();
    expect(screen.queryByTestId('email-verification-invalid')).not.toBeInTheDocument();
  });

  it('does not present an unrelated login error as an email-verification failure', async () => {
    await renderLoginPage(false, '/login?error=SOCIAL_PROVIDER_FAILURE');

    expect(screen.queryByTestId(/^email-verification-/u)).not.toBeInTheDocument();
  });

  it('renders tenant social links after the sign-in form', async () => {
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            tenant: {
              slug: 'akademia',
              name: 'Akademia Samouka',
              branding: { logoUrl: null, accentColor: null, faviconUrl: null },
              socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@akademia' }],
              support: { url: null },
            },
            contentVersion: 1,
            products: [],
          },
        }),
      ),
    );

    await renderLoginPage(true);

    const form = screen.getByLabelText(pl.auth.emailLabel).closest('form');
    const socialLink = await screen.findByRole('link', { name: 'YouTube' });
    expect(form).not.toBeNull();
    expect(form?.compareDocumentPosition(socialLink) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows demo credentials only when dev magic-link exposure is enabled', async () => {
    await renderLoginPage(true);

    expect(await screen.findByText('creator@together.dev')).toBeInTheDocument();
    expect(screen.getByText('demo-password-15')).toBeInTheDocument();
  });

  it('links public preview lessons to the registered player route', async () => {
    server.use(
      http.get('*/api/public/offer', () => HttpResponse.json({
        ok: true,
        data: {
          tenant: { slug: 'acme', name: 'Acme' },
          contentVersion: 1,
          previewLessons: [{ id: 'lesson-1', name: 'Free introduction', courseId: 'course-1' }],
          products: [],
        },
      })),
    );

    await renderLoginPage();

    expect(await screen.findByRole('link', { name: 'Free introduction' })).toHaveAttribute(
      'href',
      '/my/courses/course-1/lessons/lesson-1',
    );
  });

  it('swaps the form for a magic-link confirmation after requesting a link', async () => {
    server.use(
      http.post('*', () => HttpResponse.json({ status: true })),
      http.get('*/api/dev/magic-link', () =>
        HttpResponse.json({
          ok: true,
          data: {
            magicLink: {
              email: 'member@example.com',
              url: 'https://studio.test/magic',
              token: 'magic-token',
            },
          },
        }),
      ),
    );

    await renderLoginPage(true, '/login', undefined, ['magic-link']);
    await continueWithEmail('member@example.com');
    await userEvent.click(await screen.findByTestId('send-magic-link'));

    expect(await screen.findByTestId('magic-link-sent')).toHaveTextContent(
      pl.auth.magicLinkRequestedBody({ email: 'member@example.com' }),
    );
    expect(screen.queryByLabelText(pl.auth.passwordLabel)).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: pl.auth.openMagicLink })).toHaveAttribute(
      'href',
      'https://studio.test/magic',
    );
  });

  it('does not request or surface the dev magic link when exposure is disabled', async () => {
    let devCalls = 0;
    server.use(
      http.post('*', () => HttpResponse.json({ status: true })),
      http.get('*/api/public/offer', () => HttpResponse.json({
        ok: true,
        data: {
          tenant: { slug: 'acme', name: 'Acme' },
          contentVersion: 1,
          previewLessons: [],
          products: [],
        },
      })),
      http.get('*/api/dev/magic-link', () => {
        devCalls += 1;
        return HttpResponse.json(
          { ok: false, error: { code: 'not_found', message: 'Not found' } },
          { status: 404 },
        );
      }),
    );

    await renderLoginPage(false, '/login', undefined, ['magic-link']);
    await continueWithEmail('member@example.com');
    await userEvent.click(await screen.findByTestId('send-magic-link'));

    expect(await screen.findByTestId('magic-link-sent')).toHaveTextContent(
      pl.auth.magicLinkRequestedBody({ email: 'member@example.com' }),
    );
    await waitFor(() => expect(devCalls).toBe(0));
    expect(screen.queryByText(pl.auth.magicLinkFetching)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: pl.common.retry })).not.toBeInTheDocument();
  });

  it('renders the AppError from a failed sign-in mutation', async () => {
    server.use(
      http.post('*', () =>
        HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 }),
      ),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: pl.auth.signInIdle }));

    const alert = (await screen.findByText(pl.errors.messageInvalidCredentials)).closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert).toHaveTextContent(pl.errors.messageInvalidCredentials);
    expect(alert).not.toHaveTextContent(pl.errors.messageUnauthorized);
  });

  it('disables submit while the sign-in mutation is pending', async () => {
    server.use(
      http.post('*', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: pl.auth.signInIdle }));

    expect(await screen.findByRole('button', { name: pl.auth.signInPending })).toBeDisabled();
  });

  it('keeps a pending sign-in provisional until TOTP succeeds', async () => {
    const calls: string[] = [];
    server.use(
      http.post('*', ({ request }) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith('/sign-in/email')) {
          calls.push('password');
          return HttpResponse.json({ twoFactorRedirect: true });
        }
        if (path.endsWith('/two-factor/verify-totp')) {
          calls.push('totp');
          return HttpResponse.json({ token: 'session-token' });
        }
        return undefined;
      }),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: pl.auth.signInIdle }));

    expect(await screen.findByTestId('two-factor-challenge')).toBeInTheDocument();
    expect(calls).toEqual(['password']);
    await userEvent.type(screen.getByLabelText(pl.auth.twoFactorCodeLabel), '123456');
    await userEvent.click(screen.getByTestId('verify-login-totp'));

    await waitFor(() => expect(calls).toEqual(['password', 'totp']));
    expect(screen.queryByTestId('two-factor-challenge')).not.toBeInTheDocument();
  });

  it('offers backup-code redemption as a first-class challenge action', async () => {
    let submitted: unknown;
    server.use(
      http.post('*', async ({ request }) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith('/sign-in/email')) {
          return HttpResponse.json({ twoFactorRedirect: true });
        }
        if (path.endsWith('/two-factor/verify-backup-code')) {
          submitted = await request.json();
          return HttpResponse.json({ token: 'session-token' });
        }
        return undefined;
      }),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: pl.auth.signInIdle }));
    await userEvent.type(await screen.findByLabelText(pl.auth.twoFactorCodeLabel), 'backup-once');
    await userEvent.click(screen.getByTestId('verify-login-backup-code'));

    await waitFor(() => expect(submitted).toEqual({ code: 'backup-once' }));
  });
});
