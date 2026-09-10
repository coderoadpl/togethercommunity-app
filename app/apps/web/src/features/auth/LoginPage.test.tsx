import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import pkg from '../../../../../package.json' with { type: 'json' };

import { actions } from '../../api.js';
import { en } from '../../i18n/en.js';
import { validateLoginSearch } from '../../lib/auth-return.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, server, staffMe, tenantlessMe } from '../../test/server.js';
import { denySiteData } from '../../test/site-data.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { ForgotPasswordPage } from './ForgotPasswordPage.js';
import { LoginPage } from './LoginPage.js';

const stubAuthConfig = (exposeMagicLinks = false, googleClientId: string | null = null) =>
  server.use(
    http.get('*/api/public/auth-config', () =>
      HttpResponse.json({
        ok: true,
        data: {
          googleEnabled: googleClientId !== null,
          googleClientId,
          passkeysEnabled: true,
          totpEnabled: true,
          exposeMagicLinks,
        },
      }),
    ),
  );

const stubPublicNavigation = (courseIds: readonly string[] = []) =>
  server.use(
    http.get('*/api/public/navigation', () =>
      HttpResponse.json({
        ok: true,
        data: {
          navigation: {
            defaultHomeSpaceId: null,
            spaces: [],
            courses: courseIds.map((id) => ({ id, name: id, description: '', imageUrl: null })),
            lockedSpaces: [],
          },
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

const rateLimitSignInMethods = (retryAfterSeconds?: number) =>
  server.use(
    http.post('*/api/public/auth-resolve', () =>
      HttpResponse.json(
        {
          ok: false,
          error: {
            code: 'rate_limited',
            message: 'too many',
            ...(retryAfterSeconds === undefined ? {} : { details: { retryAfterSeconds } }),
          },
        },
        { status: 429 },
      ),
    ),
  );

const renderLoginPage = async (
  exposeMagicLinks = false,
  initialEntry = '/login',
  hostname?: string,
  methods: readonly string[] = ['password', 'magic-link'],
  publicCourseIds: readonly string[] = [],
  meHandler = anonymousMe(),
  googleClientId: string | null = null,
) => {
  stubAuthConfig(exposeMagicLinks, googleClientId);
  stubPublicNavigation(publicCourseIds);
  stubSignInMethods(methods);
  server.use(meHandler);
  window.history.pushState({}, '', initialEntry);
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div>Signed in home</div>,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    validateSearch: validateLoginSearch,
    component: () => hostname === undefined ? <LoginPage /> : <LoginPage hostname={hostname} />,
  });
  const forgotPasswordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/forgot-password',
    component: ForgotPasswordPage,
  });
  const registerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/register',
    component: () => <div>Register</div>,
  });
  const startRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/start',
    component: () => <div>Start</div>,
  });
  const lessonRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/my/courses/$courseId/lessons/$lessonId',
    component: () => <div>Lesson target</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      loginRoute,
      forgotPasswordRoute,
      registerRoute,
      startRoute,
      lessonRoute,
    ]),
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.sessionStorage.clear();
  delete window.google;
});

const continueWithEmail = async (email = 'creator@together.dev') => {
  await userEvent.type(screen.getByLabelText(en.auth.emailLabel), email);
  await userEvent.click(screen.getByRole('button', { name: en.auth.identifierContinue }));
};

const fillCredentials = async () => {
  await continueWithEmail();
  await userEvent.type(await screen.findByLabelText(en.auth.passwordLabel), 'wrong-password');
};

describe('LoginPage', () => {
  it('prompts with Google One Tap only for an anonymous visitor on login', async () => {
    const prompt = vi.fn();
    window.google = { accounts: { id: { initialize: vi.fn(), prompt } } };

    const anonymous = await renderLoginPage(false, '/login', undefined, ['password'], [], anonymousMe(), 'google-client-id');
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    anonymous.unmount();
    prompt.mockClear();

    await renderLoginPage(false, '/login', undefined, ['password'], [], staffMe(), 'google-client-id');
    await waitFor(() => expect(screen.getByText('Signed in home')).toBeInTheDocument());
    expect(prompt).not.toHaveBeenCalled();
  });

  it('redirects a signed-in tenant member to home', async () => {
    const { router } = await renderLoginPage(false, '/login', undefined, ['password'], [], staffMe());

    expect(await screen.findByText('Signed in home')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('keeps login available for a signed-in account without a tenant', async () => {
    const { router } = await renderLoginPage(false, '/login', undefined, ['password'], [], tenantlessMe());

    expect(await screen.findByRole('heading', { level: 1, name: en.auth.signInTitle })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it.each([
    ['configured base domain', 'togethercommunity.app'],
    ['derived start host', 'start.togethercommunity.app'],
  ])('uses platform login on the %s without resolving a tenant', async (_surface, hostname) => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    let offerCalls = 0;
    server.use(
      anonymousMe(),
      http.get('*/api/public/offer', () => {
        offerCalls += 1;
        return HttpResponse.json(
          { ok: false, error: { code: 'tenant_not_found', message: 'Unknown tenant' } },
          { status: 404 },
        );
      }),
    );

    await renderLoginPage(false, '/login', hostname);

    expect(screen.getByRole('heading', { level: 1, name: en.auth.signInTitle })).toBeInTheDocument();
    expect(screen.queryByText(/workspace togethercommunity\.app/u)).not.toBeInTheDocument();
    expect(screen.queryByText(en.errors.messageTenantNotFound)).not.toBeInTheDocument();
    await waitFor(() => expect(offerCalls).toBe(0));
    expect(document.title).toBe(`${en.auth.signInTitle} · Together`);
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

    const error = await screen.findByText(en.errors.messageTenantNotFound);
    const retry = screen.getByRole('button', { name: en.common.retry });
    const signupPrompt = screen.getByText(en.auth.registerPrompt);
    expect(screen.getByRole('heading', { level: 1, name: en.auth.signInTitle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.auth.identifierContinue })).toBeEnabled();
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
      component: () => <div>{en.tenant.choose}</div>,
    });
    const loginRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/login',
      component: () => <LoginPage hostname="localhost" />,
    });
    const forgotPasswordRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/forgot-password',
      component: ForgotPasswordPage,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute, loginRoute, forgotPasswordRoute]),
      history: createMemoryHistory({ initialEntries: ['/login'] }),
    });
    await router.load();
    renderWithProviders(
      <ThemeModeProvider>
        <RouterProvider router={router} />
      </ThemeModeProvider>,
    );

    await continueWithEmail();
    await userEvent.type(await screen.findByLabelText(en.auth.passwordLabel), 'demo-password-15');
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));

    expect(await screen.findByText(en.tenant.choose)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(offerCalls).toBe(0);
  });

  it('returns password sign-in to the safe returnTo path', async () => {
    server.use(
      http.post('*', ({ request }) =>
        new URL(request.url).pathname.endsWith('/sign-in/email')
          ? HttpResponse.json({ user: { id: 'u1', email: 'creator@together.dev' } })
          : undefined,
      ),
    );

    const { router } = await renderLoginPage(
      false,
      '/login?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
    );
    await continueWithEmail();
    await userEvent.type(await screen.findByLabelText(en.auth.passwordLabel), 'demo-password-15');
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/lesson-1'));
    expect(router.state.location.searchStr).toBe('?thread=t1');
  });

  it('returns passkey sign-in to the safe returnTo path', async () => {
    vi.spyOn(actions.signInWithPasskey, 'mutationFn').mockResolvedValue({
      token: null,
      twoFactorRedirect: false,
    });

    const { router } = await renderLoginPage(
      false,
      '/login?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1',
    );
    await userEvent.click(await screen.findByTestId('signin-passkey'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/lesson-1'));
  });

  it('returns two-factor completion to the safe returnTo path', async () => {
    server.use(
      http.post('*', ({ request }) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith('/sign-in/email')) return HttpResponse.json({ twoFactorRedirect: true });
        if (path.endsWith('/two-factor/verify-totp')) return HttpResponse.json({ token: 'session-token' });
        return undefined;
      }),
    );

    const { router } = await renderLoginPage(
      false,
      '/login?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1',
    );
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));
    await userEvent.type(await screen.findByLabelText(en.auth.twoFactorCodeLabel), '123456');
    await userEvent.click(screen.getByTestId('verify-login-totp'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/lesson-1'));
  });

  it('sends Google sign-in to the safe returnTo callback URL', async () => {
    const signInWithGoogle = vi.spyOn(actions.signInWithGoogle, 'mutationFn').mockResolvedValue(undefined);
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    window.google = { accounts: { id: { initialize: vi.fn(), prompt: vi.fn() } } };
    const initialEntry = '/login?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1';
    const callbackURL = 'http://localhost:3000/my/courses/course-1/lessons/lesson-1?thread=t1';

    const identifierStep = await renderLoginPage(
      false,
      initialEntry,
      'togethercommunity.app',
      ['magic-link'],
      [],
      anonymousMe(),
      'google-client-id',
    );
    await userEvent.click(await screen.findByTestId('continue-google'));
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledWith({ callbackURL }, expect.anything()));
    identifierStep.unmount();
    signInWithGoogle.mockClear();

    await renderLoginPage(
      false,
      initialEntry,
      'togethercommunity.app',
      ['magic-link'],
      [],
      anonymousMe(),
      'google-client-id',
    );
    await continueWithEmail();
    await screen.findByTestId('send-magic-link');
    await userEvent.click(screen.getByTestId('continue-google'));
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledWith({ callbackURL }, expect.anything()));
  });

  it('sends magic links back to login with the safe returnTo preserved', async () => {
    let submitted: unknown;
    server.use(
      http.post('*', async ({ request }) => {
        if (new URL(request.url).pathname.endsWith('/sign-in/magic-link')) submitted = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );

    await renderLoginPage(
      false,
      '/login?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
      undefined,
      ['magic-link'],
    );
    await continueWithEmail('member@example.com');
    await userEvent.click(await screen.findByTestId('send-magic-link'));

    await waitFor(() => expect(submitted).toMatchObject({
      callbackURL: 'http://localhost:3000/login?verification=verified&returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
    }));
  });

  it('post-verification landing uses returnTo and falls back to Start', async () => {
    const returned = await renderLoginPage(
      false,
      '/login?verification=verified&returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1',
      undefined,
      ['password'],
      [],
      staffMe(),
    );
    await waitFor(() => expect(returned.router.state.location.pathname).toBe('/my/courses/course-1/lessons/lesson-1'));
    returned.unmount();

    const fallback = await renderLoginPage(false, '/login?verification=verified', undefined, ['password'], [], staffMe());
    await waitFor(() => expect(fallback.router.state.location.pathname).toBe('/start'));
  });

  it('post-verification landing on the platform host lands on the workspace picker', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'localhost');
    const fallback = await renderLoginPage(
      false,
      '/login?verification=verified',
      'start.localhost',
      ['password'],
      [],
      staffMe(),
    );
    await waitFor(() => expect(fallback.router.state.location.pathname).toBe('/'));
  });

  it('keeps returnTo on register and forgot-password links', async () => {
    await renderLoginPage(
      false,
      '/login?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1',
    );

    expect(await screen.findByTestId('login-register-prompt')).toContainElement(
      screen.getByRole('link', { name: en.auth.registerLink }),
    );
    expect(screen.getByRole('link', { name: en.auth.registerLink })).toHaveAttribute(
      'href',
      '/register?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1',
    );
    await continueWithEmail();

    expect(await screen.findByTestId('forgot-password')).toHaveAttribute(
      'href',
      '/forgot-password?email=creator%40together.dev&returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1',
    );
  });

  it('asks for the identifier alone before any credential', async () => {
    await renderLoginPage();

    expect(screen.getByLabelText(en.auth.emailLabel)).toHaveFocus();
    expect(screen.getByRole('button', { name: en.auth.identifierContinue })).toBeInTheDocument();
    expect(screen.getByTestId('signin-passkey')).toBeInTheDocument();
    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password')).not.toBeInTheDocument();
    expect(screen.getByTestId('build-stamp')).toHaveTextContent(`v${pkg.version}`);
    expect(screen.queryByText('creator@together.dev')).not.toBeInTheDocument();
  });

  it('offers the passkey as an icon link under the divider on the identifier step', async () => {
    await renderLoginPage();

    const passkey = screen.getByTestId('signin-passkey');
    expect(passkey).toHaveTextContent(en.auth.passkeyLink);
    expect(passkey.querySelector('svg')).toBeInTheDocument();
    expect(window.getComputedStyle(passkey).getPropertyValue('min-height')).toBe('48px');
  });

  it.each(['success', 'failure', 'rate-limit'])('keeps configured Google available after lookup %s', async (outcome) => {
    await renderLoginPage(false, '/login', undefined, ['magic-link'], [], anonymousMe(), 'google-client-id');
    expect(await screen.findByTestId('continue-google')).toBeInTheDocument();
    if (outcome === 'failure') failSignInMethods();
    if (outcome === 'rate-limit') rateLimitSignInMethods();
    await continueWithEmail();
    if (outcome !== 'success') await userEvent.click(await screen.findByTestId('choose-magic-link'));
    await screen.findByTestId('send-magic-link');
    expect(screen.getByTestId('continue-google')).toBeEnabled();
  });

  it('carries the entered email into the editable password-reset form', async () => {
    await renderLoginPage();
    await continueWithEmail('member+login@example.com');
    await userEvent.click(await screen.findByTestId('forgot-password'));
    expect(await screen.findByTestId('forgot-password-email')).toHaveValue('member+login@example.com');
    await userEvent.clear(screen.getByTestId('forgot-password-email'));
    await userEvent.type(screen.getByTestId('forgot-password-email'), 'another@example.com');
    expect(screen.getByTestId('forgot-password-email')).toHaveValue('another@example.com');
  });

  it('opens the password step for an account that has a password', async () => {
    await renderLoginPage();
    await continueWithEmail();

    expect(await screen.findByLabelText(en.auth.passwordLabel)).toHaveFocus();
    const identifier = screen.getByTestId('login-identity-email');
    expect(identifier).toHaveValue('creator@together.dev');
    expect(identifier).toHaveAttribute('readonly');
    expect(identifier).toHaveAttribute('autocomplete', 'username');
    expect(screen.queryByLabelText(en.auth.emailLabel)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.auth.forgotPassword })).toHaveAttribute(
      'href',
      '/forgot-password?email=creator%40together.dev',
    );
    expect(screen.getByTestId('send-magic-link')).toHaveTextContent(en.auth.methodMagicLinkTitle);
    expect(screen.getByTestId('signin-passkey')).toHaveTextContent(en.auth.methodPasskeyTitle);
    expect(screen.getByTestId('login-identity')).toHaveTextContent('creator@together.dev');
    expect(
      screen.getByRole('group', { name: en.auth.signingInAs({ email: 'creator@together.dev' }) }),
    ).toBe(screen.getByTestId('login-identity'));
  });

  it('fits a long identity email while keeping the change button available', async () => {
    const email = 'member.with.a.very.long.email.address@courses.example.org';
    await renderLoginPage();
    await continueWithEmail(email);

    const pill = await screen.findByRole('group', { name: en.auth.signingInAs({ email }) });
    expect(pill).toHaveStyle({ width: '100%', boxSizing: 'border-box' });
    expect(within(pill).getByText(email)).toHaveStyle({
      minWidth: '0', flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });
    const change = within(pill).getByRole('button', { name: en.auth.changeIdentifier });
    expect(change).toHaveStyle({ minHeight: '44px', minWidth: '44px', flexShrink: '0' });
    await userEvent.click(change);
    expect(await screen.findByTestId('login-email')).toHaveValue(email);
    expect(screen.queryByTestId('login-identity')).not.toBeInTheDocument();
  });

  it('leaves the expanded password card head inert instead of an empty button', async () => {
    await renderLoginPage();
    await continueWithEmail();

    const head = await screen.findByTestId('use-password');
    expect(head).not.toHaveAttribute('role');
    expect(head).not.toHaveAttribute('tabindex');
    expect(
      screen.queryByRole('button', { name: new RegExp(en.auth.methodPasswordTitle, 'u') }),
    ).not.toBeInTheDocument();
  });

  it('opens the magic-link step for a passwordless account', async () => {
    await renderLoginPage(false, '/login', undefined, ['magic-link']);
    await continueWithEmail('learner@together.dev');

    expect(await screen.findByTestId('send-magic-link')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: en.auth.methodTitle })).toBeInTheDocument();
    expect(screen.getByText(en.auth.methodMagicLinkBody)).toBeInTheDocument();
    expect(screen.getByTestId('login-identity')).toHaveTextContent('learner@together.dev');
    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password')).not.toBeInTheDocument();
    expect(screen.queryByTestId('use-password')).not.toBeInTheDocument();
    expect(screen.getByText(en.auth.passwordNotNeeded)).toBeInTheDocument();
    expect(screen.getByTestId('signin-passkey')).toBeInTheDocument();
  });

  it('answers an unknown address exactly like a passwordless account', async () => {
    await renderLoginPage(false, '/login', undefined, ['magic-link']);
    await continueWithEmail('nobody@example.com');

    expect(await screen.findByTestId('send-magic-link')).toBeInTheDocument();
    expect(screen.getByTestId('login-identity')).toHaveTextContent('nobody@example.com');
    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
  });

  it('offers password when reported, with the link card first', async () => {
    await renderLoginPage(false, '/login', undefined, ['password']);
    await continueWithEmail();

    const cards = await screen.findAllByRole('listitem');
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining(en.auth.methodMagicLinkTitle),
      expect.stringContaining(en.auth.methodPasswordTitle),
      expect.stringContaining(en.auth.methodPasskeyTitle),
    ]);

    expect(screen.queryByText(en.auth.passwordNotNeeded)).not.toBeInTheDocument();
    expect(await screen.findByLabelText(en.auth.passwordLabel)).toBeInTheDocument();
    expect(screen.getByTestId('send-magic-link')).toBeInTheDocument();
  });

  it('rings every keyboard-focused control, not only the method cards', async () => {
    await renderLoginPage(false, '/login', undefined, ['magic-link']);
    await continueWithEmail();

    const card = await screen.findByTestId('send-magic-link');
    expect(window.getComputedStyle(card).outlineWidth).not.toBe('3px');

    for (const control of [card, screen.getByTestId('login-change-email')]) {
      control.classList.add('Mui-focusVisible');
      const style = window.getComputedStyle(control);
      const id = control.dataset['testid'];
      expect([id, style.outlineWidth, style.outlineStyle]).toEqual([id, '3px', 'solid']);
      expect([id, style.outlineColor]).not.toEqual([id, 'rgba(0, 0, 0, 0)']);
    }
  });

  it('returns to the identifier step with the address ready to edit', async () => {
    await renderLoginPage();
    await continueWithEmail();

    await userEvent.click(await screen.findByTestId('login-change-email'));

    expect(await screen.findByLabelText(en.auth.emailLabel)).toHaveValue('creator@together.dev');
    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
  });

  it('remembers the last identifier for the next visit in this tab only', async () => {
    const first = await renderLoginPage();
    await continueWithEmail();
    await screen.findByLabelText(en.auth.passwordLabel);
    first.unmount();

    expect(window.localStorage.getItem('together-login-identifier')).toBeNull();

    await renderLoginPage();

    expect(screen.getByLabelText(en.auth.emailLabel)).toHaveValue('creator@together.dev');
  });

  it('names the failure and preselects nothing when the lookup fails', async () => {
    await renderLoginPage();
    failSignInMethods();
    await continueWithEmail();

    const failure = await screen.findByTestId('sign-in-methods-unavailable');
    expect(failure).toHaveTextContent(
      en.auth.signInMethodsUnavailable,
    );
    const retry = within(failure).getByTestId('sign-in-methods-retry');
    expect(retry).toHaveClass('MuiButton-outlined');
    expect(retry).toHaveStyle({ width: '100%', minHeight: '44px' });
    expect(screen.getByTestId('login-identity')).toHaveTextContent('creator@together.dev');
    expect(screen.getByTestId('choose-magic-link')).toHaveTextContent(
      en.auth.signInMethodsChooseMagicLink,
    );
    expect(screen.getByTestId('choose-password')).toHaveTextContent(
      en.auth.signInMethodsChoosePassword,
    );
    expect(screen.queryByTestId('send-magic-link')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
  });

  it('quotes the retry delay when the resolver rate-limits the visitor', async () => {
    await renderLoginPage();
    rateLimitSignInMethods(42);
    await continueWithEmail();

    expect(await screen.findByTestId('sign-in-methods-unavailable')).toHaveTextContent(
      en.auth.signInMethodsRateLimitedRetryAfter({ seconds: 42 }),
    );
  });

  it('states a rate limit without a delay when the resolver sends none', async () => {
    await renderLoginPage();
    rateLimitSignInMethods();
    await continueWithEmail();

    expect(await screen.findByTestId('sign-in-methods-unavailable')).toHaveTextContent(
      en.auth.signInMethodsRateLimited,
    );
  });

  it('opens the password step from the failed lookup', async () => {
    await renderLoginPage();
    failSignInMethods();
    await continueWithEmail();

    await userEvent.click(await screen.findByTestId('choose-password'));

    expect(await screen.findByLabelText(en.auth.passwordLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-methods-unavailable')).not.toBeInTheDocument();
  });

  it.each([failSignInMethods, rateLimitSignInMethods])('offers all methods after a failed lookup: %s', async (failLookup) => {
    await renderLoginPage();
    failLookup();
    await continueWithEmail();

    await userEvent.click(await screen.findByTestId('choose-magic-link'));

    expect(await screen.findByTestId('send-magic-link')).toBeInTheDocument();
    expect(screen.getByTestId('use-password')).toBeInTheDocument();
    expect(screen.getByTestId('signin-passkey')).toBeInTheDocument();
    expect(screen.queryByText(en.auth.passwordNotNeeded)).not.toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-methods-unavailable')).not.toBeInTheDocument();
  });

  it('retries the lookup and lands on the resolved method', async () => {
    await renderLoginPage();
    failSignInMethods();
    await continueWithEmail();
    await screen.findByTestId('sign-in-methods-unavailable');
    stubSignInMethods(['password', 'magic-link']);

    await userEvent.click(screen.getByTestId('sign-in-methods-retry'));

    expect(await screen.findByLabelText(en.auth.passwordLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-methods-unavailable')).not.toBeInTheDocument();
  });

  it('reuses the known password method when a later lookup for the same address fails', async () => {
    await renderLoginPage();
    await continueWithEmail();
    await screen.findByLabelText(en.auth.passwordLabel);
    await userEvent.click(screen.getByTestId('login-change-email'));
    failSignInMethods();

    await userEvent.click(await screen.findByRole('button', { name: en.auth.identifierContinue }));

    expect(await screen.findByLabelText(en.auth.passwordLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-methods-unavailable')).not.toBeInTheDocument();
  });

  it('does not carry a known password method over to another address', async () => {
    await renderLoginPage();
    await continueWithEmail();
    await screen.findByLabelText(en.auth.passwordLabel);
    await userEvent.click(screen.getByTestId('login-change-email'));
    await userEvent.clear(await screen.findByLabelText(en.auth.emailLabel));
    failSignInMethods();

    await continueWithEmail('someone-else@together.dev');

    expect(await screen.findByTestId('sign-in-methods-unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
  });

  it('keeps the identifier fixed and focused while the lookup is in flight', async () => {
    await renderLoginPage();
    server.use(
      http.post('*/api/public/auth-resolve', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await continueWithEmail();

    const submit = await screen.findByRole('button', { name: en.auth.identifierPending });
    expect(submit).toBeEnabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
    const identifier = screen.getByLabelText(en.auth.emailLabel);
    expect(identifier).toBeEnabled();
    expect(identifier).toHaveAttribute('readonly');
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('status')).toHaveTextContent(en.auth.identifierPending);
  });

  it('rejects a malformed identifier before touching the resolver', async () => {
    let resolveCalls = 0;
    await renderLoginPage();
    server.use(
      http.post('*/api/public/auth-resolve', () => {
        resolveCalls += 1;
        return HttpResponse.json({ ok: true, data: { methods: ['password'] } });
      }),
    );

    await continueWithEmail('not-an-email');

    expect(await screen.findByText(en.auth.emailInvalid)).toBeInTheDocument();
    expect(screen.getByLabelText(en.auth.emailLabel)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(en.auth.emailLabel)).toHaveAccessibleDescription(
      en.auth.emailInvalid,
    );
    expect(resolveCalls).toBe(0);

    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), '@together.dev');

    expect(screen.queryByText(en.auth.emailInvalid)).not.toBeInTheDocument();
  });

  it('sends an expired-link visitor back to the magic link even with a password', async () => {
    await renderLoginPage(false, '/login?error=INVALID_TOKEN');
    await continueWithEmail();

    expect(await screen.findByTestId('send-magic-link')).toBeInTheDocument();
    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
  });

  it('degrades to not remembering when the browser blocks session storage', async () => {
    window.sessionStorage.setItem('together-login-identifier', 'previous@together.dev');
    const allowSiteData = denySiteData();

    try {
      await renderLoginPage();

      expect(screen.getByLabelText(en.auth.emailLabel)).toHaveValue('');

      await continueWithEmail();

      expect(await screen.findByLabelText(en.auth.passwordLabel)).toBeInTheDocument();
    } finally {
      allowSiteData();
    }
  });

  it.each([
    ['/login?verification=verified', 'verified', en.emailVerification.verified],
    [
      '/login?error=TOKEN_EXPIRED',
      'expired',
      en.emailVerification.expired,
    ],
    ['/login?error=USER_NOT_FOUND', 'providerError', en.emailVerification.providerError],
    ['/login?error=INVALID_USER', 'providerError', en.emailVerification.providerError],
  ] as const)('renders the %s verification outcome', async (entry, outcome, message) => {
    await renderLoginPage(false, entry);

    expect(await screen.findByTestId(`email-verification-${outcome}`)).toHaveTextContent(message);
  });

  it('shows an expired magic-link error with the replacement form ready', async () => {
    await renderLoginPage(false, '/login?error=INVALID_TOKEN');

    expect(screen.getByRole('alert')).toHaveTextContent(en.auth.magicLinkExpired);
    expect(screen.getByLabelText(en.auth.emailLabel)).toHaveFocus();
    expect(screen.queryByTestId('email-verification-invalid')).not.toBeInTheDocument();
  });

  it('does not present an unrelated login error as an email-verification failure', async () => {
    await renderLoginPage(false, '/login?error=SOCIAL_PROVIDER_FAILURE');

    expect(screen.queryByTestId(/^email-verification-/u)).not.toBeInTheDocument();
  });

  it('renders tenant social links after the sign-in form', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    server.use(
      http.get('*/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            tenant: {
              slug: 'akademia',
              name: 'Self-Learner Academy',
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

    await renderLoginPage(true, '/login', 'akademia.togethercommunity.app');

    const form = screen.getByLabelText(en.auth.emailLabel).closest('form');
    const socialLink = await screen.findByRole('link', { name: 'YouTube' });
    expect(document.title).toBe(`${en.auth.signInTitle} · Self-Learner Academy`);
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
      en.auth.magicLinkRequestedBody({ email: 'member@example.com' }),
    );
    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: en.auth.openMagicLink })).toHaveAttribute(
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
      en.auth.magicLinkRequestedBody({ email: 'member@example.com' }),
    );
    await waitFor(() => expect(devCalls).toBe(0));
    expect(screen.queryByText(en.auth.magicLinkFetching)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.common.retry })).not.toBeInTheDocument();
  });

  it('renders the AppError from a failed sign-in mutation', async () => {
    server.use(
      http.post('*', () =>
        HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 }),
      ),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));

    const alert = (await screen.findByText(en.errors.messageInvalidCredentials)).closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert).toHaveTextContent(en.errors.messageInvalidCredentials);
    expect(alert).not.toHaveTextContent(en.errors.messageUnauthorized);
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
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));

    expect(await screen.findByRole('button', { name: en.auth.signInPending })).toBeDisabled();
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
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));

    expect(await screen.findByTestId('two-factor-challenge')).toBeInTheDocument();
    expect(calls).toEqual(['password']);
    await userEvent.type(screen.getByLabelText(en.auth.twoFactorCodeLabel), '123456');
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
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));
    await userEvent.type(await screen.findByLabelText(en.auth.twoFactorCodeLabel), 'backup-once');
    await userEvent.click(screen.getByTestId('verify-login-backup-code'));

    await waitFor(() => expect(submitted).toEqual({ code: 'backup-once' }));
  });

  const reachTwoFactor = async () => {
    server.use(
      http.post('*', ({ request }) =>
        new URL(request.url).pathname.endsWith('/sign-in/email')
          ? HttpResponse.json({ twoFactorRedirect: true })
          : undefined,
      ),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));
    await screen.findByTestId('two-factor-challenge');
  };

  it('opens the challenge with the code field focused and the backup path reachable', async () => {
    await reachTwoFactor();

    const code = screen.getByTestId('two-factor-code');
    expect(code).toHaveFocus();
    expect(code).toHaveAttribute('autocapitalize', 'off');
    expect(code).toHaveAttribute('spellcheck', 'false');
    expect(code).not.toHaveAttribute('inputmode');
    expect(screen.getByTestId('verify-login-backup-code')).toBeEnabled();
    expect(screen.getByTestId('verify-login-totp')).toBeDisabled();
    expect(screen.queryByText(en.auth.registerPrompt)).not.toBeInTheDocument();
    expect(screen.queryByText(en.auth.demoAccount)).not.toBeInTheDocument();
  });

  it('returns an empty backup-code click to the field instead of the API', async () => {
    let backupCalls = 0;
    await reachTwoFactor();
    server.use(
      http.post('*', ({ request }) => {
        if (!new URL(request.url).pathname.endsWith('/two-factor/verify-backup-code')) {
          return undefined;
        }
        backupCalls += 1;
        return HttpResponse.json({ token: 'session-token' });
      }),
    );

    await userEvent.click(screen.getByTestId('verify-login-backup-code'));

    expect(backupCalls).toBe(0);
    expect(screen.getByTestId('two-factor-code')).toHaveFocus();
  });

  it('cancels the challenge back to the identifier without the twoFactor query', async () => {
    window.history.pushState({}, '', '/login?twoFactor=required');
    await reachTwoFactor();

    await userEvent.click(screen.getByTestId('two-factor-cancel'));

    expect(await screen.findByLabelText(en.auth.emailLabel)).toHaveValue('creator@together.dev');
    expect(screen.queryByTestId('two-factor-challenge')).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('resends the magic link and returns to the identifier from the sent state', async () => {
    let magicLinkCalls = 0;
    server.use(
      http.post('*', ({ request }) => {
        if (new URL(request.url).pathname.endsWith('/sign-in/magic-link')) magicLinkCalls += 1;
        return HttpResponse.json({ status: true });
      }),
    );

    await renderLoginPage(false, '/login', undefined, ['magic-link']);
    await continueWithEmail('member@example.com');
    await userEvent.click(await screen.findByTestId('send-magic-link'));
    await screen.findByTestId('magic-link-sent');
    expect(magicLinkCalls).toBe(1);

    await userEvent.click(screen.getByTestId('resend-magic-link'));

    expect(await screen.findByText(en.auth.magicLinkResent)).toBeInTheDocument();
    await waitFor(() => expect(magicLinkCalls).toBe(2));
    expect(screen.getByTestId('resend-magic-link')).toBeDisabled();
    expect(screen.getByTestId('resend-magic-link')).toHaveTextContent(
      en.auth.magicLinkResendCooldown({ seconds: 30 }),
    );

    await userEvent.click(screen.getByTestId('login-change-email'));

    expect(await screen.findByLabelText(en.auth.emailLabel)).toHaveValue('member@example.com');
    expect(screen.queryByTestId('magic-link-sent')).not.toBeInTheDocument();
  });

  it('retries the sign-in method lookup from the unavailable notice', async () => {
    await renderLoginPage();
    failSignInMethods();
    await continueWithEmail();
    await screen.findByTestId('sign-in-methods-unavailable');

    stubSignInMethods(['password']);
    await userEvent.click(screen.getByTestId('sign-in-methods-retry'));

    expect(await screen.findByLabelText(en.auth.passwordLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-methods-unavailable')).not.toBeInTheDocument();
  });

  it('clears the failed sign-in and the typed password when switching methods', async () => {
    server.use(
      http.post('*', ({ request }) =>
        new URL(request.url).pathname.endsWith('/sign-in/email')
          ? HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 })
          : undefined,
      ),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));
    await screen.findByText(en.errors.messageInvalidCredentials);

    await userEvent.click(screen.getByTestId('login-change-email'));
    await userEvent.click(await screen.findByRole('button', { name: en.auth.identifierContinue }));

    expect(await screen.findByLabelText(en.auth.passwordLabel)).toHaveValue('');
    expect(screen.queryByText(en.errors.messageInvalidCredentials)).not.toBeInTheDocument();
  });

  it('explains the expired link again on the magic-link step', async () => {
    await renderLoginPage(false, '/login?error=INVALID_TOKEN');
    await continueWithEmail();

    expect(await screen.findByText(en.auth.magicLinkExpiredOnStep)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
  });

  it('keeps the demo block on the identifier step of the platform surface only', async () => {
    await renderLoginPage(true, '/login', undefined, ['magic-link']);

    expect(await screen.findByText('creator@together.dev')).toBeInTheDocument();

    await continueWithEmail('member@example.com');
    await screen.findByTestId('send-magic-link');

    expect(screen.queryByText('demo-password-15')).not.toBeInTheDocument();
  });

  it('never announces the platform heading while a tenant name is in flight', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    server.use(
      http.get('*/api/public/offer', async () => {
        await delay(20);
        return HttpResponse.json({
          ok: true,
          data: {
            tenant: { slug: 'academy', name: 'Academy Demo' },
            contentVersion: 1,
            previewLessons: [],
            products: [],
          },
        });
      }),
    );

    await renderLoginPage(false, '/login', 'academy.togethercommunity.app');

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: en.auth.signInToTenant({ tenant: 'Academy Demo' }),
      }),
    ).toBeInTheDocument();
  });

  it('replaces the signup prompt with the tenant catalogue when courses are public', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    server.use(
      http.get('*/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            tenant: { slug: 'academy', name: 'Academy Demo' },
            contentVersion: 1,
            previewLessons: [],
            products: [],
          },
        }),
      ),
    );

    await renderLoginPage(false, '/login', 'academy.togethercommunity.app', undefined, [
      'course-1',
    ]);

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: en.auth.signInToTenant({ tenant: 'Academy Demo' }),
      }),
    ).toBeInTheDocument();
    const prompt = await screen.findByTestId('auth-footer-access');
    expect(prompt).toHaveTextContent(en.auth.noAccessPrompt);
    expect(
      within(prompt).getByRole('link', {
        name: en.auth.noAccessLink({ tenant: 'Academy Demo' }),
      }),
    ).toHaveAttribute('href', '/');
    expect(screen.queryByTestId('login-register-prompt')).not.toBeInTheDocument();
    expect(screen.queryByTestId('build-stamp')).not.toBeInTheDocument();
  });

  it('omits the access prompt on a tenant host with no public courses', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    server.use(
      http.get('*/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            tenant: { slug: 'academy', name: 'Academy Demo' },
            contentVersion: 1,
            previewLessons: [],
            products: [],
          },
        }),
      ),
    );

    await renderLoginPage(false, '/login', 'academy.togethercommunity.app');

    expect(await screen.findByLabelText(en.auth.emailLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('auth-footer-access')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-register-prompt')).not.toBeInTheDocument();
  });

  it('explains the next step under the identifier field', async () => {
    await renderLoginPage();

    expect(screen.getByLabelText(en.auth.emailLabel)).toHaveAccessibleDescription(
      en.auth.emailHelper,
    );
    expect(screen.getByTestId('login-register-prompt')).toHaveTextContent(en.auth.registerPrompt);
  });

  it('hides the demo block on a tenant host', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    await renderLoginPage(true, '/login', 'acme.togethercommunity.app');

    expect(await screen.findByLabelText(en.auth.emailLabel)).toBeInTheDocument();
    expect(screen.queryByText('demo-password-15')).not.toBeInTheDocument();
  });
});
