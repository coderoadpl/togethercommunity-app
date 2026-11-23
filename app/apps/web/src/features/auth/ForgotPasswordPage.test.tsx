import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, memberMe, server } from '../../test/server.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { ForgotPasswordPage } from './ForgotPasswordPage.js';

const renderForgotPasswordPage = async (initialEntry = '/forgot-password', withLanguage = false) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div>Signed in home</div>,
  });
  const forgotPasswordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/forgot-password',
    component: ForgotPasswordPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, forgotPasswordRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  const page = (
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>
  );
  return renderWithProviders(withLanguage ? <LanguageProvider>{page}</LanguageProvider> : page);
};

const LESSON_RETURN_TO = '/my/courses/course-1/lessons/lesson-1?thread=t1';
const UNSAFE_RETURN_TO = ['https://evil.example/x', '//evil.example/x', '/\\evil.example/x', '\\\\evil.example/x'];

const expectSecondaryLink = (link: HTMLElement) => {
  const style = window.getComputedStyle(link);
  expect([style.fontSize, style.textDecorationLine, style.minHeight, style.minWidth]).toEqual([
    '0.875rem', 'underline', '44px', '44px',
  ]);
  const row = link.closest('p');
  if (row === null) throw new Error('expected the link to sit in a paragraph');
  expect(window.getComputedStyle(row).marginTop).toBe('1.5rem');
};

describe('ForgotPasswordPage', () => {
  it('sizes the back-to-sign-in link as a 14px underlined 44px target after the form', async () => {
    server.use(anonymousMe());

    await renderForgotPasswordPage();

    expectSecondaryLink(screen.getByRole('link', { name: en.forgotPassword.backToLogin }));
  });

  it('redirects a signed-in tenant member to home', async () => {
    server.use(memberMe());

    await renderForgotPasswordPage();

    expect(await screen.findByText('Signed in home')).toBeInTheDocument();
  });

  it.each([
    { address: '', before: en.forgotPassword.emailRequired, after: pl.forgotPassword.emailRequired },
    { address: 'a,b@example.com', before: en.forgotPassword.invalidEmail, after: pl.forgotPassword.invalidEmail },
  ])('shows the visible email error for "$address" in the language switched to after submit', async ({ address, before, after }) => {
    server.use(anonymousMe());
    await renderForgotPasswordPage('/forgot-password', true);

    if (address !== '') await userEvent.type(screen.getByTestId('forgot-password-email'), address);
    await userEvent.click(screen.getByTestId('forgot-password-submit'));
    expect(await screen.findByTestId('forgot-password-email-error')).toHaveTextContent(before);

    await userEvent.click(screen.getByRole('button', { name: 'pl' }));

    expect(screen.getByTestId('forgot-password-email-error')).toHaveTextContent(after);
  });

  it('sits on the auth shell, signed once with the Together wordmark', async () => {
    server.use(anonymousMe());

    await renderForgotPasswordPage();

    expect(screen.getByTestId('auth-together-logo')).toHaveAttribute('alt', en.common.appName);
    expect(screen.getAllByTestId('language-switcher')).toHaveLength(1);
  });

  it.each(['known@example.com', 'random-unknown@example.com'])(
    'shows the same neutral success for %s',
    async (email) => {
      let body: unknown;
      server.use(http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          status: true,
          message: 'If this email exists in our system, check your email for the reset link',
        });
      }));
      server.use(anonymousMe());
      await renderForgotPasswordPage();

      await userEvent.type(screen.getByTestId('forgot-password-email'), email);
      await userEvent.click(screen.getByTestId('forgot-password-submit'));

      expect(await screen.findByTestId('forgot-password-success')).toHaveTextContent(
        en.forgotPassword.successBody({ email }),
      );
      expect(body).toEqual({
        email,
        redirectTo: 'http://localhost:3000/reset-password',
      });
    },
  );

  it('renders an identical outcome for a known and an unknown address', async () => {
    server.use(anonymousMe(), http.post('*', () => HttpResponse.json({ status: true })));
    const outcomes: string[] = [];
    for (const email of ['known@example.com', 'random-unknown@example.com']) {
      const view = await renderForgotPasswordPage();
      await userEvent.type(screen.getByTestId('forgot-password-email'), email);
      await userEvent.click(screen.getByTestId('forgot-password-submit'));
      outcomes.push((await screen.findByTestId('forgot-password-success')).outerHTML.replaceAll(email, '{email}'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      view.unmount();
    }

    expect(outcomes[0]).toBe(outcomes[1]);
  });

  it('keeps a safe returnTo on the reset link the provider sends', async () => {
    let body: unknown;
    server.use(anonymousMe(), http.post('*', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ status: true });
    }));
    await renderForgotPasswordPage(`/forgot-password?${new URLSearchParams({ returnTo: LESSON_RETURN_TO }).toString()}`);

    await userEvent.type(screen.getByTestId('forgot-password-email'), 'member@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-submit'));
    await screen.findByTestId('forgot-password-success');

    expect(body).toMatchObject({
      redirectTo: 'http://localhost:3000/reset-password?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
    });
  });

  it.each(UNSAFE_RETURN_TO)('drops the unsafe returnTo %s from the provider reset link and the sign-in link', async (returnTo) => {
    let body: unknown;
    server.use(anonymousMe(), http.post('*', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ status: true });
    }));
    await renderForgotPasswordPage(`/forgot-password?${new URLSearchParams({ returnTo }).toString()}`);

    expect(screen.getByRole('link', { name: en.forgotPassword.backToLogin })).toHaveAttribute('href', '/login');
    await userEvent.type(screen.getByTestId('forgot-password-email'), 'member@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-submit'));
    await screen.findByTestId('forgot-password-success');

    expect(body).toMatchObject({ redirectTo: 'http://localhost:3000/reset-password' });
  });

  it('names the submitted address, focuses the heading and returns to the prefilled form on request', async () => {
    let requests = 0;
    server.use(anonymousMe(), http.post('*', () => {
      requests += 1;
      return HttpResponse.json({ status: true });
    }));
    await renderForgotPasswordPage();
    await userEvent.type(screen.getByTestId('forgot-password-email'), 'member@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-submit'));

    const heading = await screen.findByRole('heading', { level: 1, name: en.forgotPassword.successTitle });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
    expect(screen.getByTestId('forgot-password-success')).toHaveTextContent(
      en.forgotPassword.successBody({ email: 'member@example.com' }),
    );

    await userEvent.click(screen.getByRole('button', { name: en.forgotPassword.useDifferentAddress }));

    const email = screen.getByTestId('forgot-password-email');
    expect(email).toHaveValue('member@example.com');
    expect(email).toHaveFocus();
    expect(screen.queryByTestId('forgot-password-success')).not.toBeInTheDocument();
    expect(requests).toBe(1);
  });

  it('prefills a deep-linked email and submits the edited address', async () => {
    let body: unknown;
    server.use(anonymousMe(), http.post('*', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ status: true });
    }));
    await renderForgotPasswordPage('/forgot-password?email=member%2Breset%40example.com');
    const email = screen.getByTestId('forgot-password-email');
    expect(email).toHaveValue('member+reset@example.com');
    await userEvent.clear(email);
    await userEvent.type(email, 'edited@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-submit'));
    await screen.findByTestId('forgot-password-success');
    expect(body).toMatchObject({ email: 'edited@example.com' });
  });

  it.each([
    ['an empty', '', en.forgotPassword.emailRequired],
    ['a malformed', 'not-an-email', en.forgotPassword.invalidEmail],
  ])('binds %s email error to the field and focuses it without requesting a reset', async (_case, typed, message) => {
    let requested = false;
    server.use(anonymousMe(), http.post('*', () => {
      requested = true;
      return HttpResponse.json({ status: true });
    }));
    await renderForgotPasswordPage();
    const email = screen.getByTestId('forgot-password-email');
    if (typed !== '') await userEvent.type(email, typed);
    await userEvent.click(screen.getByTestId('forgot-password-submit'));

    const error = await screen.findByTestId('forgot-password-email-error');
    expect(error).toHaveTextContent(message);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', error.id);
    expect(email).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(requested).toBe(false);
  });

  it('clears the field error once the address is edited', async () => {
    server.use(anonymousMe());
    await renderForgotPasswordPage();
    await userEvent.click(screen.getByTestId('forgot-password-submit'));
    expect(await screen.findByTestId('forgot-password-email-error')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('forgot-password-email'), 'm');

    expect(screen.queryByTestId('forgot-password-email-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('forgot-password-email')).toHaveAttribute('aria-invalid', 'false');
  });

  it('disables submission while the provider request is pending', async () => {
    server.use(http.post('*', async () => {
      await delay('infinite');
      return HttpResponse.json({ status: true });
    }));
    server.use(anonymousMe());
    await renderForgotPasswordPage();

    await userEvent.type(screen.getByTestId('forgot-password-email'), 'member@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-submit'));

    expect(await screen.findByRole('button', { name: en.forgotPassword.submitPending })).toBeDisabled();
  });

  it('shows a localized provider error and keeps the form available', async () => {
    server.use(http.post('*', () =>
      HttpResponse.json({ code: 'RESET_PASSWORD_DISABLED', message: 'Unavailable' }, { status: 400 })));
    server.use(anonymousMe());
    await renderForgotPasswordPage();

    await userEvent.type(screen.getByTestId('forgot-password-email'), 'member@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.messageValidation);
    expect(screen.getByTestId('forgot-password-email')).toBeInTheDocument();
    expect(screen.getByTestId('forgot-password-email')).toHaveAttribute('aria-invalid', 'false');
  });

  it('drops a previous provider error when the form is submitted again', async () => {
    server.use(http.post('*', () =>
      HttpResponse.json({ code: 'RESET_PASSWORD_DISABLED', message: 'Unavailable' }, { status: 400 })));
    server.use(anonymousMe());
    await renderForgotPasswordPage();
    const email = screen.getByTestId('forgot-password-email');
    await userEvent.type(email, 'member@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-submit'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.clear(email);
    await userEvent.click(screen.getByTestId('forgot-password-submit'));

    expect(await screen.findByTestId('forgot-password-email-error')).toHaveTextContent(en.forgotPassword.emailRequired);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
