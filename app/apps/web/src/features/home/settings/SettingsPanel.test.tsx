import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { BUILD_VERSION } from '../../../lib/build-info.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelContextProvider } from '../panel-context.js';
import { SettingsPanel } from './SettingsPanel.js';

const VALID_PASSWORD = 'x'.repeat(PASSWORD_MIN_LENGTH);

interface StoredSettings {
  name: string;
  socialLinks: Array<{ label: string; url: string }>;
  billingPortalUrl: string | null;
  bunnyStreamLibraryId: string | null;
  bunnyStreamCdnHostname: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  faviconUrl: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  invoicingProvider?: 'ifirma' | 'ksef';
  invoiceVatMode?: 'rate' | 'exempt';
  invoiceVatRatePercent?: 5 | 8 | 23 | null;
  invoiceExemptionBasisKind?: 'art_113_1' | 'art_113_9' | 'art_43_1' | 'other_statute' | 'other' | null;
  invoiceExemptionBasis?: string | null;
  defaultHomeSpaceId?: string | null;
}

interface StubSpace {
  id: string;
  name: string;
  publicReadOnly: boolean;
  archivedAt: string | null;
}

const staffSpace = ({ id, name, publicReadOnly, archivedAt }: StubSpace) => ({
  tenantId: 'tenant-akademia',
  id,
  slug: id,
  name,
  description: null,
  visibility: 'members',
  productIds: [],
  publicReadOnly,
  position: 0,
  archivedAt,
  createdAt: '2026-07-20T08:00:00.000Z',
  stats: { posts: 0, followers: 0 },
});

const EMPTY_SETTINGS: StoredSettings = {
  name: 'Akademia',
  socialLinks: [],
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  bunnyStreamCdnHostname: null,
  logoUrl: null,
  accentColor: null,
  faviconUrl: null,
  termsUrl: null,
  privacyUrl: null,
};

const PANEL_TENANT = {
  id: 'tenant-akademia',
  slug: 'akademia',
  name: 'Akademia',
  staffRole: 'owner' as const,
  memberId: null,
};

const installSettingsBackend = (initial: StoredSettings, spaces: StubSpace[] = []) => {
  let settings = { ...initial };
  const updates: unknown[] = [];

  server.use(
    http.get('/api/tenant/settings', () => HttpResponse.json({ ok: true, data: { settings } })),
    http.get('/api/spaces/staff', () =>
      HttpResponse.json({ ok: true, data: { spaces: spaces.map(staffSpace) } }),
    ),
    http.get('*', ({ request }) =>
      new URL(request.url).pathname.endsWith('/passkey/list-user-passkeys')
        ? HttpResponse.json([])
        : undefined),
    http.post('/api/tenant/settings', async ({ request }) => {
      const body = await request.json();
      updates.push(body);
      if (typeof body === 'object' && body !== null) {
        settings = { ...settings, ...body };
      }
      return HttpResponse.json({ ok: true, data: { settings } });
    }),
  );

  return { updates };
};

const renderPanel = (initial: StoredSettings = EMPTY_SETTINGS, emailVerified = true, spaces: StubSpace[] = []) => {
  const { updates } = installSettingsBackend(initial, spaces);

  const rootRoute = createRootRoute();
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/settings',
    component: () => (
      <PanelContextProvider
        value={{ tenant: PANEL_TENANT, email: 'creator3@together.dev', emailVerified }}
      >
        <SettingsPanel />
      </PanelContextProvider>
    ),
  });
  const integrationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/integrations',
    component: () => <div data-testid="integrations-route" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([settingsRoute, integrationsRoute]),
    history: createMemoryHistory({
      initialEntries: [`/panel/settings${window.location.hash}`],
    }),
  });

  const { queryClient } = renderWithProviders(<RouterProvider router={router} />);

  return { queryClient, router, updates };
};

const openSettingsSection = async (label: string) => {
  await userEvent.click(await screen.findByRole('tab', { name: label }));
};

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('SettingsPanel information architecture', () => {
  it('groups settings into five localized tabs', async () => {
    renderPanel();

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      pl.settingsNavigation.company,
      pl.settingsNavigation.legal,
      pl.settingsNavigation.brand,
      pl.settingsNavigation.security,
      pl.settingsNavigation.diagnostics,
    ]);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'settings-panel-company');
    expect(document.querySelector('#support')).not.toBeNull();
    expect(screen.queryByTestId('billing-portal-url')).not.toBeInTheDocument();
  });

  it('sends the retired billing deep link to the integrations stripe tab', async () => {
    window.history.replaceState(null, '', '/panel/settings#billing');

    const { router } = renderPanel();

    expect(await screen.findByTestId('integrations-route')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/panel/integrations');
    expect(router.state.location.hash).toBe('stripe');
  });

  it('opens the company tab for billing and support deep links', async () => {
    window.history.replaceState(null, '', '/panel/settings#support');

    renderPanel();

    expect(await screen.findByRole('tab', { name: pl.settingsNavigation.company })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(document.querySelector('#support')).not.toBeNull();
  });

  it('opens the security tab from its deep link', async () => {
    window.history.replaceState(null, '', '/panel/settings#security');

    renderPanel();

    expect(await screen.findByRole('tab', { name: pl.settingsNavigation.security })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByTestId('security-reset-password')).toBeInTheDocument();
    expect(screen.getByTestId('passkey-name')).toBeInTheDocument();
  });

  it('follows a router-driven hash change while the panel stays mounted', async () => {
    const { router } = renderPanel();
    await screen.findByRole('tab', { name: pl.settingsNavigation.company });

    await router.navigate({ to: '/panel/settings', hash: 'branding' });

    expect(await screen.findByRole('tab', { name: pl.settingsNavigation.brand })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('records the active tab in the router hash', async () => {
    const { router } = renderPanel();

    await openSettingsSection(pl.settingsNavigation.legal);

    expect(router.state.location.hash).toBe('legal');
  });
});

describe('SettingsPanel build information', () => {
  it('shows matching browser and server versions from the health action', async () => {
    renderPanel();
    await openSettingsSection(pl.settingsNavigation.diagnostics);

    expect(await screen.findByText(`${pl.buildInfo.serverVersion}: ${BUILD_VERSION}`))
      .toBeInTheDocument();
    expect(screen.queryByTestId('build-mismatch-warning')).not.toBeInTheDocument();
  });

  it('warns when the health action reports a different server build', async () => {
    server.use(
      http.get('/api/health', () =>
        HttpResponse.json({
          ok: true,
          data: {
            status: 'ok',
            database: 'up',
            version: '999.0.0',
            sha: 'unknown',
            environment: 'test',
            production: false,
            commit: null,
            databaseFingerprint: null,
            expectedMigrations: 82,
            appliedMigrations: 82,
            schemaCurrent: true,
            schemaFingerprint: 'c087b16a6bb6',
            schemaFingerprintMatch: true,
          },
        }),
      ),
    );
    renderPanel();
    await openSettingsSection(pl.settingsNavigation.diagnostics);

    expect(await screen.findByTestId('build-mismatch-warning')).toHaveTextContent(
      pl.buildInfo.mismatch,
    );
  });
});

describe('SettingsPanel security', () => {
  it('mounts passkey and two-factor management on the creator surface', async () => {
    renderPanel();
    await openSettingsSection(pl.settingsNavigation.security);

    expect(await screen.findByTestId('passkeys-empty')).toHaveTextContent(pl.security.noPasskeys);
    expect(screen.getByLabelText(pl.security.passkeyPasswordLabel)).toBeInTheDocument();
    expect(screen.getByTestId('regenerate-backup-codes')).toBeInTheDocument();
    expect(screen.getByTestId('disable-2fa')).toBeInTheDocument();
  });

  it('shows the creator verification state and resends the link', async () => {
    let body: unknown;
    server.use(http.post('*', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ status: true });
    }));
    renderPanel(EMPTY_SETTINGS, false);
    await openSettingsSection(pl.settingsNavigation.security);

    expect(await screen.findByText(pl.emailVerification.pending({ email: 'creator3@together.dev' })))
      .toBeInTheDocument();
    await userEvent.click(screen.getByTestId('resend-verification-email'));
    expect(await screen.findByText(pl.emailVerification.sent)).toBeInTheDocument();
    expect(body).toEqual({
      email: 'creator3@together.dev',
      callbackURL: 'http://localhost:3000/login?verification=verified',
    });
  });

  it('changes the creator password and keeps the reset path mounted', async () => {
    let body: unknown;
    server.use(
      http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );
    renderPanel();
    await openSettingsSection(pl.settingsNavigation.security);

    await userEvent.type(await screen.findByTestId('change-current-password'), 'current-password');
    await userEvent.type(screen.getByTestId('change-new-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('change-confirm-password'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('change-revoke-sessions'));
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-success')).toHaveTextContent(
      pl.changePassword.success,
    );
    expect(body).toEqual({
      currentPassword: 'current-password',
      newPassword: VALID_PASSWORD,
      revokeOtherSessions: true,
    });
    expect(screen.getByText(pl.security.setOrResetPasswordHeading)).toBeInTheDocument();
    expect(screen.getByTestId('security-reset-password')).toBeInTheDocument();
  });

  it('requests password setup from creator passkey management', async () => {
    let body: unknown;
    server.use(
      http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );
    renderPanel();
    await openSettingsSection(pl.settingsNavigation.security);

    await userEvent.click(await screen.findByTestId('passkey-set-password'));

    expect(await screen.findByTestId('passkey-password-setup-sent')).toHaveTextContent(
      pl.security.resetSent,
    );
    expect(body).toEqual({
      email: 'creator3@together.dev',
      redirectTo: 'http://localhost:3000/reset-password',
    });
  });
});

describe('SettingsPanel legal documents', () => {
  it('saves terms and privacy urls through the settings endpoint', async () => {
    const { updates } = renderPanel();
    await openSettingsSection(pl.settingsNavigation.legal);

    await userEvent.type(await screen.findByTestId('legal-terms-url'), 'https://akademia.test/regulamin');
    await userEvent.type(screen.getByTestId('legal-privacy-url'), 'https://akademia.test/prywatnosc');
    await userEvent.click(screen.getByTestId('legal-save'));

    expect(await screen.findByTestId('legal-saved')).toHaveTextContent(pl.legal.saved);
    expect(updates).toContainEqual({
      termsUrl: 'https://akademia.test/regulamin',
      privacyUrl: 'https://akademia.test/prywatnosc',
    });
  });

  it('clears the documents by saving empty fields', async () => {
    const { updates } = renderPanel({
      ...EMPTY_SETTINGS,
      termsUrl: 'https://akademia.test/regulamin',
    });
    await openSettingsSection(pl.settingsNavigation.legal);

    const termsInput = await screen.findByTestId('legal-terms-url');
    await waitFor(() => {
      expect(termsInput).toHaveValue('https://akademia.test/regulamin');
    });
    await userEvent.clear(termsInput);
    await userEvent.click(screen.getByTestId('legal-save'));

    expect(await screen.findByTestId('legal-saved')).toBeInTheDocument();
    expect(updates).toContainEqual({ termsUrl: null, privacyUrl: null });
  });
});

describe('SettingsPanel public access', () => {
  const spaces: StubSpace[] = [
    { id: 's1', name: 'Ogólna', publicReadOnly: true, archivedAt: null },
    { id: 's2', name: 'Zamknięta', publicReadOnly: false, archivedAt: null },
    { id: 's3', name: 'Archiwalna', publicReadOnly: true, archivedAt: '2026-07-20T09:00:00.000Z' },
  ];

  it('offers only active publicly readable spaces as the visitors home space', async () => {
    renderPanel(EMPTY_SETTINGS, true, spaces);

    const picker = await screen.findByRole('combobox', { name: pl.publicAccess.homeSpaceLabel });
    await waitFor(() => expect(picker).toBeEnabled());
    await userEvent.click(picker);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      pl.publicAccess.homeSpaceNone,
      'Ogólna',
    ]);
  });

  it('saves the picked home space and clears it again', async () => {
    const { updates } = renderPanel({ ...EMPTY_SETTINGS, defaultHomeSpaceId: 's1' }, true, spaces);

    const picker = await screen.findByRole('combobox', { name: pl.publicAccess.homeSpaceLabel });
    await waitFor(() => expect(picker).toHaveTextContent('Ogólna'));
    await userEvent.click(picker);
    await userEvent.click(screen.getByRole('option', { name: pl.publicAccess.homeSpaceNone }));

    await waitFor(() => expect(updates).toContainEqual({ defaultHomeSpaceId: '' }));
  });
});

describe('SettingsPanel direct KSeF', () => {
  it('points the KSeF credentials at the invoicing integration instead of duplicating them', async () => {
    renderPanel({ ...EMPTY_SETTINGS, invoicingProvider: 'ksef' });

    expect(await screen.findByText(pl.billing.ksefConfiguredInIntegrations)).toBeInTheDocument();
    expect(screen.getByTestId('ksef-integrations-link')).toHaveAttribute(
      'href',
      '/panel/integrations#invoicing',
    );
    expect(screen.queryByTestId('secret-input-ksef.token')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ksef-test-connection')).not.toBeInTheDocument();
  });
});

describe('SettingsPanel VAT exemption', () => {
  it('shows the basis controls and saves a materialized preset', async () => {
    const { updates } = renderPanel({
      ...EMPTY_SETTINGS,
      invoiceVatMode: 'exempt',
      invoiceVatRatePercent: null,
      invoiceExemptionBasisKind: 'art_113_1',
      invoiceExemptionBasis: 'art. 113 ust. 1 ustawy o podatku od towarów i usług',
    });

    const basis = await screen.findByTestId('invoice-exemption-basis');
    expect(basis).toHaveValue('art. 113 ust. 1 ustawy o podatku od towarów i usług');
    expect(basis).toHaveAttribute('readonly');
    await userEvent.click(screen.getByRole('button', { name: pl.billing.saveSeller }));
    expect(updates).toContainEqual(expect.objectContaining({
      invoiceVatMode: 'exempt',
      invoiceVatRatePercent: null,
      invoiceExemptionBasisKind: 'art_113_1',
      invoiceExemptionBasis: 'art. 113 ust. 1 ustawy o podatku od towarów i usług',
    }));
  });

  it('blocks save when an exempt basis is blank', async () => {
    renderPanel({
      ...EMPTY_SETTINGS,
      invoiceVatMode: 'exempt',
      invoiceVatRatePercent: null,
      invoiceExemptionBasisKind: 'other',
      invoiceExemptionBasis: null,
    });

    expect(await screen.findByText(pl.billing.exemptionBasisRequired)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.billing.saveSeller })).toBeDisabled();
  });
});

const BRANDING_TEST_TIMEOUT = 10_000;

describe('SettingsPanel branding', () => {
  it('saves logo, accent color and favicon through the settings endpoint', async () => {
    const { updates } = renderPanel();
    await openSettingsSection(pl.settingsNavigation.brand);

    expect(await screen.findAllByRole('button', { name: pl.imageAssets.upload })).toHaveLength(2);
    await userEvent.type(await screen.findByTestId('branding-logo-url'), 'https://cdn.example.com/logo.svg');
    await userEvent.type(screen.getByTestId('branding-accent-color'), '#0E7490');
    await userEvent.type(screen.getByTestId('branding-favicon-url'), 'https://cdn.example.com/favicon.svg');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByTestId('branding-saved')).toHaveTextContent(pl.branding.saved);
    expect(updates).toContainEqual({
      name: 'Akademia',
      socialLinks: [],
      logoUrl: 'https://cdn.example.com/logo.svg',
      accentColor: '#0E7490',
      faviconUrl: 'https://cdn.example.com/favicon.svg',
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
    });
  }, BRANDING_TEST_TIMEOUT);

  it('saves and reloads social metadata through the settings endpoint', async () => {
    const { updates } = renderPanel();
    await openSettingsSection(pl.settingsNavigation.brand);

    await userEvent.type(await screen.findByTestId('branding-og-title'), 'Akademia Acme');
    await userEvent.type(screen.getByTestId('branding-og-description'), 'Praktyczna nauka');
    await userEvent.type(
      screen.getByTestId('branding-og-image-url'),
      'https://cdn.example.com/social.png',
    );
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByTestId('branding-saved')).toBeInTheDocument();
    expect(updates).toContainEqual({
      name: 'Akademia',
      socialLinks: [],
      logoUrl: null,
      accentColor: null,
      faviconUrl: null,
      ogTitle: 'Akademia Acme',
      ogDescription: 'Praktyczna nauka',
      ogImageUrl: 'https://cdn.example.com/social.png',
    });
  }, BRANDING_TEST_TIMEOUT);

  it('renames the tenant and round-trips social profiles without a slug field', async () => {
    const { queryClient, updates } = renderPanel();
    await openSettingsSection(pl.settingsNavigation.brand);
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    const name = await screen.findByTestId('branding-name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Akademia Praktyków');
    await userEvent.click(screen.getByTestId('branding-social-add'));
    await userEvent.type(screen.getByTestId('branding-social-label-0'), 'YouTube');
    await userEvent.type(
      screen.getByTestId('branding-social-url-0'),
      'https://youtube.com/@akademia',
    );
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByTestId('branding-saved')).toBeInTheDocument();
    expect(updates).toContainEqual(expect.objectContaining({
      name: 'Akademia Praktyków',
      socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@akademia' }],
    }));
    expect(updates.some((update) => typeof update === 'object' && update !== null && 'slug' in update))
      .toBe(false);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['me'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['public-offer'] });
  }, BRANDING_TEST_TIMEOUT);

  it('marks a non-http profile URL before sending settings', async () => {
    const { updates } = renderPanel();
    await openSettingsSection(pl.settingsNavigation.brand);

    await screen.findByTestId('branding-name');
    await userEvent.click(screen.getByTestId('branding-social-add'));
    await userEvent.type(screen.getByTestId('branding-social-label-0'), 'Profile');
    await userEvent.type(screen.getByTestId('branding-social-url-0'), 'ftp://social.example.com/acme');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByText(pl.branding.socialLinkUrlInvalid)).toBeInTheDocument();
    expect(screen.getByTestId('branding-social-url-0')).toHaveAttribute('aria-invalid', 'true');
    expect(updates).toHaveLength(0);
  }, BRANDING_TEST_TIMEOUT);

  it('previews the accent in the swatch as you type', async () => {
    renderPanel();
    await openSettingsSection(pl.settingsNavigation.brand);

    await userEvent.type(await screen.findByTestId('branding-accent-color'), '#0E7490');

    await waitFor(() => {
      expect(screen.getByTestId('branding-accent-swatch')).toHaveStyle({ backgroundColor: '#0E7490' });
    }, { timeout: 5_000 });
  }, BRANDING_TEST_TIMEOUT);

  it('rejects a malformed accent color without calling the API', async () => {
    const { updates } = renderPanel();
    await openSettingsSection(pl.settingsNavigation.brand);

    await userEvent.type(await screen.findByTestId('branding-accent-color'), 'niebieski');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByText(pl.branding.accentInvalid)).toBeInTheDocument();
    expect(screen.queryByTestId('branding-saved')).not.toBeInTheDocument();
    expect(updates).toHaveLength(0);
  }, BRANDING_TEST_TIMEOUT);

  it('clears branding by saving empty fields', async () => {
    const { updates } = renderPanel({
      ...EMPTY_SETTINGS,
      logoUrl: 'https://cdn.example.com/logo.svg',
      accentColor: '#0E7490',
    });
    await openSettingsSection(pl.settingsNavigation.brand);

    const logoInput = await screen.findByTestId('branding-logo-url');
    await waitFor(() => {
      expect(logoInput).toHaveValue('https://cdn.example.com/logo.svg');
    });
    await userEvent.clear(logoInput);
    await userEvent.clear(screen.getByTestId('branding-accent-color'));
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByTestId('branding-saved')).toBeInTheDocument();
    expect(updates).toContainEqual({
      name: 'Akademia',
      socialLinks: [],
      logoUrl: null,
      accentColor: null,
      faviconUrl: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
    });
  }, BRANDING_TEST_TIMEOUT);
});
