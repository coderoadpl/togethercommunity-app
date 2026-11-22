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

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, memberMe, server } from '../../test/server.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { RegisterPage } from './RegisterPage.js';

const HomeAfterRegistration = () => <div>Home after registration</div>;
const VALID_PASSWORD = 'x'.repeat(PASSWORD_MIN_LENGTH);

const renderRegisterPage = async (hostname?: string, initialEntry = '/register') => {
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
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, registerRoute]),
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

  it('states the password minimum under the password field and describes the field with it', async () => {
    server.use(anonymousMe(), noTenantOffer);

    await renderRegisterPage();

    const hint = screen.getByText(en.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH }));
    expect(screen.getByLabelText(en.auth.passwordLabel)).toHaveAttribute('aria-describedby', hint.id);
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

  it('names a malformed email under its field and focuses it', async () => {
    server.use(anonymousMe(), noTenantOffer);

    await renderRegisterPage();
    await userEvent.type(screen.getByLabelText(en.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'new@together');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), VALID_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: en.auth.createAccount }));

    const email = screen.getByLabelText(en.auth.emailLabel);
    const error = await screen.findByText(en.auth.emailInvalid);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', error.id);
    expect(email).toHaveFocus();
    expect(screen.getByLabelText(en.auth.nameLabel)).toHaveAttribute('aria-invalid', 'false');
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

  it('preserves returnTo for verification and back-to-login links', async () => {
    const signupBodies: unknown[] = [];
    server.use(
      anonymousMe(),
      noTenantOffer,
      http.post('*', async ({ request }) => {
        signupBodies.push(await request.json());
        return HttpResponse.json({ user: { id: 'u1' } });
      }),
    );

    await renderRegisterPage(
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

    expect(await screen.findByText('Home after registration')).toBeInTheDocument();
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
