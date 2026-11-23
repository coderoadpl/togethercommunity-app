import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import pkg from '../../../../../package.json' with { type: 'json' };

import { ApiError } from '#core/client/index.js';
import { MAGIC_LINK_TOKEN_EXPIRES_IN_SECONDS, type Language } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { en } from '../../i18n/en.js';
import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { validateLoginSearch } from '../../lib/auth-return.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, server, staffMe, tenantlessMe } from '../../test/server.js';
import { denySiteData } from '../../test/site-data.js';
import { languagePreference, ThemeModeProvider } from '../../theme-mode.js';
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
  language?: Language,
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
  if (language !== undefined) languagePreference.save(language);
  const page = (
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>
  );
  return {
    ...renderWithProviders(
      language === undefined ? page : <LanguageProvider>{page}</LanguageProvider>,
    ),
    router,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.localStorage.clear();
  delete window.google;
});

const continueWithEmail = async (email = 'creator@together.dev') => {
  await userEvent.type(screen.getByLabelText(en.auth.emailLabel), email);
  await userEvent.click(screen.getByRole('button', { name: en.auth.identifierContinue }));
};

const fillCredentials = async () => {
  await continueWithEmail();
  await userEvent.click(await screen.findByTestId('use-password'));
  await userEvent.type(await screen.findByLabelText(en.auth.passwordLabel), 'wrong-password');
};

describe('LoginPage', () => {
  it('starts conditional passkey sign-in only on the identifier step', async () => {
    const available = vi.fn(async () => true);
    vi.stubGlobal('PublicKeyCredential', { isConditionalMediationAvailable: available });
    const signIn = vi.spyOn(actions.signInWithPasskey, 'mutationFn').mockRejectedValue(new Error('No credential selected'));

    await renderLoginPage();
    await waitFor(() => expect(signIn).toHaveBeenCalledWith({ autoFill: true }, expect.anything()));
    await continueWithEmail();
    await screen.findByTestId('use-password');
    expect(available).toHaveBeenCalledOnce();
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('does not start conditional passkey sign-in on a two-factor mount', async () => {
    const available = vi.fn(async () => true);
    vi.stubGlobal('PublicKeyCredential', { isConditionalMediationAvailable: available });
    const signIn = vi.spyOn(actions.signInWithPasskey, 'mutationFn');

    await renderLoginPage(false, '/login?twoFactor=required');
    await screen.findByTestId('two-factor-code');
    expect(available).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it.each([
    { enabled: true, text: 'First line\n<script>plain text</script>', visible: true },
    { enabled: false, text: 'Hidden notice', visible: false },
    { enabled: true, text: '   ', visible: false },
  ])('renders the public notice as plain text only when enabled and nonempty: $visible', async ({ enabled, text, visible }) => {
    server.use(http.get('*/api/public/offer', () => HttpResponse.json({
      ok: true,
      data: { tenant: { slug: 'acme', name: 'Acme', signInNotice: { enabled, text } }, contentVersion: 1, products: [] },
    })));
    await renderLoginPage(false, '/login', 'acme.localhost');
    await screen.findByRole('heading', { name: en.auth.signInToTenant({ tenant: 'Acme' }) });
    if (visible) {
      const notice = screen.getByRole('note', { name: en.auth.signInNoticeLabel });
      expect(notice.textContent).toBe(text);
      expect(notice.querySelector('script')).toBeNull();
      expect(notice.compareDocumentPosition(screen.getByTestId('login-email')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } else {
      expect(screen.queryByTestId('sign-in-notice')).not.toBeInTheDocument();
    }
  });

  it.each(['identifier', 'methods'])('preserves the %s controls when the public notice arrives', async (step) => {
    let releaseOffer = () => {};
    const offerReady = new Promise<void>((resolve) => { releaseOffer = resolve; });
    server.use(http.get('*/api/public/offer', async () => {
      await offerReady;
      return HttpResponse.json({
        ok: true,
        data: {
          tenant: { slug: 'acme', name: 'Acme', signInNotice: { enabled: true, text: 'Welcome back.' } },
          contentVersion: 1,
          products: [],
        },
      });
    }));
    await renderLoginPage(false, '/login', 'acme.localhost', ['password', 'passkey', 'magic-link']);
    if (step === 'methods') {
      await continueWithEmail();
      await screen.findByTestId('use-password');
    }
    const content = screen.getByTestId('sign-in-content');
    const noticeSlot = screen.getByTestId('sign-in-notice-slot');
    const passkey = screen.getByTestId('signin-passkey');
    passkey.focus();
    releaseOffer();
    await screen.findByTestId('sign-in-notice');
    expect(screen.getByTestId('sign-in-content')).toBe(content);
    expect(screen.getByTestId('sign-in-notice-slot')).toBe(noticeSlot);
    expect(screen.getByTestId('signin-passkey')).toBe(passkey);
    expect(passkey).toHaveFocus();
  });

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
    await userEvent.click(await screen.findByTestId('use-password'));
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
      '/login?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1%23wiring',
    );
    await continueWithEmail();
    await userEvent.click(await screen.findByTestId('use-password'));
    await userEvent.type(await screen.findByLabelText(en.auth.passwordLabel), 'demo-password-15');
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/lesson-1'));
    expect(router.state.location.searchStr).toBe('?thread=t1');
    expect(router.state.location.hash).toBe('wiring');
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

  it.each([
    { step: 'identifier', providerCode: 'AUTH_CANCELLED' },
    { step: 'method', providerCode: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY' },
  ])('names a cancelled or missing passkey on the $step step', async ({ step, providerCode }) => {
    vi.spyOn(actions.signInWithPasskey, 'mutationFn').mockRejectedValue(
      new ApiError({ code: 'validation', message: 'Authentication cancelled', details: { providerCode } }),
    );
    await renderLoginPage();
    if (step === 'method') await continueWithEmail();

    await userEvent.click(await screen.findByTestId('signin-passkey'));

    const alert = await screen.findByTestId('passkey-error');
    expect(alert).toHaveTextContent(en.auth.passkeyCancelled);
    expect(alert).not.toHaveTextContent(en.errors.messageValidation);
  });

  it('reaches the cancelled-passkey copy through the real passkey client when the browser has no WebAuthn', async () => {
    server.use(http.get('*/passkey/generate-authenticate-options', () => HttpResponse.json({
      challenge: 'Y2hhbGxlbmdl',
      rpId: 'localhost',
      allowCredentials: [],
      userVerification: 'preferred',
    })));
    await renderLoginPage();

    await userEvent.click(await screen.findByTestId('signin-passkey'));

    expect(await screen.findByTestId('passkey-error')).toHaveTextContent(en.auth.passkeyCancelled);
  });

  it('keeps the generic copy for a passkey failure that is not a cancellation', async () => {
    vi.spyOn(actions.signInWithPasskey, 'mutationFn').mockRejectedValue(
      new ApiError({ code: 'internal', message: 'boom' }),
    );
    await renderLoginPage();

    await userEvent.click(await screen.findByTestId('signin-passkey'));

    expect(await screen.findByTestId('passkey-error')).toHaveTextContent(en.errors.messageInternal);
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

    const returnedWithHash = await renderLoginPage(
      false,
      '/login?verification=verified&returnTo=/my/courses/course-1/lessons/lesson-1#installation-notes',
      undefined,
      ['password'],
      [],
      staffMe(),
    );
    await waitFor(() => expect(returnedWithHash.router.state.location.pathname).toBe('/my/courses/course-1/lessons/lesson-1'));
    expect(returnedWithHash.router.state.location.hash).toBe('installation-notes');
    returnedWithHash.unmount();

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

    await userEvent.click(await screen.findByTestId('use-password'));
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

  it('puts the build stamp below the Powered by row, outside the sign-in actions', async () => {
    await renderLoginPage();

    const stamp = screen.getByTestId('build-stamp');
    const footer = screen.getByRole('contentinfo');
    expect(footer).toContainElement(stamp);
    expect(screen.getByRole('main')).not.toContainElement(stamp);
    expect(screen.getByTestId('auth-powered-by').compareDocumentPosition(stamp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    if (outcome === 'rate-limit') {
      stubSignInMethods(['magic-link']);
      await userEvent.click(await screen.findByTestId('sign-in-methods-retry'));
    }
    await screen.findByTestId('send-magic-link');
    expect(screen.getByTestId('continue-google')).toBeEnabled();
  });

  it('carries the entered email into the editable password-reset form', async () => {
    await renderLoginPage();
    await continueWithEmail('member+login@example.com');
    await userEvent.click(await screen.findByTestId('use-password'));
    await userEvent.click(await screen.findByTestId('forgot-password'));
    expect(await screen.findByTestId('forgot-password-email')).toHaveValue('member+login@example.com');
    await userEvent.clear(screen.getByTestId('forgot-password-email'));
    await userEvent.type(screen.getByTestId('forgot-password-email'), 'another@example.com');
    expect(screen.getByTestId('forgot-password-email')).toHaveValue('another@example.com');
  });

  it('lands on the method step with no panel open and opens the password panel on its card', async () => {
    await renderLoginPage();
    await continueWithEmail();

    const passwordCard = await screen.findByRole('button', { name: new RegExp(en.auth.methodPasswordTitle, 'u') });
    expect(passwordCard).toBe(screen.getByTestId('use-password'));
    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.activeElement?.getAttribute('type')).not.toBe('password');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: en.auth.methodTitle })).toHaveFocus());

    await userEvent.click(passwordCard);

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
    const change = within(pill).getByRole('button', { name: `${en.auth.changeIdentifierShort} ${en.auth.changeIdentifierSuffix}` });
    expect(change).toHaveStyle({ minHeight: '44px', minWidth: '44px', flexShrink: '0' });
    await userEvent.click(change);
    expect(await screen.findByTestId('login-email')).toHaveValue(email);
    expect(screen.queryByTestId('login-identity')).not.toBeInTheDocument();
  });

  it('leaves the expanded password card head inert instead of an empty button', async () => {
    await renderLoginPage();
    await continueWithEmail();
    await userEvent.click(await screen.findByTestId('use-password'));
    await screen.findByLabelText(en.auth.passwordLabel);

    const head = screen.getByTestId('use-password');
    expect(head).not.toHaveAttribute('role');
    expect(head).not.toHaveAttribute('tabindex');
    expect(
      screen.queryByRole('button', { name: new RegExp(en.auth.methodPasswordTitle, 'u') }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['password', 'passkey', 'magic-link'],
    ['password', 'magic-link'],
    ['passkey', 'magic-link'],
    ['magic-link'],
  ])('keeps every method available regardless of a legacy lookup response: %s', async (...methods) => {
    await renderLoginPage(false, '/login', undefined, methods);
    await continueWithEmail('nobody@example.com');
    expect(await screen.findByTestId('use-password')).toBeEnabled();
    expect(screen.queryByTestId('login-password')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-magic-link')).toBeEnabled();
    expect(screen.getByTestId('signin-passkey')).not.toHaveAttribute('aria-disabled');
    expect(screen.getByTestId('use-password')).not.toHaveAttribute('aria-disabled');
  });

  it.each([
    { language: 'en', t: en },
    { language: 'pl', t: pl },
  ] as const)('shows the same method step for a known and an unknown address in $language', async ({ language }) => {
    const methodStepFor = async (email: string, methods: readonly string[]) => {
      const view = await renderLoginPage(false, '/login', undefined, methods, [], anonymousMe(), null, language);
      await userEvent.clear(screen.getByTestId('login-email'));
      await userEvent.type(screen.getByTestId('login-email'), email);
      await userEvent.click(screen.getByTestId('login-continue'));
      await screen.findByTestId('use-password');
      await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'));
      const content = screen.getByTestId('sign-in-content');
      const layout = [...content.querySelectorAll('*')].map((element) => [
        element.tagName,
        element.getAttribute('data-testid'),
        element.getAttribute('type'),
        element.getAttribute('disabled'),
        element.getAttribute('aria-expanded'),
        element.children.length === 0 ? (element.textContent ?? '').replaceAll(email, '<email>') : null,
      ]);
      const focused = document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName;
      view.unmount();
      return { layout, focused };
    };

    const known = await methodStepFor('creator@together.dev', ['password', 'passkey', 'magic-link']);
    window.sessionStorage.clear();
    const unknown = await methodStepFor('crow.unknown@example.com', ['magic-link']);

    expect(unknown).toEqual(known);
    expect(known.layout.some(([, testId]) => testId === 'login-password')).toBe(false);
    expect(known.focused).toBe('H1');
  });

  it('offers password when reported, with the link card first', async () => {
    await renderLoginPage(false, '/login', undefined, ['password', 'magic-link']);
    await continueWithEmail();

    const cards = await screen.findAllByRole('listitem');
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining(en.auth.methodMagicLinkTitle),
      expect.stringContaining(en.auth.methodPasswordTitle),
      expect.stringContaining(en.auth.methodPasskeyTitle),
    ]);

    expect(screen.queryByLabelText(en.auth.passwordLabel)).not.toBeInTheDocument();
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

  it.each([
    { language: 'en', t: en },
    { language: 'pl', t: pl },
  ] as const)('names the change control starting with its visible word in $language', async ({ language, t }) => {
    await renderLoginPage(false, '/login', undefined, ['magic-link'], [], anonymousMe(), null, language);
    await userEvent.type(screen.getByTestId('login-email'), 'creator@together.dev');
    await userEvent.click(screen.getByTestId('login-continue'));

    const change = await screen.findByTestId('login-change-email');
    expect(change).not.toHaveAttribute('aria-label');
    expect(change).toHaveAccessibleName(`${t.auth.changeIdentifierShort} ${t.auth.changeIdentifierSuffix}`);
    expect(change.firstChild?.textContent).toBe(t.auth.changeIdentifierShort);
  });

  it('sizes every recovery link as a 14px underlined 44px target', async () => {
    server.use(http.post('*', ({ request }) => new URL(request.url).pathname.endsWith('/sign-in/email')
      ? HttpResponse.json({ twoFactorRedirect: true })
      : undefined));
    const expectRecoveryLink = (link: HTMLElement) => {
      const style = window.getComputedStyle(link);
      expect([link.dataset['testid'], style.fontSize, style.textDecorationLine, style.minHeight, style.minWidth]).toEqual([
        link.dataset['testid'], '0.875rem', 'underline', '44px', '44px',
      ]);
    };
    await renderLoginPage();

    expectRecoveryLink(screen.getByRole('link', { name: en.auth.registerLink }));
    await continueWithEmail();
    await userEvent.click(await screen.findByTestId('use-password'));
    expectRecoveryLink(await screen.findByRole('link', { name: en.auth.forgotPassword }));
    await userEvent.type(screen.getByTestId('login-password'), 'demo-password-15');
    await userEvent.click(screen.getByTestId('signin-submit'));
    expectRecoveryLink(await screen.findByRole('button', { name: en.auth.twoFactorBackToLogin }));
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
    await screen.findByTestId('use-password');
    first.unmount();

    expect(window.localStorage.getItem('together-login-identifier')).toBeNull();

    await renderLoginPage();

    expect(screen.getByLabelText(en.auth.emailLabel)).toHaveValue('creator@together.dev');
  });

  it('lands a failed lookup on the normal method step, the same for a known and an unknown address', async () => {
    const stepAfterFailedLookup = async (email: string) => {
      const view = await renderLoginPage();
      failSignInMethods();
      await continueWithEmail(email);
      await screen.findByTestId('use-password');
      const content = screen.getByTestId('sign-in-content');
      const layout = [...content.querySelectorAll('*')].map((element) => [
        element.tagName,
        element.getAttribute('data-testid'),
        element.getAttribute('disabled'),
        element.children.length === 0 ? (element.textContent ?? '').replaceAll(email, '<email>') : null,
      ]);
      const alerts = within(content).queryAllByRole('alert').length;
      view.unmount();
      return { layout, alerts };
    };

    const known = await stepAfterFailedLookup('creator@together.dev');
    window.sessionStorage.clear();
    const unknown = await stepAfterFailedLookup('crow.unknown@example.com');

    expect(unknown).toEqual(known);
    const testIds = known.layout.map(([, testId]) => testId);
    expect(testIds).toEqual(expect.arrayContaining(['send-magic-link', 'use-password', 'signin-passkey']));
    expect(testIds).not.toContain('sign-in-rate-limited');
    expect(known.alerts).toBe(0);
  });

  it('gives the rate limit its own screen with a heading and one primary action', async () => {
    await renderLoginPage();
    rateLimitSignInMethods();
    await continueWithEmail();

    const screenRoot = await screen.findByTestId('sign-in-rate-limited');
    const title = within(screenRoot).getByRole('heading', { level: 1, name: en.auth.signInRateLimitedTitle });
    await waitFor(() => expect(title).toHaveFocus());
    expect(within(screenRoot).getByTestId('login-identity')).toHaveTextContent('creator@together.dev');
    const buttons = within(screenRoot).getAllByRole('button');
    expect(buttons.filter((button) => button.classList.contains('MuiButton-contained'))).toEqual([
      within(screenRoot).getByTestId('sign-in-methods-retry'),
    ]);
    expect(screen.queryByTestId('send-magic-link')).not.toBeInTheDocument();
  });

  it.each([
    { language: 'en', t: en, seconds: 42, delay: '42 s' },
    { language: 'en', t: en, seconds: 60, delay: '1 min' },
    { language: 'en', t: en, seconds: 583, delay: '9 min 43 s' },
    { language: 'pl', t: pl, seconds: 42, delay: '42 s' },
    { language: 'pl', t: pl, seconds: 60, delay: '1 min' },
    { language: 'pl', t: pl, seconds: 583, delay: '9 min 43 s' },
  ] as const)('states a $seconds s lookup delay as $delay in $language', async ({ language, t, seconds, delay }) => {
    await renderLoginPage(false, '/login', undefined, ['password', 'magic-link'], [], anonymousMe(), null, language);
    rateLimitSignInMethods(seconds);
    await userEvent.type(screen.getByTestId('login-email'), 'creator@together.dev');
    await userEvent.click(screen.getByTestId('login-continue'));

    const message = await screen.findByTestId('sign-in-rate-limited-message');
    expect(within(message).getByTestId('rate-limit-countdown')).toHaveTextContent(t.auth.signInRateLimitedLeadRetryIn({ delay }));
    expect(message).not.toHaveTextContent(t.auth.signInRateLimitedTitle);
    expect(message).toHaveTextContent(delay);
    expect(screen.getByTestId('sign-in-methods-retry')).toBeDisabled();
  });

  it('ends a countdown that ran out while the tab was hidden as soon as the tab is shown again', async () => {
    await renderLoginPage();
    rateLimitSignInMethods(583);
    await continueWithEmail();
    expect(await screen.findByTestId('rate-limit-countdown')).toHaveTextContent('9 min 43 s');
    expect(screen.getByTestId('sign-in-methods-retry')).toBeDisabled();

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 584_000);
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(screen.getByTestId('sign-in-methods-retry')).toBeEnabled());
    expect(screen.queryByTestId('rate-limit-countdown')).not.toBeInTheDocument();
    expect(screen.getByTestId('sign-in-rate-limited-message')).toHaveTextContent(en.auth.signInRateLimitedRetryNow);
  });

  it('counts the lookup delay down and enables the retry when it ends', async () => {
    await renderLoginPage();
    rateLimitSignInMethods(1);
    await continueWithEmail();

    expect(await screen.findByTestId('rate-limit-countdown')).toHaveTextContent(
      en.auth.signInRateLimitedLeadRetryIn({ delay: '1 s' }),
    );
    expect(screen.getByTestId('sign-in-methods-retry')).toBeDisabled();

    await waitFor(() => expect(screen.getByTestId('sign-in-methods-retry')).toBeEnabled(), { timeout: 3000 });
    expect(screen.getByTestId('sign-in-rate-limited-message')).toHaveTextContent(en.auth.signInRateLimitedRetryNow);
  });

  it('states a rate limit without a delay when the resolver sends none', async () => {
    await renderLoginPage();
    rateLimitSignInMethods();
    await continueWithEmail();

    expect(await screen.findByTestId('sign-in-rate-limited-message')).toHaveTextContent(
      en.auth.signInRateLimitedLeadWait,
    );
    expect(screen.getByTestId('sign-in-methods-retry')).toBeEnabled();
  });

  it.each([
    { language: 'en', t: en },
    { language: 'pl', t: pl },
  ] as const)('holds the password submit until the rate-limit delay ends in $language', async ({ language, t }) => {
    server.use(http.post('*', () => HttpResponse.json(
      { ok: false, error: { code: 'rate_limited', message: 'Too many requests', details: { retryAfterSeconds: 1 } } },
      { status: 429 },
    )));
    await renderLoginPage(false, '/login', undefined, ['password', 'magic-link'], [], anonymousMe(), null, language);
    await userEvent.type(screen.getByTestId('login-email'), 'creator@together.dev');
    await userEvent.click(screen.getByTestId('login-continue'));
    await userEvent.click(await screen.findByTestId('use-password'));
    await userEvent.type(await screen.findByTestId('login-password'), 'some-password');
    await userEvent.click(screen.getByTestId('signin-submit'));

    expect(await screen.findByTestId('signin-error')).toHaveTextContent(t.auth.signInRateLimitedRetryIn({ delay: '1 s' }));
    expect(screen.getByTestId('signin-submit')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('signin-submit')).toBeEnabled(), { timeout: 3000 });
    expect(screen.getByTestId('signin-error')).toHaveTextContent(t.auth.signInRateLimitedRetryNow);
    expect(screen.getByTestId('signin-error')).not.toHaveTextContent(t.errors.messageRateLimited);
  });

  it('holds the sign-in link card until the rate-limit delay ends', async () => {
    server.use(http.post('*', ({ request }) => new URL(request.url).pathname.endsWith('/sign-in/magic-link')
      ? HttpResponse.json(
        { ok: false, error: { code: 'rate_limited', message: 'Too many requests', details: { retryAfterSeconds: 1 } } },
        { status: 429 },
      )
      : undefined));
    await renderLoginPage(false, '/login', undefined, ['magic-link']);
    await continueWithEmail();
    await userEvent.click(await screen.findByTestId('send-magic-link'));

    expect(await screen.findByTestId('magic-link-error')).toHaveTextContent(en.auth.signInRateLimitedRetryIn({ delay: '1 s' }));
    expect(screen.getByTestId('send-magic-link')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('send-magic-link')).toBeEnabled(), { timeout: 3000 });
    expect(screen.getByTestId('magic-link-error')).toHaveTextContent(en.auth.signInRateLimitedRetryNow);
    expect(screen.getByTestId('magic-link-error')).not.toHaveTextContent(en.errors.messageRateLimited);
  });

  it('shows the rate-limited link card as unavailable and keeps its countdown while the password card is open', async () => {
    server.use(http.post('*', ({ request }) => new URL(request.url).pathname.endsWith('/sign-in/magic-link')
      ? HttpResponse.json(
        { ok: false, error: { code: 'rate_limited', message: 'Too many requests', details: { retryAfterSeconds: 583 } } },
        { status: 429 },
      )
      : undefined));
    await renderLoginPage(false, '/login', undefined, ['password', 'magic-link']);
    await continueWithEmail();
    const linkCard = await screen.findByTestId('send-magic-link');
    const chevronOf = (card: HTMLElement) => card.querySelector('.AuthMethod-chevron');
    expect(window.getComputedStyle(linkCard).opacity).not.toBe('0.6');
    expect(window.getComputedStyle(chevronOf(linkCard) ?? linkCard).visibility).not.toBe('hidden');

    await userEvent.click(linkCard);

    expect(await screen.findByTestId('magic-link-error')).toHaveTextContent(en.auth.signInRateLimitedRetryIn({ delay: '9 min 43 s' }));
    expect(linkCard).toBeDisabled();
    expect(window.getComputedStyle(linkCard).opacity).toBe('0.6');
    expect(chevronOf(linkCard)).not.toBeNull();
    expect(window.getComputedStyle(chevronOf(linkCard) ?? linkCard).visibility).toBe('hidden');

    await userEvent.click(screen.getByTestId('use-password'));

    expect(await screen.findByLabelText(en.auth.passwordLabel)).toHaveFocus();
    expect(screen.getByTestId('magic-link-error')).toHaveTextContent(en.auth.signInRateLimitedRetryIn({ delay: '9 min 43 s' }));
    expect(screen.getByTestId('send-magic-link')).toBeDisabled();
  });

  it('opens the password step after a failed lookup', async () => {
    await renderLoginPage();
    failSignInMethods();
    await continueWithEmail();

    await userEvent.click(await screen.findByTestId('use-password'));

    expect(await screen.findByLabelText(en.auth.passwordLabel)).toBeInTheDocument();
    expect(screen.getByTestId('send-magic-link')).toBeEnabled();
    expect(screen.getByTestId('signin-passkey')).not.toHaveAttribute('aria-disabled');
  });

  it('retries a rate-limited lookup and lands on the method step', async () => {
    await renderLoginPage();
    rateLimitSignInMethods();
    await continueWithEmail();
    await screen.findByTestId('sign-in-rate-limited');
    stubSignInMethods(['password', 'magic-link']);

    await userEvent.click(screen.getByTestId('sign-in-methods-retry'));

    expect(await screen.findByTestId('use-password')).toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-rate-limited')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: en.auth.methodTitle })).toHaveFocus());
  });

  it('reuses the known password method when a later lookup for the same address fails', async () => {
    await renderLoginPage();
    await continueWithEmail();
    await screen.findByTestId('use-password');
    await userEvent.click(screen.getByTestId('login-change-email'));
    rateLimitSignInMethods();

    await userEvent.click(await screen.findByRole('button', { name: en.auth.identifierContinue }));

    expect(await screen.findByTestId('use-password')).toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-rate-limited')).not.toBeInTheDocument();
  });

  it('does not carry a known password method over to another address', async () => {
    await renderLoginPage();
    await continueWithEmail();
    await screen.findByTestId('use-password');
    await userEvent.click(screen.getByTestId('login-change-email'));
    await userEvent.clear(await screen.findByLabelText(en.auth.emailLabel));
    rateLimitSignInMethods();

    await continueWithEmail('someone-else@together.dev');

    expect(await screen.findByTestId('sign-in-rate-limited')).toBeInTheDocument();
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

      expect(await screen.findByTestId('use-password')).toBeInTheDocument();
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

  it('ignores a late sign-in link confirmation for an address the visitor already changed', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const answered: string[] = [];
    server.use(
      http.post('*', async ({ request }) => {
        if (!new URL(request.url).pathname.endsWith('/sign-in/magic-link')) return undefined;
        const body: unknown = await request.json();
        const recipient = typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string'
          ? body.email
          : '';
        if (recipient === 'first@example.com') await firstHeld;
        answered.push(recipient);
        return HttpResponse.json({ status: true });
      }),
    );
    const { queryClient } = await renderLoginPage(false, '/login', undefined, ['magic-link']);
    await continueWithEmail('first@example.com');
    await userEvent.click(await screen.findByTestId('send-magic-link'));
    await waitFor(() => expect(queryClient.isMutating()).toBe(1));

    await userEvent.click(screen.getByTestId('login-change-email'));
    await userEvent.clear(await screen.findByLabelText(en.auth.emailLabel));
    await continueWithEmail('second@example.com');
    await screen.findByTestId('send-magic-link');
    releaseFirst();
    await waitFor(() => expect(answered).toEqual(['first@example.com']));
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(screen.queryByTestId('magic-link-sent')).not.toBeInTheDocument();
    expect(screen.getByTestId('login-identity')).toHaveTextContent('second@example.com');

    await userEvent.click(screen.getByTestId('send-magic-link'));

    const sent = await screen.findByTestId('magic-link-sent');
    expect(answered).toEqual(['first@example.com', 'second@example.com']);
    expect(within(sent).getByTestId('login-identity')).toHaveTextContent('second@example.com');
    expect(sent).not.toHaveTextContent('first@example.com');
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

    const alert = (await screen.findByText(en.auth.invalidCredentials)).closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert).toHaveTextContent(en.auth.invalidCredentials);
    expect(alert).not.toHaveTextContent(en.errors.messageUnauthorized);
  });

  it.each([
    { status: 500, message: en.errors.messageInternal },
    { status: 429, message: en.errors.messageRateLimited },
    { status: 0, message: en.errors.messageUnknown },
  ])('preserves operational error copy for password failures with status $status', async ({ status, message }) => {
    server.use(http.post('*', () => status === 0
      ? HttpResponse.error()
      : HttpResponse.json({ message: 'Request failed' }, { status })));

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: en.auth.signInIdle }));

    expect(await screen.findByTestId('signin-error')).toHaveTextContent(message);
    expect(screen.getByTestId('signin-error')).not.toHaveTextContent(en.auth.invalidCredentials);
  });

  it('puts a rejected password under the field, the same for an unknown address', async () => {
    server.use(
      http.post('*', ({ request }) => new URL(request.url).pathname.endsWith('/sign-in/email')
        ? HttpResponse.json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, { status: 401 })
        : undefined),
    );
    const outcomeFor = async (email: string) => {
      const view = await renderLoginPage();
      await continueWithEmail(email);
      await userEvent.click(await screen.findByTestId('use-password'));
      const field = await screen.findByLabelText(en.auth.passwordLabel);
      await userEvent.type(field, 'wrong-password');
      await userEvent.click(screen.getByTestId('signin-submit'));

      const error = await screen.findByTestId('signin-error');
      const panel = screen.getByTestId('use-password').closest('li');
      expect(panel).toContainElement(error);
      expect(field.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(error.compareDocumentPosition(screen.getByTestId('signin-submit')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAttribute('aria-describedby', error.id);
      expect(field).toHaveAccessibleDescription(en.auth.invalidCredentials);
      await waitFor(() => expect(field).toHaveFocus());
      expect(field).toHaveProperty('selectionStart', 0);
      expect(field).toHaveProperty('selectionEnd', 'wrong-password'.length);
      const outcome = { text: error.textContent, alerts: screen.getAllByRole('alert').map((alert) => alert.textContent) };
      view.unmount();
      return outcome;
    };

    const known = await outcomeFor('creator@together.dev');
    window.sessionStorage.clear();
    const unknown = await outcomeFor('crow.unknown@example.com');

    expect(known.text).toBe(en.auth.invalidCredentials);
    expect(unknown).toEqual(known);
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
    await userEvent.click(await screen.findByTestId('two-factor-use-backup'));
    await userEvent.type(screen.getByLabelText(en.auth.twoFactorBackupCodeLabel), 'backup-once');
    await userEvent.click(screen.getByRole('button', { name: en.auth.twoFactorVerifyBackupCode }));

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
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAccessibleName(en.auth.twoFactorCodeLabel);
    expect(screen.getByTestId('two-factor-use-backup')).toBeEnabled();
    expect(screen.queryByTestId('verify-login-backup-code')).not.toBeInTheDocument();
    expect(screen.getByTestId('verify-login-totp')).toBeDisabled();
    expect(screen.queryByText(en.auth.registerPrompt)).not.toBeInTheDocument();
    expect(screen.queryByText(en.auth.demoAccount)).not.toBeInTheDocument();
  });

  const countSecondFactorCalls = () => {
    const calls: string[] = [];
    server.use(
      http.post('*', ({ request }) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith('/two-factor/verify-totp')) calls.push('totp');
        else if (path.endsWith('/two-factor/verify-backup-code')) calls.push('backup');
        else return undefined;
        return HttpResponse.json({ code: 'INVALID_CODE', message: 'provider text' }, { status: 401 });
      }),
    );
    return calls;
  };

  it('switches to the backup-code form without submitting anything', async () => {
    await reachTwoFactor();
    const calls = countSecondFactorCalls();
    await userEvent.type(screen.getByTestId('two-factor-code'), '123456');

    await userEvent.click(screen.getByTestId('two-factor-use-backup'));

    expect(calls).toEqual([]);
    const code = screen.getByTestId('two-factor-code');
    expect(code).toHaveAccessibleName(en.auth.twoFactorBackupCodeLabel);
    expect(code).toHaveAttribute('inputmode', 'text');
    expect(code).not.toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveValue('');
    expect(code).toHaveFocus();
    expect(screen.getByText(en.auth.twoFactorBackupIntro)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.auth.twoFactorVerifyBackupCode })).toBeDisabled();
    expect(screen.queryByTestId('verify-login-totp')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: en.auth.twoFactorUseAppCode }));

    expect(calls).toEqual([]);
    expect(screen.getByTestId('two-factor-code')).toHaveAccessibleName(en.auth.twoFactorCodeLabel);
    expect(screen.getByTestId('two-factor-code')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByTestId('verify-login-totp')).toHaveTextContent(en.auth.twoFactorVerifyTotp);
  });

  it('submits the active mode on Enter', async () => {
    await reachTwoFactor();
    const calls = countSecondFactorCalls();

    await userEvent.type(screen.getByTestId('two-factor-code'), '123456{Enter}');
    await waitFor(() => expect(calls).toEqual(['totp']));

    await userEvent.click(screen.getByTestId('two-factor-use-backup'));
    await userEvent.type(screen.getByTestId('two-factor-code'), 'backup-once{Enter}');
    await waitFor(() => expect(calls).toEqual(['totp', 'backup']));
  });

  it('shows one alert for the active mode and clears it on a mode change', async () => {
    await reachTwoFactor();
    countSecondFactorCalls();

    await userEvent.type(screen.getByTestId('two-factor-code'), '123456{Enter}');
    expect(await screen.findAllByTestId('two-factor-error')).toHaveLength(1);

    await userEvent.click(screen.getByTestId('two-factor-use-backup'));
    expect(screen.queryByTestId('two-factor-error')).not.toBeInTheDocument();

    await userEvent.type(screen.getByTestId('two-factor-code'), 'backup-once{Enter}');
    expect(await screen.findAllByTestId('two-factor-error')).toHaveLength(1);

    await userEvent.click(screen.getByTestId('two-factor-use-app'));
    expect(screen.queryByTestId('two-factor-error')).not.toBeInTheDocument();
  });

  it('drops the previous failure while a new attempt runs', async () => {
    await reachTwoFactor();
    countSecondFactorCalls();
    await userEvent.type(screen.getByTestId('two-factor-code'), '123456{Enter}');
    await screen.findByTestId('two-factor-error');
    server.use(
      http.post('*', async ({ request }) => {
        if (!new URL(request.url).pathname.endsWith('/two-factor/verify-totp')) return undefined;
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );

    await userEvent.type(screen.getByTestId('two-factor-code'), '{Enter}');

    expect(await screen.findByRole('button', { name: en.auth.twoFactorVerifying })).toBeDisabled();
    expect(screen.queryByTestId('two-factor-error')).not.toBeInTheDocument();
  });

  const answerSecondFactor = (path: string, code: string) =>
    server.use(
      http.post('*', ({ request }) =>
        new URL(request.url).pathname.endsWith(path)
          ? HttpResponse.json({ code, message: 'provider text' }, { status: 401 })
          : undefined,
      ),
    );

  it('names a wrong authenticator code on the field and selects it for retyping', async () => {
    await reachTwoFactor();
    answerSecondFactor('/two-factor/verify-totp', 'INVALID_CODE');

    const code = screen.getByTestId('two-factor-code');
    await userEvent.type(code, '654321');
    await userEvent.click(screen.getByTestId('verify-login-totp'));

    const alert = await screen.findByTestId('two-factor-error');
    expect(alert).toHaveTextContent(en.auth.twoFactorInvalidCode);
    expect(alert).not.toHaveTextContent(en.errors.messageUnauthorized);
    expect(alert).not.toHaveTextContent('654321');
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveAccessibleDescription(en.auth.twoFactorInvalidCode);
    expect(code).toHaveFocus();
    expect(code).toHaveProperty('selectionStart', 0);
    expect(code).toHaveProperty('selectionEnd', '654321'.length);
  });

  it('names a wrong backup code with the same invalid-code copy', async () => {
    await reachTwoFactor();
    answerSecondFactor('/two-factor/verify-backup-code', 'INVALID_BACKUP_CODE');

    await userEvent.click(screen.getByTestId('two-factor-use-backup'));
    await userEvent.type(screen.getByTestId('two-factor-code'), 'abcde-fghij');
    await userEvent.click(screen.getByTestId('verify-login-backup-code'));

    expect(await screen.findByTestId('two-factor-error')).toHaveTextContent(en.auth.twoFactorInvalidCode);
    expect(screen.getByTestId('two-factor-error')).not.toHaveTextContent('abcde-fghij');
  });

  it('keeps the session-ended copy for an expired challenge, not a wrong code', async () => {
    await reachTwoFactor();
    answerSecondFactor('/two-factor/verify-totp', 'INVALID_TWO_FACTOR_COOKIE');

    const code = screen.getByTestId('two-factor-code');
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByTestId('verify-login-totp'));

    const alert = await screen.findByTestId('two-factor-error');
    expect(alert).toHaveTextContent(en.errors.messageUnauthorized);
    expect(alert).not.toHaveTextContent(en.auth.twoFactorInvalidCode);
    expect(code).toHaveAttribute('aria-invalid', 'false');
    expect(code).toHaveAccessibleDescription(en.errors.messageUnauthorized);
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
      en.auth.magicLinkResendCooldown({ delay: '30 s' }),
    );

    await userEvent.click(screen.getByTestId('login-change-email'));

    expect(await screen.findByLabelText(en.auth.emailLabel)).toHaveValue('member@example.com');
    expect(screen.queryByTestId('magic-link-sent')).not.toBeInTheDocument();
  });

  it.each([
    { language: 'en', t: en },
    { language: 'pl', t: pl },
  ] as const)('confirms the sent link with the address, validity and a full-width resend in $language', async ({ language, t }) => {
    server.use(http.post('*', () => HttpResponse.json({ status: true })));

    await renderLoginPage(false, '/login', undefined, ['magic-link'], [], anonymousMe(), null, language);
    await userEvent.type(screen.getByTestId('login-email'), 'member@example.com');
    await userEvent.click(screen.getByTestId('login-continue'));
    await userEvent.click(await screen.findByTestId('send-magic-link'));

    const sent = await screen.findByTestId('magic-link-sent');
    const title = within(sent).getByRole('heading', { level: 1, name: t.auth.checkInboxTitle });
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(within(sent).getByTestId('login-identity')).toHaveTextContent('member@example.com');
    expect(within(sent).getAllByTestId('login-change-email')).toHaveLength(1);
    expect(within(sent).getByTestId('magic-link-sent-hint')).toHaveTextContent(
      t.auth.magicLinkSentHint({ minutes: MAGIC_LINK_TOKEN_EXPIRES_IN_SECONDS / 60 }),
    );
    expect(within(sent).getByTestId('magic-link-sent-hint')).toHaveTextContent(
      String(MAGIC_LINK_TOKEN_EXPIRES_IN_SECONDS / 60),
    );
    const resend = within(sent).getByRole('button', { name: t.auth.magicLinkResend });
    expect(resend).toHaveClass('MuiButton-outlined');
    expect(resend).toHaveClass('MuiButton-fullWidth');
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
    await screen.findByText(en.auth.invalidCredentials);

    await userEvent.click(screen.getByTestId('login-change-email'));
    await userEvent.click(await screen.findByRole('button', { name: en.auth.identifierContinue }));

    await userEvent.click(await screen.findByTestId('use-password'));
    expect(await screen.findByLabelText(en.auth.passwordLabel)).toHaveValue('');
    expect(screen.queryByText(en.auth.invalidCredentials)).not.toBeInTheDocument();
  });

  it('drops the expired-link marker once a new link is requested and keeps returnTo', async () => {
    let callbackURL: unknown = null;
    server.use(http.post('*', async ({ request }) => {
      if (new URL(request.url).pathname.endsWith('/sign-in/magic-link')) {
        const body: unknown = await request.json();
        callbackURL = typeof body === 'object' && body !== null ? Reflect.get(body, 'callbackURL') : null;
      }
      return HttpResponse.json({ status: true });
    }));
    const { router } = await renderLoginPage(
      false,
      '/login?error=INVALID_TOKEN&returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1',
      undefined,
      ['magic-link'],
    );
    await continueWithEmail('member@example.com');
    await userEvent.click(await screen.findByTestId('send-magic-link'));
    await screen.findByTestId('magic-link-sent');

    await waitFor(() => expect(router.state.location.search).toEqual({ returnTo: '/my/courses/course-1/lessons/lesson-1' }));
    expect(router.state.location.href).not.toContain('INVALID_TOKEN');
    expect(callbackURL).toBe(
      `${window.location.origin}/login?verification=verified&returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1`,
    );

    await userEvent.click(screen.getByTestId('login-change-email'));

    expect(await screen.findByLabelText(en.auth.emailLabel)).toHaveValue('member@example.com');
    expect(screen.queryByText(en.auth.magicLinkExpired)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.auth.identifierContinue }));
    expect(await screen.findByTestId('send-magic-link')).toBeInTheDocument();
    expect(screen.queryByTestId('magic-link-expired-step')).not.toBeInTheDocument();
  });

  it('tells the expired-link visitor which button sends a new link', async () => {
    await renderLoginPage(false, '/login?error=INVALID_TOKEN');
    await continueWithEmail();

    expect(await screen.findByTestId('magic-link-expired-step')).toHaveTextContent(en.auth.methodMagicLinkTitle);
    expect(screen.getByTestId('send-magic-link')).toHaveTextContent(en.auth.methodMagicLinkTitle);
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
