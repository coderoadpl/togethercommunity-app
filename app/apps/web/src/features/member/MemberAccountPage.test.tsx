import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { MemberAccountPage } from './MemberAccountPage.js';

const VALID_PASSWORD = 'x'.repeat(PASSWORD_MIN_LENGTH);

const stubMe = (emailVerified = true, tenant: Record<string, unknown> = {}) =>
  http.get('*/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'user-1',
        email: 'member@together.dev',
        name: 'Member',
        emailVerified,
        tenant: {
          id: 't1', slug: 'studio', name: 'Studio Demo', staffRole: null, memberId: 'm1', banned: false,
          ...tenant,
        },
      },
    }),
  );

const stubSettings = (billingPortalUrl: string | null, supportConfigured = false) =>
  http.get('*/api/tenant/settings', () =>
    HttpResponse.json({ ok: true, data: { settings: {
      name: 'Akademia', socialLinks: [], billingPortalUrl, bunnyStreamLibraryId: null, supportConfigured,
    } } }),
  );

const stubBillingOrders = (orders: unknown[] = []) =>
  http.get('*/api/me/billing-orders', () =>
    HttpResponse.json({ ok: true, data: { orders, total: orders.length, page: 1, pageSize: 25 } }),
  );

const stubErasureRequest = () =>
  http.get('*/api/me/erasure-request', () =>
    HttpResponse.json({ ok: true, data: { request: null } }),
  );

const renderAccount = async () => {
  server.use(
    stubErasureRequest(),
    http.get('*', ({ request }) =>
      new URL(request.url).pathname.endsWith('/passkey/list-user-passkeys')
        ? HttpResponse.json([])
        : undefined),
  );
  const rootRoute = createRootRoute({ component: MemberAccountPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/account'] }),
  });
  await router.load();
  return renderWithProviders(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
};

describe('MemberAccountPage', () => {
  it('mounts passkey and two-factor management on the member surface', async () => {
    server.use(stubMe(), stubSettings(null), stubBillingOrders());
    await renderAccount();

    expect(await screen.findByTestId('account-security-methods')).toBeInTheDocument();
    expect(await screen.findByTestId('passkeys-empty')).toHaveTextContent(pl.security.noPasskeys);
    expect(screen.getByTestId('regenerate-backup-codes')).toBeInTheDocument();
    expect(screen.getByTestId('disable-2fa')).toBeInTheDocument();
  });

  it('orders the sections from identity through security to the danger zone', async () => {
    server.use(
      stubMe(true, { displayName: 'Ada' }),
      stubSettings('https://billing.stripe.com/p/login/test_example', true),
      stubBillingOrders([{ id: 'order-1', createdAt: '1998-07-27T10:00:00.000Z', billing: null }]),
    );
    await renderAccount();

    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
        .toEqual([
          pl.account.profileHeading,
          pl.emailVerification.heading,
          pl.account.passwordHeading,
          pl.security.heading,
          pl.messages.privacyHeading,
          pl.account.preferencesHeading,
          pl.account.billingHeading,
          pl.account.invoiceOrdersHeading,
          pl.support.heading,
          pl.account.dataExportHeading,
          pl.account.erasureHeading,
        ]));
  });

  it('keeps the identity card above page-level fetch errors', async () => {
    server.use(
      stubMe(true, { displayName: 'Ada' }),
      stubSettings(null),
      http.get('*/api/me/billing-orders', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 })),
    );
    await renderAccount();

    const profile = await screen.findByRole('heading', { level: 2, name: pl.account.profileHeading });
    const retry = await screen.findByRole('button', { name: pl.common.retry });
    expect(profile.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeGreaterThan(0);
  });

  it('shows the signed-in address inside the profile card', async () => {
    server.use(stubMe(true, { displayName: 'Ada' }), stubSettings(null), stubBillingOrders());
    await renderAccount();

    const email = await screen.findByTestId('account-email');
    expect(email).toHaveTextContent('member@together.dev');
    expect(email.closest('form')).toContainElement(
      screen.getByLabelText(pl.account.displayNameLabel),
    );
    const caption = screen.getByText(pl.account.signedInAs);
    expect(caption.tagName).toBe('DT');
    expect(email.tagName).toBe('DD');
    expect(caption.parentElement).toBe(email.parentElement);
    expect(screen.queryByRole('heading', { level: 2, name: pl.account.signedInAs }))
      .not.toBeInTheDocument();
    expect(screen.getAllByText('member@together.dev')).toHaveLength(1);
  });

  it('describes the display-name field with its hint instead of the card', async () => {
    server.use(stubMe(true, { displayName: 'Ada' }), stubSettings(null), stubBillingOrders());
    await renderAccount();

    const field = await screen.findByLabelText(pl.account.displayNameLabel);
    expect(field).toHaveAccessibleDescription(pl.account.displayNameHint);
    const hint = screen.getByText(pl.account.displayNameHint);
    expect(field.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeGreaterThan(0);
  });

  it('shows the member verification state and resends without blocking the account', async () => {
    let body: unknown;
    server.use(
      stubMe(false),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );
    await renderAccount();

    expect(await screen.findByText(pl.emailVerification.pending({ email: 'member@together.dev' })))
      .toBeInTheDocument();
    expect(screen.getByTestId('account-data-export')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('resend-verification-email'));
    expect(await screen.findByText(pl.emailVerification.sent)).toBeInTheDocument();
    expect(body).toEqual({
      email: 'member@together.dev',
      callbackURL: 'http://localhost:3000/login?verification=verified',
    });
  });

  it('saves the community display name and confirms the write', async () => {
    let body: unknown;
    server.use(
      stubMe(true, { displayName: 'Ada' }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/profile', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, data: { displayName: 'Ada Lovelace' } });
      }),
    );
    await renderAccount();

    const input = await screen.findByLabelText(pl.account.displayNameLabel);
    expect(input).toHaveValue('Ada');
    const save = screen.getByTestId('account-display-name-save');
    expect(save).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'Ada Lovelace');
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(await screen.findByTestId('account-display-name-saved')).toHaveTextContent(
      pl.account.displayNameSaved,
    );
    expect(body).toEqual({ displayName: 'Ada Lovelace' });
  });

  it('toggles the direct-message opt-out without dropping the display name', async () => {
    let body: unknown;
    server.use(
      stubMe(true, { displayName: 'Ada', dmOptOut: false }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/profile', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, data: { displayName: 'Ada', dmOptOut: true } });
      }),
    );
    await renderAccount();

    const toggle = await screen.findByRole('switch', { name: pl.messages.optOutLabel });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);

    expect(await screen.findByTestId('account-dm-opt-out-saved')).toHaveTextContent(
      pl.messages.optOutSaved,
    );
    expect(body).toEqual({ displayName: 'Ada', dmOptOut: true });
  });

  it('reflects an active opt-out and hides the privacy card without a member row', async () => {
    server.use(
      stubMe(true, { dmOptOut: true }),
      stubSettings(null),
      stubBillingOrders(),
    );
    await renderAccount();

    expect(await screen.findByRole('switch', { name: pl.messages.optOutLabel })).toBeChecked();
  });

  it('hides the profile card for a staff identity without a member row', async () => {
    server.use(
      stubMe(true, { staffRole: 'owner', memberId: null }),
      stubSettings(null),
      stubBillingOrders(),
    );
    await renderAccount();

    expect(await screen.findByTestId('account-email')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: pl.account.signedInAs }))
      .toBeInTheDocument();
    expect(screen.queryByLabelText(pl.account.displayNameLabel)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: pl.messages.optOutLabel })).not.toBeInTheDocument();
  });

  it('hides the manage-payments link when no billing portal URL is set', async () => {
    server.use(stubMe(), stubSettings(null), stubBillingOrders());
    await renderAccount();

    expect(await screen.findByTestId('account-email')).toHaveTextContent('member@together.dev');
    await waitFor(() => expect(screen.queryByTestId('account-manage-payments')).not.toBeInTheDocument());
  });

  it('shows the manage-payments link pointing at the billing portal when set', async () => {
    server.use(stubMe(), stubSettings('https://billing.stripe.com/p/login/test_example'), stubBillingOrders());
    await renderAccount();

    const link = await screen.findByTestId('account-manage-payments');
    expect(link).toHaveAttribute('href', 'https://billing.stripe.com/p/login/test_example');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('keeps support submission inactive until both fields are filled and resets after success', async () => {
    let body: unknown;
    server.use(
      stubMe(),
      stubSettings(null, true),
      stubBillingOrders(),
      http.post('*/api/support/message', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, data: { queued: true } });
      }),
    );
    await renderAccount();

    const send = await screen.findByRole('button', { name: pl.support.send });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText(pl.support.subjectLabel), 'Problem z lekcją');
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText(pl.support.bodyLabel), 'Nie mogę uruchomić nagrania.');
    expect(send).toBeEnabled();
    await userEvent.click(send);

    expect(await screen.findByText(pl.support.sent)).toBeInTheDocument();
    expect(body).toEqual({ subject: 'Problem z lekcją', body: 'Nie mogę uruchomić nagrania.' });
    expect(screen.getByLabelText(pl.support.subjectLabel)).toHaveValue('');
    expect(screen.getByLabelText(pl.support.bodyLabel)).toHaveValue('');
    expect(send).toBeDisabled();
  });

  it('requests password setup from member passkey management', async () => {
    let body: unknown;
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );
    await renderAccount();

    await userEvent.click(await screen.findByTestId('passkey-set-password'));
    expect(await screen.findByTestId('passkey-password-setup-sent')).toHaveTextContent(
      pl.security.resetSent,
    );
    expect(body).toEqual({
      email: 'member@together.dev',
      redirectTo: 'http://localhost:3000/reset-password',
    });
  });

  it('changes the member password and sends the revocation choice', async () => {
    let body: unknown;
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );
    await renderAccount();

    await userEvent.type(await screen.findByTestId('change-current-password'), 'current-password');
    await userEvent.type(screen.getByTestId('change-new-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('change-confirm-password'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-success')).toHaveTextContent(
      pl.changePassword.success,
    );
    expect(body).toEqual({
      currentPassword: 'current-password',
      newPassword: VALID_PASSWORD,
      revokeOtherSessions: false,
    });
    expect(screen.getByTestId('account-reset-password')).toBeInTheDocument();
  });

  it('keeps the reset path available when the provider reports a passwordless account', async () => {
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', () =>
        HttpResponse.json(
          { code: 'CREDENTIAL_ACCOUNT_NOT_FOUND', message: 'Credential account not found' },
          { status: 400 },
        )),
    );
    await renderAccount();

    await userEvent.type(await screen.findByTestId('change-current-password'), 'current-password');
    await userEvent.type(screen.getByTestId('change-new-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('change-confirm-password'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-remote-error')).toHaveTextContent(
      pl.changePassword.credentialAccountMissing,
    );
    expect(screen.getByTestId('account-reset-password')).toBeInTheDocument();
  });

  it('downloads the authenticated member data export', async () => {
    let requested = false;
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.get('*/api/me/data-export', () => {
        requested = true;
        return HttpResponse.json({
          ok: true,
          data: {
            filename: 'moje-dane-studio-1998-07-29.json',
            mimeType: 'application/json; charset=utf-8',
            content: '{}',
          },
        });
      }),
    );
    const createObjectUrl = URL.createObjectURL;
    const revokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:member-export';
    URL.revokeObjectURL = () => undefined;
    await renderAccount();

    await userEvent.click(await screen.findByTestId('account-data-export'));
    await waitFor(() => expect(requested).toBe(true));
    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;
  });

  it('requires an exact e-mail confirmation before creating an erasure request', async () => {
    let requested = false;
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/erasure-request', () => {
        requested = true;
        return HttpResponse.json({
          ok: true,
          data: {
            request: {
              id: 'request-1',
              tenantId: 't1',
              memberId: 'm1',
              status: 'open',
              reason: null,
              requestedAt: '1998-07-29T10:00:00.000Z',
              dueAt: '1998-08-28T10:00:00.000Z',
              resolvedAt: null,
              resolvedByUserId: null,
              resolutionNote: null,
            },
          },
        });
      }),
    );
    await renderAccount();
    const button = await screen.findByTestId('account-erasure-create');
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveStyle({ display: 'block' });
    await userEvent.type(
      screen.getByLabelText(pl.account.erasureConfirmLabel),
      'member@together.dev',
    );
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(requested).toBe(true));
  });

  it('renders only the narrow billing-order projection', async () => {
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders([{
        id: 'order-1',
        createdAt: '1998-07-27T10:00:00.000Z',
        billing: {
          nip: '5555555555',
          companyName: 'Acme sp. z o.o.',
          address: 'Prosta 1',
          postalCode: '00-001',
          city: 'Warszawa',
          country: 'PL',
        },
      }]),
    );
    await renderAccount();
    expect(await screen.findByText('Acme sp. z o.o.')).toBeInTheDocument();
    expect(screen.getByText('5555555555')).toBeInTheDocument();
  });

  it('offers the authenticated own-PDF route for an issued invoice', async () => {
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders([{
        id: 'order-1',
        createdAt: '1998-07-28T10:00:00.000Z',
        billing: null,
        invoice: { id: 'invoice-1', status: 'issued', provider: 'ksef' },
      }]),
    );
    await renderAccount();

    const link = await screen.findByTestId('account-invoice-download-invoice-1');
    expect(link).toHaveAttribute('href', '/api/me/invoices/invoice-1/download');
  });
});
