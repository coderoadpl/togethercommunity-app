import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

import { ToastProvider } from '../../components/ui/Toast.js';
import { en } from '../../i18n/en.js';
import { readLessonTextAutoExpand } from './lesson-reading-preference.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { MemberAccountPage } from './MemberAccountPage.js';

const VALID_PASSWORD = 'x'.repeat(PASSWORD_MIN_LENGTH);

const stubMe = (
  emailVerified = true,
  tenant: Record<string, unknown> = {},
  impersonation: unknown = null,
  avatarUrl: string | null = null,
  security: { hasPassword?: boolean; twoFactorEnabled?: boolean } = {},
) =>
  http.get('*/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'user-1',
        email: 'member@together.dev',
        name: 'Member',
        emailVerified,
        hasPassword: security.hasPassword ?? true,
        twoFactorEnabled: security.twoFactorEnabled ?? false,
        avatarUrl,
        tenant: {
          id: 't1', slug: 'studio', name: 'Studio Demo', staffRole: null, memberId: 'm1', banned: false,
          ...tenant,
        },
        impersonation,
      },
    }),
  );

const stubSettings = (
  billingPortalUrl: string | null,
  supportConfigured = false,
  memberVideoAutoplayOverride = false,
  videoAutoplayDefault = false,
  supportUrl: string | null = null,
) =>
  http.get('*/api/member/settings', () =>
    HttpResponse.json({ ok: true, data: { settings: {
      billingPortalUrl, supportUrl, supportConfigured,
      memberVideoAutoplayOverride,
      videoAutoplayDefault,
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

const renderAccount = async (initialEntry = '/account', passkeys: unknown[] = []) => {
  server.use(
    stubErasureRequest(),
    http.get('*', ({ request }) =>
      new URL(request.url).pathname.endsWith('/passkey/list-user-passkeys')
        ? HttpResponse.json(passkeys)
        : undefined),
  );
  const rootRoute = createRootRoute({ component: MemberAccountPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return renderWithProviders(
    <ThemeModeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeModeProvider>,
  );
};

const findToast = async (kind: 'success' | 'error') =>
  screen.findByTestId(new RegExp(`^toast-${kind}-`));

const successToasts = () => screen.queryAllByTestId(/^toast-success-/);

const errorToasts = () => screen.queryAllByTestId(/^toast-error-/);

const dismissToasts = async () => {
  for (
    let [button] = screen.queryAllByTestId(/^toast-dismiss-/);
    button !== undefined;
    [button] = screen.queryAllByTestId(/^toast-dismiss-/)
  ) {
    await userEvent.click(button);
  }
};

const attestation = new Uint8Array([1, 2, 3, 4]).buffer;

const stubWebAuthnRegistration = () => {
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {
      create: () => Promise.resolve({
        id: 'credential-1',
        rawId: attestation,
        type: 'public-key',
        authenticatorAttachment: 'platform',
        response: { attestationObject: attestation, clientDataJSON: attestation },
        getClientExtensionResults: () => ({}),
      }),
    },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'PublicKeyCredential');
  Reflect.deleteProperty(navigator, 'credentials');
});

describe('MemberAccountPage', () => {
  it('marks every tab svg as the tab icon so the phone rule hides it, narrows the tabs and fades the scroll edge instead of showing chevrons', async () => {
    server.use(stubMe(), stubSettings(null), stubBillingOrders());
    await renderAccount('/account?tab=notifications');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.id)).toEqual(['account-tab-profile', 'account-tab-security', 'account-tab-notifications', 'account-tab-playback']);
    for (const tab of tabs) {
      const icons = tab.querySelectorAll('svg');
      expect(icons).toHaveLength(1);
      expect(icons[0]).toHaveClass('MuiTab-icon');
      expect(getComputedStyle(icons[0] ?? tab).marginRight).toBe('0px');
    }
    const rootClass = tabs[0]?.closest('.MuiTabs-root')?.className.split(' ').find((name) => name.startsWith('css-'));
    expect(rootClass).toBeDefined();
    const phoneRules = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.media.mediaText.replace(/\s/gu, '').includes('max-width:599.95px'))
      .flatMap((rule) => Array.from(rule.cssRules))
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText.startsWith(`.${rootClass ?? ''} `));
    const phoneRule = (suffix: string) => phoneRules.find((rule) => rule.selectorText.endsWith(suffix))?.style;
    expect(phoneRule('.MuiTab-icon')?.display).toBe('none');
    expect(phoneRule('.MuiTab-root')?.minWidth).toBe('0px');
    expect(phoneRule('.MuiTab-root')?.paddingLeft).toBe('10px');
    expect(phoneRule('.MuiTabScrollButton-root svg')?.display).toBe('none');
    expect(phoneRule('.MuiTabScrollButton-root:last-of-type')?.background).toContain('linear-gradient');
  });

  it('mounts passkey and two-factor management on the member surface', async () => {
    server.use(stubMe(), stubSettings(null), stubBillingOrders());
    await renderAccount('/account?tab=security');
    for (const tab of await screen.findAllByRole('tab')) {
      expect(tab.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(tab).toHaveAccessibleName();
    }


    expect(await screen.findByTestId('account-security-methods')).toBeInTheDocument();
    expect(await screen.findByTestId('passkeys-empty')).toHaveTextContent(en.security.noPasskeys);
    expect(screen.getByTestId('enable-2fa-open')).toBeInTheDocument();
    expect(screen.queryByTestId('two-factor-manage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('enable-2fa-password')).not.toBeInTheDocument();
  });

  it('does not replay the two-factor success toast after switching account tabs', async () => {
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', async ({ request }) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith('/two-factor/enable')) {
          return HttpResponse.json({
            totpURI: 'otpauth://totp/Together:member@example.com?secret=DEMO&issuer=Together',
            backupCodes: ['demo-code'],
          });
        }
        if (path.endsWith('/two-factor/verify-totp')) return HttpResponse.json({ token: null });
        return HttpResponse.json({ status: true });
      }),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('enable-2fa-open'));
    await userEvent.type(screen.getByTestId('enable-2fa-password'), 'fresh-password');
    await userEvent.click(screen.getByTestId('enable-2fa'));
    await userEvent.click(await screen.findByTestId('two-factor-next'));
    await userEvent.type(screen.getByTestId('verify-totp-code'), '123456');

    expect(await findToast('success')).toHaveTextContent(en.security.twoFactorOn);
    expect(successToasts()).toHaveLength(1);
    await userEvent.click(screen.getByLabelText(en.security.backupCodesSaved));
    await userEvent.click(screen.getByTestId('two-factor-finish'));
    await userEvent.click(screen.getByTestId('two-factor-done-close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await dismissToasts();

    await userEvent.click(screen.getByRole('tab', { name: en.account.tabs.profile }));
    expect(screen.queryByTestId('account-security-methods')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: en.account.tabs.security }));
    await userEvent.click(screen.getByRole('tab', { name: en.account.tabs.preferences }));
    await userEvent.click(screen.getByRole('tab', { name: en.account.tabs.security }));
    expect(await screen.findByTestId('account-security-methods')).toBeInTheDocument();

    expect(successToasts()).toHaveLength(0);
  });

  it('keeps the verification toast from replaying and the two-factor failure inside its dialog', async () => {
    server.use(
      stubMe(false),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', ({ request }) =>
        new URL(request.url).pathname.endsWith('/two-factor/enable')
          ? HttpResponse.json({ message: 'Invalid password' }, { status: 401 })
          : HttpResponse.json({ status: true })),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('resend-verification-email'));
    expect(await findToast('success')).toHaveTextContent(en.emailVerification.sent);

    await userEvent.click(screen.getByTestId('enable-2fa-open'));
    await userEvent.type(screen.getByTestId('enable-2fa-password'), 'wrong-password');
    await userEvent.click(screen.getByTestId('enable-2fa'));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toBeVisible();
    expect(errorToasts()).toHaveLength(0);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await dismissToasts();

    await userEvent.click(screen.getByRole('tab', { name: en.account.tabs.profile }));
    expect(screen.queryByTestId('account-security-methods')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: en.account.tabs.security }));
    expect(await screen.findByTestId('account-security-methods')).toBeInTheDocument();

    expect(successToasts()).toHaveLength(0);
    expect(errorToasts()).toHaveLength(0);
  });

  it('adds a passkey and confirms it with a toast', async () => {
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.get('*/passkey/generate-register-options', () => HttpResponse.json({
        challenge: 'Y2hhbGxlbmdl',
        rp: { id: 'localhost', name: 'Together' },
        user: { id: 'dXNlci0x', name: 'member@together.dev', displayName: 'Member' },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      })),
      http.post('*', () => HttpResponse.json({ status: true })),
    );
    stubWebAuthnRegistration();
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('add-passkey-open'));
    await userEvent.type(screen.getByTestId('passkey-proof-password'), 'account-password');
    await userEvent.click(screen.getByTestId('add-passkey'));

    expect(await findToast('success')).toHaveTextContent(en.security.passkeyAdded);
  });

  it('confirms a removed passkey with a toast', async () => {
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', () => HttpResponse.json({ status: true })),
    );
    await renderAccount('/account?tab=security', [
      { id: 'passkey-1', name: 'Laptop', createdAt: '2026-08-01T00:00:00.000Z' },
    ]);

    await userEvent.click(await screen.findByRole('button', { name: en.security.removePasskey }));
    await userEvent.type(screen.getByTestId('remove-passkey-proof-password'), 'account-password');
    await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(await findToast('success')).toHaveTextContent(en.security.passkeyRemoved);
  });

  it('confirms regenerated backup codes with a toast', async () => {
    server.use(
      stubMe(true, {}, null, null, { twoFactorEnabled: true }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', () => HttpResponse.json({ backupCodes: ['fresh-code'] })),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('regenerate-backup-codes'));
    await userEvent.type(screen.getByTestId('enable-2fa-password'), 'account-password');
    await userEvent.click(screen.getByTestId('regenerate-backup-codes-confirm'));

    expect(await findToast('success')).toHaveTextContent(en.security.backupCodesRegenerated);
  });

  it('asks before closing regenerated backup codes that are not marked as saved', async () => {
    server.use(
      stubMe(true, {}, null, null, { twoFactorEnabled: true }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', () => HttpResponse.json({ backupCodes: ['fresh-code'] })),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('regenerate-backup-codes'));
    await userEvent.type(screen.getByTestId('enable-2fa-password'), 'account-password');
    await userEvent.click(screen.getByTestId('regenerate-backup-codes-confirm'));
    const dialogCloseButton = async () => {
      const [close] = within(await screen.findByRole('dialog')).getAllByRole('button', { name: en.common.close });
      if (close === undefined) throw new Error('dialog close button missing');
      return close;
    };
    await screen.findByTestId('backup-codes');

    await userEvent.click(await dialogCloseButton());
    const leave = await screen.findByTestId('two-factor-leave-dialog');
    expect(within(leave).getByText(en.security.leaveWithoutCodesTitle)).toBeVisible();
    await userEvent.click(within(leave).getByRole('button', { name: en.security.leaveWithoutCodesCancel }));
    await waitFor(() => expect(screen.queryByTestId('two-factor-leave-dialog')).not.toBeInTheDocument());
    expect(screen.getByText('fresh-code')).toBeVisible();

    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(await screen.findByTestId('two-factor-leave-dialog')).getByTestId('two-factor-leave-confirm'));
    await waitFor(() => expect(screen.queryByTestId('backup-codes')).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId('regenerate-backup-codes'));
    await userEvent.type(screen.getByTestId('enable-2fa-password'), 'account-password');
    await userEvent.click(screen.getByTestId('regenerate-backup-codes-confirm'));
    await userEvent.click(await screen.findByRole('checkbox', { name: en.security.backupCodesSaved }));
    await userEvent.click(await dialogCloseButton());
    await waitFor(() => expect(screen.queryByTestId('backup-codes')).not.toBeInTheDocument());
    expect(screen.queryByTestId('two-factor-leave-dialog')).not.toBeInTheDocument();
  });

  it('confirms a two-factor disable with a toast', async () => {
    server.use(
      stubMe(true, {}, null, null, { twoFactorEnabled: true }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', () => HttpResponse.json({ status: true })),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('disable-2fa-open'));
    await userEvent.type(screen.getByTestId('enable-2fa-password'), 'account-password');
    await userEvent.click(screen.getByTestId('disable-2fa'));

    expect(await findToast('success')).toHaveTextContent(en.security.twoFactorOff);
  });

  it('renders accessible tabs and keeps profile as the default deep-link target', async () => {
    server.use(
      stubMe(true, { displayName: 'Ada' }),
      stubSettings('https://billing.stripe.com/p/login/test_example', true),
      stubBillingOrders([{ id: 'order-1', createdAt: '1998-07-27T10:00:00.000Z', billing: null }]),
    );
    await renderAccount();

    const profileTab = await screen.findByRole('tab', { name: en.account.tabs.profile });
    expect(profileTab).toHaveAttribute('aria-selected', 'true');
    expect(profileTab).toHaveAttribute('aria-controls', 'account-panel-profile');
    expect(screen.getByRole('tablist', { name: en.account.tabsLabel })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'account-panel-profile');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'account-tab-profile');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
    expect(screen.queryByRole('heading', { name: en.security.heading })).not.toBeInTheDocument();
  });

  it('names the third tab Preferences and keeps the notifications deep link working', async () => {
    server.use(stubMe(), stubSettings(null), stubBillingOrders());
    await renderAccount('/account?tab=notifications');

    const preferencesTab = await screen.findByRole('tab', { name: en.account.tabs.preferences });
    expect(preferencesTab).toHaveAttribute('aria-selected', 'true');
    expect(preferencesTab).toHaveAttribute('id', 'account-tab-notifications');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'account-panel-notifications');
    expect(screen.getByRole('heading', { name: en.account.languageHeading })).toBeInTheDocument();
  });

  it('keeps the identity card above page-level fetch errors', async () => {
    server.use(
      stubMe(true, { displayName: 'Ada' }),
      stubSettings(null),
      http.get('*/api/me/billing-orders', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 })),
    );
    await renderAccount();

    const profile = await screen.findByRole('heading', { level: 2, name: en.account.profileHeading });
    const retry = await screen.findByRole('button', { name: en.common.retry });
    expect(profile.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeGreaterThan(0);
  });

  it('shows the signed-in address inside the profile card', async () => {
    server.use(stubMe(true, { displayName: 'Ada' }), stubSettings(null), stubBillingOrders());
    await renderAccount();

    const email = await screen.findByTestId('account-email');
    expect(email).toHaveTextContent('member@together.dev');
    expect(email.closest('.MuiPaper-root')).toContainElement(screen.getByTestId('account-name-open'));
    expect(screen.queryByLabelText(en.account.displayNameLabel)).not.toBeInTheDocument();
    const caption = screen.getByText(en.account.signedInAs);
    expect(caption.tagName).toBe('DT');
    expect(email.tagName).toBe('DD');
    expect(caption.parentElement).toBe(email.parentElement);
    expect(screen.queryByRole('heading', { level: 2, name: en.account.signedInAs }))
      .not.toBeInTheDocument();
    expect(screen.getAllByText('member@together.dev')).toHaveLength(1);
    const divider = screen.getByTestId('account-profile-divider');
    expect(screen.getByRole('button', { name: en.account.avatarUpload }).compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(screen.getByTestId('account-display-name-value')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('account-display-name-value')).toHaveTextContent('Ada');
  });

  it('describes the display-name field with its hint instead of the card', async () => {
    server.use(stubMe(true, { displayName: 'Ada' }), stubSettings(null), stubBillingOrders());
    await renderAccount();

    await userEvent.click(await screen.findByTestId('account-name-open'));
    const field = await screen.findByLabelText(en.account.displayNameLabel);
    expect(field).toHaveAccessibleDescription(en.account.displayNameHint);
    const hint = screen.getByText(en.account.displayNameHint);
    expect(field.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeGreaterThan(0);
  });

  it('uploads an avatar through the presigned image pipeline', async () => {
    const requests: string[] = [];
    server.use(
      stubMe(true, { displayName: 'Ada' }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/avatar/upload', async ({ request }) => {
        requests.push('begin');
        expect(await request.json()).toEqual({
          kind: 'avatar',
          fileName: 'avatar.png',
          contentType: 'image/png',
          sizeBytes: 6,
        });
        return HttpResponse.json({ ok: true, data: {
          key: 'image-assets/t1/avatar/00000000-0000-4000-8000-000000000001.png',
          servePath: '/api/public/assets/avatar/00000000-0000-4000-8000-000000000001.png',
          upload: {
            url: 'https://storage.example.test/avatar-upload',
            headers: { 'content-type': 'image/png' },
            expiresAt: '2026-09-07T12:15:00.000Z',
          },
        } });
      }),
      http.put('https://storage.example.test/avatar-upload', () => {
        requests.push('put');
        return new HttpResponse(null, { status: 200 });
      }),
      http.post('*/api/me/avatar/complete', async ({ request }) => {
        requests.push('complete');
        expect(await request.json()).toEqual({
          key: 'image-assets/t1/avatar/00000000-0000-4000-8000-000000000001.png',
        });
        return HttpResponse.json({ ok: true, data: {
          url: '/api/public/assets/avatar/00000000-0000-4000-8000-000000000001.webp',
        } });
      }),
    );
    await renderAccount();

    await userEvent.upload(
      await screen.findByLabelText(en.account.avatarUpload),
      new File(['avatar'], 'avatar.png', { type: 'image/png' }),
    );

    await waitFor(() => expect(requests).toEqual(['begin', 'put', 'complete']));
  });

  it('rejects an oversized avatar before starting an upload', async () => {
    let requests = 0;
    server.use(
      stubMe(true, { displayName: 'Ada' }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/avatar/upload', () => {
        requests += 1;
        return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'unexpected' } });
      }),
    );
    await renderAccount();

    await userEvent.upload(
      await screen.findByLabelText(en.account.avatarUpload),
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' }),
    );

    expect(await screen.findByText(en.account.avatarTooLarge)).toBeInTheDocument();
    expect(requests).toBe(0);
  });

  it('names the accepted image types when the picked file type is unsupported', async () => {
    let requests = 0;
    server.use(
      stubMe(true, { displayName: 'Ada' }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/avatar/upload', () => {
        requests += 1;
        return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'unexpected' } });
      }),
    );
    await renderAccount();

    const input = await screen.findByLabelText(en.account.avatarUpload);
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
    await userEvent.setup({ applyAccept: false }).upload(input, new File(['gif'], 'avatar.gif', { type: 'image/gif' }));

    expect(await screen.findByText(en.account.avatarUnsupportedType)).toBeInTheDocument();
    expect(requests).toBe(0);
  });

  it('removes a stored avatar and returns to initials', async () => {
    let removed = false;
    server.use(
      stubMe(true, { displayName: 'Ada' }, null, '/api/public/assets/avatar/avatar.webp'),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/avatar/remove', () => {
        removed = true;
        return HttpResponse.json({ ok: true, data: { removed: true } });
      }),
    );
    await renderAccount();

    await userEvent.click(await screen.findByRole('button', { name: en.account.avatarRemove }));

    await waitFor(() => expect(removed).toBe(true));
  });

  it('opens the security deep link and updates tab semantics', async () => {
    server.use(stubMe(), stubSettings(null), stubBillingOrders());
    await renderAccount('/account?tab=security');

    const securityTab = await screen.findByRole('tab', { name: en.account.tabs.security });
    expect(securityTab).toHaveAttribute('aria-selected', 'true');
    expect(securityTab).toHaveAttribute('aria-controls', 'account-panel-security');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'account-panel-security');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'account-tab-security');
    expect(screen.getByTestId('account-security-methods')).toBeInTheDocument();
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
    await renderAccount('/account?tab=security');

    expect(await screen.findByText(en.emailVerification.pending({ email: 'member@together.dev' })))
      .toBeInTheDocument();
    expect(screen.queryByTestId('account-data-export')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('resend-verification-email'));
    expect(await findToast('success')).toHaveTextContent(en.emailVerification.sent);
    expect(body).toEqual({
      email: 'member@together.dev',
      callbackURL: 'http://localhost:3000/login?verification=verified',
    });
  });

  it.each(['close', 'escape'])('discards a cancelled name draft through %s across tab switches', async (dismiss) => {
    server.use(stubMe(true, { displayName: 'Ada' }), stubSettings(null), stubBillingOrders());
    await renderAccount();
    await userEvent.click(await screen.findByTestId('account-name-open'));
    const input = screen.getByLabelText(en.account.displayNameLabel);
    await userEvent.clear(input);
    await userEvent.type(input, 'Discarded name');
    expect(screen.getByText('Ada')).toBeInTheDocument();
    if (dismiss === 'escape') await userEvent.keyboard('{Escape}');
    else await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Ada')).toBeVisible();
    expect(screen.queryByText('Discarded name')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: en.account.tabs.preferences }));
    await userEvent.click(screen.getByRole('tab', { name: en.account.tabs.profile }));
    await userEvent.click(screen.getByTestId('account-name-open'));
    expect(screen.getByLabelText(en.account.displayNameLabel)).toHaveValue('Ada');
    expect(screen.getByTestId('account-display-name-save')).toBeDisabled();
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

    await userEvent.click(await screen.findByTestId('account-name-open'));
    const input = await screen.findByLabelText(en.account.displayNameLabel);
    expect(input).toHaveValue('Ada');
    const save = screen.getByTestId('account-display-name-save');
    expect(save).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'Ada Lovelace');
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(await findToast('success')).toHaveTextContent(
      en.account.displayNameSaved,
    );
    expect(body).toEqual({ displayName: 'Ada Lovelace' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByTestId('account-name-open'));
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('reports a failed display-name save only inside the dialog', async () => {
    server.use(
      stubMe(true, { displayName: 'Ada' }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/profile', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'unexpected' } }, { status: 500 })),
    );
    await renderAccount();

    await userEvent.click(await screen.findByTestId('account-name-open'));
    const input = await screen.findByLabelText(en.account.displayNameLabel);
    await userEvent.type(input, ' Lovelace');
    await userEvent.click(screen.getByTestId('account-display-name-save'));

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toBeVisible();
    expect(errorToasts()).toHaveLength(0);
  });

  it('reports a failed password change only inside the dialog', async () => {
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', () => HttpResponse.json({ code: 'INVALID_PASSWORD', message: 'Invalid password' }, { status: 400 })),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('change-password-open'));
    await userEvent.type(await screen.findByTestId('change-current-password'), 'wrong-password');
    await userEvent.type(screen.getByTestId('change-new-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('change-confirm-password'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await within(screen.getByRole('dialog')).findByTestId('change-password-remote-error')).toBeVisible();
    expect(errorToasts()).toHaveLength(0);
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
    await renderAccount('/account?tab=notifications');

    const toggle = await screen.findByRole('switch', { name: en.messages.optOutLabel });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);

    expect(await findToast('success')).toHaveTextContent(
      en.messages.optOutSaved,
    );
    expect(body).toEqual({ dmOptOut: true });
  });

  it('turns video autoplay on from the playback section and leaves it off by default', async () => {
    let body: unknown;
    server.use(
      stubMe(true, { displayName: 'Ada' }),
      stubSettings(null, false, true),
      stubBillingOrders(),
      http.post('*/api/me/profile', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          ok: true,
          data: { displayName: 'Ada', dmOptOut: false, language: null, videoAutoplay: true },
        });
      }),
    );
    await renderAccount('/account?tab=playback');

    const toggle = await screen.findByRole('switch', { name: en.account.videoAutoplayLabel });
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    for (const tab of screen.getAllByRole('tab')) expect(tab.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);

    expect(await findToast('success')).toHaveTextContent(
      en.account.videoAutoplaySaved,
    );
    expect(body).toEqual({ videoAutoplay: true });
  });

  it('reflects a stored video autoplay preference and hides playback without a member row', async () => {
    server.use(stubMe(true, { videoAutoplay: true }), stubSettings(null, false, true), stubBillingOrders());
    const { unmount } = await renderAccount('/account?tab=playback');
    expect(await screen.findByRole('switch', { name: en.account.videoAutoplayLabel })).toBeChecked();
    unmount();

    server.use(
      stubMe(true, { videoAutoplay: true, memberId: null }),
      stubSettings(null, false, true),
      stubBillingOrders(),
    );
    await renderAccount('/account?tab=playback');
    await screen.findByTestId('account-email');
    expect(screen.queryByTestId('account-playback')).not.toBeInTheDocument();
  });

  it('keeps lesson text preferences available when the creator disallows overriding autoplay', async () => {
    server.use(stubMe(true, { videoAutoplay: true }), stubSettings(null), stubBillingOrders());
    await renderAccount('/account?tab=playback');

    expect(await screen.findByTestId('account-lesson-reading')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.account.lessonTextAutoExpandLabel })).toBeInTheDocument();
    expect(screen.queryByTestId('account-playback')).not.toBeInTheDocument();
    expect(screen.queryByText(en.account.playbackIntro)).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: en.account.lessonTextAutoExpandLabel })).not.toBeChecked();
    expect(screen.queryByRole('switch', { name: en.account.videoAutoplayLabel })).not.toBeInTheDocument();
  });

  it('remembers the lesson text preference in this browser for the next mount without updating the profile', async () => {
    let profileUpdates = 0;
    server.use(
      stubMe(),
      stubSettings(null, false, true),
      stubBillingOrders(),
      http.post('*/api/me/profile', () => {
        profileUpdates += 1;
        return HttpResponse.json({ ok: true, data: {} });
      }),
    );
    const { unmount } = await renderAccount('/account?tab=playback');
    const toggle = await screen.findByRole('switch', { name: en.account.lessonTextAutoExpandLabel });

    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(en.account.lessonTextAutoExpandHint);
    await userEvent.click(toggle);
    expect(readLessonTextAutoExpand()).toBe(true);
    expect(window.localStorage.getItem('together-lesson-text-auto-expand')).toBe('true');
    unmount();

    await renderAccount('/account?tab=playback');
    const rememberedToggle = await screen.findByRole('switch', { name: en.account.lessonTextAutoExpandLabel });
    expect(rememberedToggle).toBeChecked();
    await userEvent.click(rememberedToggle);
    expect(readLessonTextAutoExpand()).toBe(false);
    expect(window.localStorage.getItem('together-lesson-text-auto-expand')).toBe('false');
    expect(profileUpdates).toBe(0);
  });

  it('hides playback without a member row even when the creator allows overrides', async () => {
    server.use(
      stubMe(true, { staffRole: 'owner', memberId: null }),
      stubSettings(null, false, true),
      stubBillingOrders(),
    );
    await renderAccount('/account?tab=playback');

    expect(screen.queryByTestId('account-playback')).not.toBeInTheDocument();
  });

  it('reflects the tenant default before the member chooses an override', async () => {
    server.use(stubMe(true, { videoAutoplay: null }), stubSettings(null, false, true, true), stubBillingOrders());
    await renderAccount('/account?tab=playback');

    expect(await screen.findByRole('switch', { name: en.account.videoAutoplayLabel })).toBeChecked();
  });

  it('stores the picked e-mail language and states the stored one', async () => {
    let body: unknown;
    server.use(
      stubMe(true, { displayName: 'Ada', language: 'pl' }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/profile', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, data: { displayName: 'Ada', language: 'en' } });
      }),
    );
    await renderAccount('/account?tab=notifications');

    expect(await screen.findByTestId('member-email-language')).toHaveTextContent(
      en.account.emailLanguage.pl,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'pl' }));

    await waitFor(() => expect(body).toEqual({ language: 'pl' }));
  });

  it('names the platform default when the member has no stored e-mail language', async () => {
    server.use(stubMe(true, { displayName: 'Ada' }), stubSettings(null), stubBillingOrders());
    await renderAccount('/account?tab=notifications');

    expect(await screen.findByTestId('member-email-language')).toHaveTextContent(
      en.account.emailLanguage.unset,
    );
    expect(screen.queryByTestId('member-email-language-reset')).not.toBeInTheDocument();
  });

  it('clears the stored e-mail language back to the platform default', async () => {
    let body: unknown;
    server.use(
      stubMe(true, { displayName: 'Ada', language: 'en' }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/profile', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, data: { displayName: 'Ada', language: null } });
      }),
    );
    await renderAccount('/account?tab=notifications');

    await userEvent.click(await screen.findByTestId('member-email-language-reset'));

    await waitFor(() => expect(body).toEqual({ language: null }));
  });

  it('surfaces a failed e-mail language write', async () => {
    server.use(
      stubMe(true, { displayName: 'Ada', language: 'pl' }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/profile', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 })),
    );
    await renderAccount('/account?tab=notifications');

    await userEvent.click(await screen.findByRole('button', { name: 'pl' }));

    expect(await screen.findByTestId('email-language-error')).toBeInTheDocument();
  });

  it('states that the picker only changes the panel language without a member row', async () => {
    let posted = false;
    server.use(
      stubMe(true, { staffRole: 'owner', memberId: null }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*/api/me/profile', () => {
        posted = true;
        return HttpResponse.json({ ok: true, data: { displayName: null, language: 'en' } });
      }),
    );
    await renderAccount('/account?tab=notifications');

    await userEvent.click(await screen.findByRole('button', { name: 'en' }));

    expect(await screen.findByRole('tooltip'))
      .toHaveTextContent(en.account.emailLanguage.panelOnly);
    expect(posted).toBe(false);
  });

  it('reflects an active opt-out and hides the privacy card without a member row', async () => {
    server.use(
      stubMe(true, { dmOptOut: true }),
      stubSettings(null),
      stubBillingOrders(),
    );
    await renderAccount('/account?tab=notifications');

    expect(await screen.findByRole('switch', { name: en.messages.optOutLabel })).toBeChecked();
  });

  it('hides the profile card for a staff identity without a member row', async () => {
    server.use(
      stubMe(true, { staffRole: 'owner', memberId: null }),
      stubSettings(null),
      stubBillingOrders(),
    );
    await renderAccount();

    expect(await screen.findByTestId('account-email')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: en.account.signedInAs }))
      .toBeInTheDocument();
    expect(screen.queryByLabelText(en.account.displayNameLabel)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: en.messages.optOutLabel })).not.toBeInTheDocument();
  });

  it('hides the direct-message privacy switch and the personal-data export while viewing as a member', async () => {
    let sessionCalls = 0;
    server.use(
      http.get('*/api/me/sessions', () => {
        sessionCalls += 1;
        return HttpResponse.json({ ok: true, data: { sessions: [] } });
      }),
      stubMe(true, {}, {
        id: 'imp-1',
        subjectMemberId: 'm1',
        subjectName: 'Member',
        actorName: 'Owner',
        expiresAt: '2026-09-03T11:00:00.000Z',
      }),
      stubSettings(null),
      stubBillingOrders(),
    );
    await renderAccount();

    expect(await screen.findByTestId('account-email')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: en.messages.optOutLabel })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: en.messages.privacyHeading }))
      .not.toBeInTheDocument();
    expect(screen.queryByTestId('account-data-export')).not.toBeInTheDocument();
    expect(sessionCalls).toBe(0);
  });

  it('omits security while impersonating and redirects its deep link to the profile panel', async () => {
    server.use(
      stubMe(true, {}, {
        id: 'imp-2',
        subjectMemberId: 'm1',
        subjectName: 'Member',
        actorName: 'Owner',
        expiresAt: '2026-09-03T11:00:00.000Z',
      }),
      stubSettings(null),
      stubBillingOrders(),
    );
    await renderAccount('/account?tab=security');

    expect(await screen.findByRole('tabpanel')).toHaveAttribute('id', 'account-panel-profile');
    expect(screen.queryByRole('tab', { name: en.account.tabs.security })).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-security-methods')).not.toBeInTheDocument();
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
    expect(link).toHaveClass('MuiButton-outlined');
    expect(screen.getByRole('heading', { name: en.account.billingHeading }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('heading', { name: en.account.dataExportHeading }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('heading', { name: en.support.heading }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the external support link available through member settings', async () => {
    server.use(stubMe(), stubSettings(null, false, false, false, 'https://example.test/help'), stubBillingOrders());
    await renderAccount();

    const link = await screen.findByRole('link', { name: en.support.externalLink });
    expect(link).toHaveAttribute('href', 'https://example.test/help');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByTestId('account-support')).toContainElement(link);
    expect(screen.queryByTestId('account-support-open')).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-support-not-configured')).not.toBeInTheDocument();
  });

  it('keeps the support form and the external link in one support card', async () => {
    server.use(stubMe(), stubSettings(null, true, false, false, 'https://example.test/help'), stubBillingOrders());
    await renderAccount();

    const card = await screen.findByTestId('account-support');
    expect(within(card).getByTestId('account-support-open')).toBeVisible();
    expect(within(card).getByRole('link', { name: en.support.externalLink })).toHaveAttribute('href', 'https://example.test/help');
    expect(screen.getAllByTestId('account-support')).toHaveLength(1);
  });

  it('states that support is not configured instead of leaving the profile without a support card', async () => {
    server.use(stubMe(), stubSettings(null), stubBillingOrders());
    await renderAccount();

    const card = await screen.findByTestId('account-support');
    expect(within(card).getByTestId('account-support-not-configured')).toHaveTextContent(en.support.notConfigured);
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
  });

  it('opens the support form straight away when the link from an e-mail asks for it', async () => {
    server.use(stubMe(), stubSettings(null, true), stubBillingOrders());
    await renderAccount('/account?support=open');

    expect(await screen.findByRole('button', { name: en.support.send })).toBeInTheDocument();
    expect(screen.getByLabelText(en.support.subjectLabel)).toBeInTheDocument();
  });

  it('keeps support submission inactive until both fields are filled and resets after success', async () => {
    const user = userEvent.setup();
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

    await userEvent.click(await screen.findByTestId('account-support-open'));
    const send = await screen.findByRole('button', { name: en.support.send });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText(en.support.subjectLabel), 'Lesson issue');
    expect(send).toBeDisabled();
    await user.click(screen.getByLabelText(en.support.bodyLabel));
    await user.paste('I cannot start the recording.');
    expect(send).toBeEnabled();
    await userEvent.click(send);

    expect(await findToast('success')).toHaveTextContent(en.support.sent);
    expect(body).toEqual({ subject: 'Lesson issue', body: 'I cannot start the recording.' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByTestId('account-support-open'));
    expect(screen.getByLabelText(en.support.subjectLabel)).toHaveValue('');
    expect(screen.getByLabelText(en.support.bodyLabel)).toHaveValue('');
    expect(screen.getByRole('button', { name: en.support.send })).toBeDisabled();
  });

  it('requests password setup from the passkey dialog of a passwordless member', async () => {
    let body: unknown;
    server.use(
      stubMe(true, {}, null, null, { hasPassword: false }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('add-passkey-open'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByTestId('passkey-set-password'));
    expect(await within(dialog).findByTestId('passkey-set-password-sent')).toHaveTextContent(en.security.resetSent);
    expect(within(dialog).queryByTestId('passkey-set-password')).not.toBeInTheDocument();
    expect(screen.queryByTestId('two-factor-set-password-sent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-reset-password-sent')).not.toBeInTheDocument();
    expect(successToasts()).toHaveLength(0);
    expect(body).toEqual({
      email: 'member@together.dev',
      redirectTo: 'http://localhost:3000/reset-password',
    });

    await userEvent.click(within(dialog).getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByTestId('add-passkey-open'));
    const reopened = await screen.findByRole('dialog');
    expect(within(reopened).queryByTestId('passkey-set-password-sent')).not.toBeInTheDocument();
    expect(within(reopened).getByTestId('passkey-set-password')).toBeEnabled();
  });

  it('shows the sent password link once, under the button that sent it, and clears it on the next request', async () => {
    server.use(
      stubMe(true, {}, null, null, { hasPassword: false }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', () => HttpResponse.json({ status: true })),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('two-factor-set-password'));
    expect(await screen.findByTestId('two-factor-set-password-sent')).toHaveTextContent(en.security.resetSent);
    expect(screen.queryByTestId('account-reset-password-sent')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('account-reset-password'));
    expect(await screen.findByTestId('account-reset-password-sent')).toHaveTextContent(en.security.resetSent);
    expect(screen.queryByTestId('two-factor-set-password-sent')).not.toBeInTheDocument();
    expect(successToasts()).toHaveLength(0);
  });

  it('requests an account password setup link and confirms it under the button', async () => {
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
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('account-reset-password'));

    expect(await screen.findByTestId('account-reset-password-sent')).toHaveTextContent(en.security.resetSent);
    expect(successToasts()).toHaveLength(0);
    expect(body).toEqual({
      email: 'member@together.dev',
      redirectTo: 'http://localhost:3000/reset-password',
    });
  });

  it('reports a failed account password setup request once, beside the button that sent it', async () => {
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal' } }, { status: 500 })),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('account-reset-password'));

    expect(await screen.findByTestId('account-reset-password-error')).toBeVisible();
    expect(errorToasts()).toHaveLength(0);
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
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('change-password-open'));
    await userEvent.type(await screen.findByTestId('change-current-password'), 'current-password');
    await userEvent.type(screen.getByTestId('change-new-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('change-confirm-password'), VALID_PASSWORD);
    const revokeOthers = screen.getByRole('checkbox', { name: en.changePassword.revokeOtherSessions });
    expect(revokeOthers).toBeChecked();
    expect(revokeOthers).toHaveAccessibleDescription(en.changePassword.revokeScopeHint);
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await findToast('success')).toHaveTextContent(
      en.changePassword.success,
    );
    expect(body).toEqual({
      currentPassword: 'current-password',
      newPassword: VALID_PASSWORD,
      revokeOtherSessions: true,
    });
    expect(screen.getByTestId('account-reset-password')).toHaveTextContent(en.account.forgotPasswordEmailLink);
    expect(screen.getByTestId('account-forgot-password-prompt')).toHaveTextContent(en.account.forgotPasswordPrompt);
    expect(screen.getByTestId('account-reset-password')).toHaveAccessibleDescription(en.account.forgotPasswordPrompt);
    expect(within(screen.getByTestId('account-reset-password-row')).queryByText(en.account.passwordLinkHelp)).not.toBeInTheDocument();
    expect(screen.getByText(en.account.passwordLinkHelp)).toBeInTheDocument();
    expect(screen.getByTestId('change-password-open')).toHaveClass('MuiButton-contained');
    expect(screen.getByTestId('account-reset-password')).toHaveClass('MuiButton-text');
  });

  it.each([
    { revokeOtherSessions: true, refetches: 1 },
    { revokeOtherSessions: false, refetches: 0 },
  ])('refetches the session list after a password change only when other sessions were signed out ($revokeOtherSessions)', async ({ revokeOtherSessions, refetches }) => {
    let sessionCalls = 0;
    server.use(
      stubMe(),
      stubSettings(null),
      stubBillingOrders(),
      http.get('*/api/me/sessions', () => {
        sessionCalls += 1;
        return HttpResponse.json({ ok: true, data: { sessions: [] } });
      }),
      http.post('*', () => HttpResponse.json({ status: true })),
    );
    await renderAccount('/account?tab=security');
    await waitFor(() => expect(sessionCalls).toBe(1));

    await userEvent.click(await screen.findByTestId('change-password-open'));
    await userEvent.type(await screen.findByTestId('change-current-password'), 'current-password');
    await userEvent.type(screen.getByTestId('change-new-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('change-confirm-password'), VALID_PASSWORD);
    if (!revokeOtherSessions) await userEvent.click(screen.getByRole('checkbox', { name: en.changePassword.revokeOtherSessions }));
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await findToast('success')).toHaveTextContent(en.changePassword.success);
    await waitFor(() => expect(sessionCalls).toBe(1 + refetches));
  });

  it('keeps the reset path available for a passwordless account', async () => {
    let body: unknown;
    server.use(
      stubMe(true, {}, null, null, { hasPassword: false }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );
    await renderAccount('/account?tab=security');

    expect(screen.queryByTestId('change-password-open')).not.toBeInTheDocument();
    const setup = await screen.findByTestId('account-reset-password');
    expect(setup).toHaveTextContent(en.security.setOrResetPassword);
    expect(screen.getByTestId('two-factor-set-password')).toHaveTextContent(en.security.setOrResetPassword);
    expect(screen.queryByTestId('enable-2fa-open')).not.toBeInTheDocument();
    expect(screen.getByText(en.security.twoFactorNeedsPassword)).toBeVisible();
    await userEvent.click(setup);
    expect(body).toMatchObject({ email: 'member@together.dev' });
  });

  it('offers only the password link in the passkey dialog of a passwordless account', async () => {
    server.use(
      stubMe(true, {}, null, null, { hasPassword: false }),
      stubSettings(null),
      stubBillingOrders(),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('add-passkey-open'));
    const dialog = await screen.findByRole('dialog');
    const setup = within(dialog).getByTestId('passkey-set-password');
    expect(setup).toHaveTextContent(en.security.setOrResetPassword);
    expect(setup).toHaveClass('MuiButton-contained');
    expect(setup).toHaveFocus();
    expect(within(dialog).queryByTestId('passkey-name')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('passkey-proof-password')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('add-passkey')).not.toBeInTheDocument();
  });

  it('shows a failed password link only beside the passwordless button that sent it', async () => {
    let requests = 0;
    server.use(
      stubMe(true, {}, null, null, { hasPassword: false }),
      stubSettings(null),
      stubBillingOrders(),
      http.post('*', () => {
        requests += 1;
        return HttpResponse.json({ ok: false, error: { code: 'internal' } }, { status: 500 });
      }),
    );
    await renderAccount('/account?tab=security');

    await userEvent.click(await screen.findByTestId('two-factor-set-password'));
    expect(await screen.findByTestId('two-factor-set-password-error')).toBeVisible();
    expect(screen.queryByTestId('account-reset-password-error')).not.toBeInTheDocument();
    expect(errorToasts()).toHaveLength(0);

    await userEvent.click(screen.getByTestId('add-passkey-open'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByTestId('passkey-set-password'));
    expect(await within(dialog).findByTestId('passkey-set-password-error')).toBeVisible();
    expect(screen.queryByTestId('two-factor-set-password-error')).not.toBeInTheDocument();
    expect(requests).toBe(2);

    await userEvent.click(within(dialog).getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByTestId('add-passkey-open'));
    expect(within(await screen.findByRole('dialog')).queryByTestId('passkey-set-password-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('two-factor-set-password-error')).not.toBeInTheDocument();
    expect(errorToasts()).toHaveLength(0);
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
            filename: 'my-data-studio-1998-07-29.json',
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
    await userEvent.click(await screen.findByTestId('account-erasure-open'));
    const button = await screen.findByTestId('account-erasure-create');
    expect(button).toBeDisabled();
    expect(screen.getByRole('dialog')).toContainElement(button);
    await userEvent.type(
      screen.getByLabelText(en.account.erasureConfirmLabel),
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
          companyName: 'Acme LLC',
          address: 'Main Street 1',
          postalCode: '00-001',
          city: 'Warsaw',
          country: 'PL',
        },
      }]),
    );
    await renderAccount();
    expect(await screen.findByText('Acme LLC')).toBeInTheDocument();
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
