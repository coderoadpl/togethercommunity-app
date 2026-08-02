import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { MemberAccountPage } from './MemberAccountPage.js';

const stubMe = () =>
  http.get('*/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'user-1',
        email: 'member@together.dev',
        name: 'Member',
        tenant: { id: 't1', slug: 'studio', name: 'Studio Demo', staffRole: null, memberId: 'm1', banned: false },
      },
    }),
  );

const stubSettings = (billingPortalUrl: string | null) =>
  http.get('*/api/tenant/settings', () =>
    HttpResponse.json({ ok: true, data: { settings: { billingPortalUrl, bunnyStreamLibraryId: null } } }),
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
  server.use(stubErasureRequest());
  const rootRoute = createRootRoute({ component: MemberAccountPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/account'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('MemberAccountPage', () => {
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

  it('requests a password reset email', async () => {
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

    await userEvent.click(await screen.findByTestId('account-reset-password'));
    expect(await screen.findByTestId('account-reset-sent')).toHaveTextContent(pl.account.resetSent);
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
    await userEvent.type(screen.getByTestId('change-new-password'), 'new-password');
    await userEvent.type(screen.getByTestId('change-confirm-password'), 'new-password');
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-success')).toHaveTextContent(
      pl.changePassword.success,
    );
    expect(body).toEqual({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
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
    await userEvent.type(screen.getByTestId('change-new-password'), 'new-password');
    await userEvent.type(screen.getByTestId('change-confirm-password'), 'new-password');
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
            filename: 'moje-dane-studio-2026-07-29.json',
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
              requestedAt: '2026-07-29T10:00:00.000Z',
              dueAt: '2026-08-28T10:00:00.000Z',
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
        createdAt: '2026-07-27T10:00:00.000Z',
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
        createdAt: '2026-07-28T10:00:00.000Z',
        billing: null,
        invoice: { id: 'invoice-1', status: 'issued', provider: 'ksef' },
      }]),
    );
    await renderAccount();

    const link = await screen.findByTestId('account-invoice-download-invoice-1');
    expect(link).toHaveAttribute('href', '/api/me/invoices/invoice-1/download');
  });
});
