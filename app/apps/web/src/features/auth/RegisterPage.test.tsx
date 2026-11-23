import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

import { ToastProvider } from '../../components/ui/Toast.js';
import { en } from '../../i18n/en.js';
import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, memberMe, server } from '../../test/server.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { RegisterPage } from './RegisterPage.js';

const HomeAfterRegistration = () => <div>Home after registration</div>;
const VALID_PASSWORD = 'x'.repeat(PASSWORD_MIN_LENGTH);

const renderRegisterPage = async (hostname?: string, initialEntry = '/register', withLanguage = false) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomeAfterRegistration,
  });
  const registerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/register',
    component: () =>
      hostname === undefined ? <RegisterPage /> : <RegisterPage hostname={hostname} />,
  });
  const lessonRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/my/courses/$courseId/lessons/$lessonId',
    component: () => <div>Lesson target</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, registerRoute, lessonRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  const page = (
    <ThemeModeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeModeProvider>
  );
  return {
    ...renderWithProviders(withLanguage ? <LanguageProvider>{page}</LanguageProvider> : page),
    router,
  };
};

const tenantOffer = (legal: { termsUrl: string | null; privacyUrl: string | null }) => ({
  tenant: { slug: 'akademia', name: 'Akademia', legal },
  contentVersion: 1,
  products: [],
});

const noTenantOffer = http.get('/api/public/offer', () =>
  HttpResponse.json(
    { ok: false, error: { code: 'tenant_not_found', message: 'Unknown tenant' } },
    { status: 404 },
  ));

afterEach(() => vi.unstubAllEnvs());

const expectSecondaryLink = (link: HTMLElement) => {
  const style = window.getComputedStyle(link);
  expect([style.fontSize, style.textDecorationLine, style.minHeight, style.minWidth]).toEqual([
    '0.875rem', 'underline', '44px', '44px',
  ]);
  const row = link.closest('p');
  if (row === null) throw new Error('expected the link to sit in a paragraph');
  expect(window.getComputedStyle(row).marginTop).toBe('1.5rem');
};

describe('RegisterPage', () => {
  it('redirects a signed-in tenant member to home', async () => {
    server.use(memberMe());

    const view = await renderRegisterPage();

    expect(await screen.findByText('Home after registration')).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/');
  });

  it('sits on the auth shell, signed once with the Together wordmark', async () => {
    server.use(anonymousMe(), noTenantOffer);

    await renderRegisterPage();

    expect(screen.getByTestId('auth-together-logo')).toHaveAttribute('alt', en.common.appName);
    expect(screen.getAllByTestId('language-switcher')).toHaveLength(1);
  });

  it.each([
    ['configured base domain', 'togethercommunity.app'],
    ['derived start host', 'start.togethercommunity.app'],
  ])('keeps platform signup enabled on the %s without resolving a tenant', async (_surface, hostname) => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    let offerCalls = 0;
    server.use(
      anonymousMe(),
      http.get('/api/public/offer', () => {
        offerCalls += 1;
        return HttpResponse.json(
          { ok: false, error: { code: 'tenant_not_found', message: 'Unknown tenant' } },
          { status: 404 },
        );
      }),
    );

    await renderRegisterPage(hostname);

    expect(screen.getByRole('heading', { level: 1, name: en.auth.createAccount })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.auth.createAccount })).toBeEnabled();
    expect(offerCalls).toBe(0);
  });

  it('sizes the sign-in link as a 14px underlined 44px target after the form', async () => {
    server.use(anonymousMe(), noTenantOffer);

    await renderRegisterPage();

    expectSecondaryLink(screen.getByRole('link', { name: en.auth.signInLink }));
  });

  it('states the password minimum under the password field and describes the field with it', async () => {
    server.use(anonymousMe(), noTenantOffer);

    await renderRegisterPage();

    const hint = screen.getByText(en.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH }));
    expect(screen.getByLabelText(en.auth.passwordLabel)).toHaveAttribute('aria-describedby', hint.id);
  });

  it('reveals and hides the password with a pressed toggle that keeps the value and never submits', async () => {
    let requested = false;
    server.use(
      anonymousMe(),
      noTenantOffer,
      http.post('*', () => {
        requested = true;
        return HttpResponse.json({ user: { id: 'u1' } });
      }),
    );

    await renderRegisterPage();
    const password = screen.getByLabelText(en.auth.passwordLabel);
    const toggle = screen.getByRole('button', { name: en.auth.showPassword });
    await userEvent.type(password, VALID_PASSWORD);
    expect(password).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('aria-controls', password.id);
    expect(toggle).toHaveAttribute('type', 'button');

    await userEvent.click(toggle);

    expect(password).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName(en.auth.showPassword);
    expect(password).toHaveValue(VALID_PASSWORD);
    expect(password).toHaveAttribute('autocomplete', 'new-password');

    await userEvent.click(toggle);

    expect(password).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(password).toHaveValue(VALID_PASSWORD);
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.queryByText(en.auth.nameRequired)).not.toBeInTheDocument();
    expect(requested).toBe(false);
  });

  it('blocks a password below the shared minimum', async () => {
    let requested = false;
    server.use(
      anonymousMe(),
      noTenantOffer,
      http.post('*', () => {
        requested = true;
        return HttpResponse.json({ user: { id: 'u1' } });
      }),
    );

    await renderRegisterPage();
    await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'new@together.dev');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), 'short');
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    const error = await screen.findByText(en.auth.passwordTooShort({ min: PASSWORD_MIN_LENGTH }));
    const password = screen.getByLabelText(en.auth.passwordLabel);
    const hint = screen.getByText(en.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH }));
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAttribute('aria-describedby', `${error.id} ${hint.id}`);
    expect(password).toHaveFocus();
    expect(screen.queryByTestId('register-error')).not.toBeInTheDocument();
    expect(requested).toBe(false);
  });

  it('binds each empty field error to its field and focuses the first one', async () => {
    let requested = false;
    server.use(
      anonymousMe(),
      noTenantOffer,
      http.post('*', () => {
        requested = true;
        return HttpResponse.json({ user: { id: 'u1' } });
      }),
    );

    await renderRegisterPage();
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    for (const [label, message] of [
      [en.auth.nameLabel, en.auth.nameRequired],
      [en.auth.emailLabel, en.auth.emailRequired],
      [en.auth.passwordLabel, en.auth.passwordRequired],
    ] as const) {
      const field = screen.getByLabelText(label);
      const error = screen.getByText(message);
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
    }
    expect(screen.getByLabelText(en.auth.nameLabel)).toHaveFocus();
    expect(screen.queryByTestId('register-error')).not.toBeInTheDocument();
    expect(requested).toBe(false);
  });

  it.each(['new@together', 'a,b@example.com'])('names the malformed email %s under its field, focuses it and sends nothing', async (address) => {
    let requested = false;
    server.use(
      anonymousMe(),
      noTenantOffer,
      http.post('*', () => {
        requested = true;
        return HttpResponse.json({ user: { id: 'u1' } });
      }),
    );

    await renderRegisterPage();
    await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), address);
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    const email = screen.getByLabelText(en.auth.emailLabel);
    const error = await screen.findByText(en.auth.emailInvalid);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', error.id);
    expect(email).toHaveFocus();
    expect(screen.getByLabelText(en.auth.nameLabel)).toHaveAttribute('aria-invalid', 'false');
    expect(requested).toBe(false);
  });

  it('shows visible field errors in the language switched to after submit', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'localhost');
    server.use(
      anonymousMe(),
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: tenantOffer({ termsUrl: 'https://akademia.test/terms', privacyUrl: null }),
        })),
    );

    await renderRegisterPage('akademia.localhost', '/register', true);
    await screen.findByRole('checkbox');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'a,b@example.com');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), 'short');
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));
    expect(await screen.findByText(en.auth.nameRequired)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'pl' }));

    for (const [before, after] of [
      [en.auth.nameRequired, pl.auth.nameRequired],
      [en.auth.emailInvalid, pl.auth.emailInvalid],
      [en.auth.passwordTooShort({ min: PASSWORD_MIN_LENGTH }), pl.auth.passwordTooShort({ min: PASSWORD_MIN_LENGTH })],
      [en.consent.required, pl.consent.required],
    ] as const) {
      expect(screen.getByText(after)).toBeInTheDocument();
      expect(screen.queryByText(before)).not.toBeInTheDocument();
    }
  });

  it('keeps provider errors in the alert and drops them on the next submit', async () => {
    server.use(
      anonymousMe(),
      noTenantOffer,
      http.post('*', () =>
        HttpResponse.json({ code: 'SOME_PROVIDER_FAILURE', message: 'Failure' }, { status: 400 })),
    );

    await renderRegisterPage();
    await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'new@together.dev');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    expect(await screen.findByTestId('register-error')).toHaveTextContent(en.errors.messageValidation);
    expect(screen.getByLabelText(en.auth.passwordLabel)).toHaveAttribute('aria-invalid', 'false');

    await userEvent.clear(screen.getByLabelText(en.auth.passwordLabel));
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    expect(await screen.findByText(en.auth.passwordRequired)).toBeInTheDocument();
    expect(screen.queryByTestId('register-error')).not.toBeInTheDocument();
  });

  it('creates an account and lands on home', async () => {
    server.use(
      anonymousMe(),
      noTenantOffer,
      http.post('*', () => HttpResponse.json({ user: { id: 'u1' } })),
    );

    await renderRegisterPage();
    await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'new@together.dev');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    expect(await screen.findByText('Home after registration')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('tells the new member once, outside the address bar, where the confirmation link went', async () => {
    server.use(
      anonymousMe(),
      noTenantOffer,
      http.post('*', () => HttpResponse.json({ user: { id: 'u1' } })),
    );

    const view = await renderRegisterPage();
    await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), ' new@together.dev ');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    expect(await screen.findByText('Home after registration')).toBeInTheDocument();
    const notice = en.auth.signUpConfirmationSent({ email: 'new@together.dev' });
    expect(within(screen.getByTestId('toast-stack')).getAllByText(notice)).toHaveLength(1);
    expect(view.router.state.location.href).not.toContain('together.dev');
    expect(view.router.state.location.state).not.toHaveProperty('email');
  });

  it('accepts configured documents and lands on home when a tenant offer resolves on the bare host', async () => {
    server.use(
      anonymousMe(),
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: tenantOffer({
            termsUrl: 'https://akademia.test/terms',
            privacyUrl: 'https://akademia.test/privacy',
          }),
        }),
      ),
      http.post('*', () => HttpResponse.json({ user: { id: 'u1' } })),
    );

    await renderRegisterPage('localhost');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'new@together.dev');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    expect(await screen.findByText('Home after registration')).toBeInTheDocument();
  });

  it.each(['https://evil.example/x', '//evil.example/x', '/\\evil.example/x', '\\\\evil.example/x'])(
    'drops the unsafe returnTo %s and lands on home after sign-up',
    async (returnTo) => {
      const signupBodies: unknown[] = [];
      server.use(
        anonymousMe(),
        noTenantOffer,
        http.post('*', async ({ request }) => {
          signupBodies.push(await request.json());
          return HttpResponse.json({ user: { id: 'u1' } });
        }),
      );

      const view = await renderRegisterPage(undefined, `/register?${new URLSearchParams({ returnTo }).toString()}`);
      expect(screen.getByRole('link', { name: en.auth.signInLink })).toHaveAttribute('href', '/login');
      await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Creator');
      await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'new@together.dev');
      await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
      await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

      expect(await screen.findByText('Home after registration')).toBeInTheDocument();
      expect(view.router.state.location.href).toBe('/');
      expect(signupBodies).toMatchObject([{ callbackURL: 'http://localhost:3000/login?verification=verified' }]);
    },
  );

  it('preserves returnTo for verification and back-to-login links and lands on it', async () => {
    const signupBodies: unknown[] = [];
    server.use(
      anonymousMe(),
      noTenantOffer,
      http.post('*', async ({ request }) => {
        signupBodies.push(await request.json());
        return HttpResponse.json({ user: { id: 'u1' } });
      }),
    );

    const view = await renderRegisterPage(
      undefined,
      '/register?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
    );

    expect(screen.getByRole('link', { name: en.auth.signInLink })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
    );
    await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'new@together.dev');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    expect(await screen.findByText('Lesson target')).toBeInTheDocument();
    expect(view.router.state.location.href).toBe('/my/courses/course-1/lessons/lesson-1?thread=t1');
    expect(signupBodies).toEqual([
      {
        name: 'New Creator',
        email: 'new@together.dev',
        password: VALID_PASSWORD,
        callbackURL: 'http://localhost:3000/login?verification=verified&returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
      },
    ]);
  });

  it.each(['akademia.localhost', 'courses.example.org'])('requires accepting configured documents and submits consent with signup on %s', async (hostname) => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'localhost');
    const signupBodies: unknown[] = [];
    const signupLanguages: Array<string | null> = [];
    server.use(
      anonymousMe(),
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: tenantOffer({
            termsUrl: 'https://akademia.test/terms',
            privacyUrl: 'https://akademia.test/privacy',
          }),
        }),
      ),
      http.post('*', async ({ request }) => {
        signupBodies.push(await request.json());
        signupLanguages.push(request.headers.get('x-together-language'));
        return HttpResponse.json({ user: { id: 'u1' } });
      }),
    );

    await renderRegisterPage(hostname);

    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).toBeRequired();
    await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Member');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'member@together.dev');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));
    const consentError = await screen.findByText(en.consent.required);
    expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    expect(checkbox).toHaveAttribute('aria-describedby', consentError.id);
    expect(checkbox).toHaveFocus();
    expect(signupBodies).toEqual([]);
    const consentLabel = checkbox.closest('label');
    if (consentLabel === null) throw new Error('expected the checkbox to sit inside a label');
    const consentField = within(consentLabel);
    expect(consentField.getByRole('link', { name: en.consent.terms })).toHaveAttribute(
      'href',
      'https://akademia.test/terms',
    );
    expect(consentField.getByRole('link', { name: en.consent.privacy })).toHaveAttribute(
      'href',
      'https://akademia.test/privacy',
    );

    await userEvent.click(checkbox);
    expect(screen.queryByText(en.consent.required)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    expect(await screen.findByText(en.auth.registeredTitle)).toBeInTheDocument();
    expect(screen.getByTestId('register-confirmation-sent')).toHaveTextContent(
      en.auth.signUpConfirmationSent({ email: 'member@together.dev' }),
    );
    expect(signupBodies).toEqual([
      {
        name: 'New Member',
        email: 'member@together.dev',
        password: VALID_PASSWORD,
        callbackURL: 'http://localhost:3000/login?verification=verified',
        termsAccepted: true,
      },
    ]);
    expect(signupLanguages).toEqual([null]);
  });

  it('makes the sign-in link the primary action on a creator\'s domain and names the workspace', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'localhost');
    server.use(
      anonymousMe(),
      http.get('/api/public/offer', () =>
        HttpResponse.json({ ok: true, data: tenantOffer({ termsUrl: null, privacyUrl: null }) })),
      http.post('*', () => HttpResponse.json({ user: { id: 'u1' } })),
    );

    await renderRegisterPage(
      'akademia.localhost',
      '/register?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
    );
    await userEvent.type(await screen.findByLabelText(en.auth.nameLabel), 'New Member');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'member@together.dev');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    expect(await screen.findByRole('heading', { level: 1, name: en.auth.registeredTitle })).toBeInTheDocument();
    expect(screen.getByText(en.auth.registeredOnTenantBody({ workspace: 'Akademia' }))).toBeInTheDocument();
    const primary = screen.getByRole('link', { name: en.auth.registeredUseMagicLinkCta });
    expect(primary).toHaveClass('MuiButton-contained');
    expect(primary).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
    );
    const createOwn = screen.getByRole('link', { name: en.auth.registeredCreateOwnCta });
    expect(createOwn).not.toHaveClass('MuiButton-root');
    expect(createOwn).toHaveAttribute('href', 'http://localhost:3000');
    expectSecondaryLink(createOwn);
  });

  it('names the creator\'s domain by its host when the workspace name is unavailable', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'localhost');
    server.use(anonymousMe(), noTenantOffer, http.post('*', () => HttpResponse.json({ user: { id: 'u1' } })));

    await renderRegisterPage('courses.example.org');
    await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Member');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'member@together.dev');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
    await userEvent.click(await screen.findByRole('button', { name: en.auth.createAccount }));

    expect(await screen.findByText(en.auth.registeredOnTenantBody({ workspace: 'courses.example.org' }))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.auth.registeredUseMagicLinkCta })).toHaveAttribute('href', '/login');
  });

  it('shows no consent checkbox on a tenant without configured documents', async () => {
    server.use(
      anonymousMe(),
      http.get('/api/public/offer', () =>
        HttpResponse.json({ ok: true, data: tenantOffer({ termsUrl: null, privacyUrl: null }) }),
      ),
    );

    await renderRegisterPage();

    expect(await screen.findByLabelText(en.auth.nameLabel)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
