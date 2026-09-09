import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  PASSWORD_MIN_LENGTH,
  TENANT_OG_DESCRIPTION_MAX_LENGTH,
  TENANT_OG_TITLE_MAX_LENGTH,
} from '#core/domain/index.js';

import { ToastProvider } from '../../../components/ui/Toast.js';
import { FONT_MONO } from '../../../theme.js';
import { en } from '../../../i18n/en.js';
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
  logoDarkUrl: string | null;
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
  directMessagesEnabled?: boolean;
  videoAutoplayDefault?: boolean;
  memberVideoAutoplayOverride?: boolean;
  defaultLanguage?: 'pl' | 'en';
}

interface StubSpace {
  id: string;
  name: string;
  publicReadOnly: boolean;
  archivedAt: string | null;
}

const staffSpace = ({ id, name, publicReadOnly, archivedAt }: StubSpace) => ({
  tenantId: 'tenant-academy',
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

interface StubCourse {
  id: string;
  name: string;
  publiclyVisible: boolean;
}

const staffCourse = ({ id, name, publiclyVisible }: StubCourse) => ({
  id,
  tenantId: 'tenant-academy',
  name,
  description: '',
  imageUrl: null,
  moduleOrder: [],
  publiclyVisible,
  legacyId: null,
  createdAt: '2026-07-20T08:00:00.000Z',
});

const EMPTY_SETTINGS: StoredSettings = {
  name: 'Academy',
  socialLinks: [],
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  bunnyStreamCdnHostname: null,
  logoUrl: null,
  logoDarkUrl: null,
  accentColor: null,
  faviconUrl: null,
  termsUrl: null,
  privacyUrl: null,
};

const PANEL_TENANT = {
  id: 'tenant-academy',
  slug: 'academy',
  name: 'Academy',
  staffRole: 'owner' as const,
  memberId: null,
};

const domainRequestSchema = z.object({ domain: z.string() });

const customDomainEntry = (input: {
  domain: string;
  status: 'active' | 'pending-dns' | 'provider-verification' | 'error';
}) => ({
  domain: input.domain,
  verified: input.status === 'active',
  status: input.status,
  records: [{ type: 'CNAME' as const, name: input.domain, value: 'cname.vercel-dns.com', purpose: 'routing' as const, status: input.status === 'active' ? 'verified' as const : 'pending' as const }],
  lastCheckedAt: null,
  lastError: null,
  storageCorsStatus: 'unknown' as const,
});

const initialRouting = () => ({
  tenantHost: 'academy.together.example',
  storageCorsOrigins: [
    'https://academy.together.example',
    'https://courses.acme.example',
  ],
  canonicalOrigin: 'https://courses.acme.example',
  customDomains: [
    customDomainEntry({ domain: 'courses.acme.example', status: 'active' }),
    customDomainEntry({ domain: 'new.acme.example', status: 'pending-dns' }),
  ],
  customDomainTarget: 'cname.vercel-dns.com',
  apexDomainsSupported: false,
  canAddCustomDomain: true,
});

const installSettingsBackend = (
  initial: StoredSettings,
  spaces: StubSpace[] = [],
  courses: StubCourse[] | 'unavailable' = [],
  removeRedirectTo: string | null = null,
) => {
  let settings = { ...initial };
  const updates: unknown[] = [];
  const courseUpdates: unknown[] = [];
  const courseList = courses === 'unavailable' ? [] : courses;
  const domainCalls: string[] = [];
  const redirectQueries: URLSearchParams[] = [];
  let routingState = initialRouting();

  server.use(
    http.get('/api/tenant/settings', () => HttpResponse.json({ ok: true, data: { settings } })),
    http.get('/api/courses', () =>
      courses === 'unavailable'
        ? HttpResponse.json({ ok: false, error: { code: 'internal' } }, { status: 500 })
        : HttpResponse.json({ ok: true, data: { courses: courseList.map(staffCourse) } }),
    ),
    http.post('/api/courses/update', async ({ request }) => {
      const body = await request.json();
      courseUpdates.push(body);
      return HttpResponse.json({
        ok: true,
        data: { course: staffCourse(courseList[0] ?? { id: 'c1', name: 'Course', publiclyVisible: true }) },
      });
    }),
    http.get('/api/tenant/routing', () => HttpResponse.json({
      ok: true,
      data: { routing: routingState },
    })),
    http.get('/api/tenant/redirects', ({ request }) => {
      redirectQueries.push(new URL(request.url).searchParams);
      return HttpResponse.json({ ok: true, data: { redirects: [], total: 686 } });
    }),
    http.post('/api/tenant/domains', async ({ request }) => {
      const body = domainRequestSchema.parse(await request.json());
      domainCalls.push(`add:${body.domain}`);
      routingState = {
        ...routingState,
        customDomains: [
          ...routingState.customDomains,
          customDomainEntry({ domain: body.domain, status: 'pending-dns' }),
        ],
      };
      return HttpResponse.json({ ok: true, data: { routing: routingState } });
    }),
    http.post('/api/tenant/domains/check', async ({ request }) => {
      const body = domainRequestSchema.parse(await request.json());
      domainCalls.push(`check:${body.domain}`);
      routingState = {
        ...routingState,
        customDomains: routingState.customDomains.map((entry) =>
          entry.domain === body.domain
            ? { ...entry, verified: true, status: 'active' as const }
            : entry),
      };
      return HttpResponse.json({ ok: true, data: { routing: routingState } });
    }),
    http.post('/api/tenant/domains/remove', async ({ request }) => {
      const body = domainRequestSchema.parse(await request.json());
      domainCalls.push(`remove:${body.domain}`);
      routingState = {
        ...routingState,
        customDomains: routingState.customDomains.filter((entry) => entry.domain !== body.domain),
      };
      return HttpResponse.json({
        ok: true,
        data: { routing: routingState, redirectTo: removeRedirectTo },
      });
    }),
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

  return { updates, courseUpdates, domainCalls, redirectQueries };
};

const renderPanel = (
  initial: StoredSettings = EMPTY_SETTINGS,
  emailVerified = true,
  spaces: StubSpace[] = [],
  courses: StubCourse[] | 'unavailable' = [],
  removeRedirectTo: string | null = null,
) => {
  const { updates, courseUpdates, domainCalls, redirectQueries } =
    installSettingsBackend(initial, spaces, courses, removeRedirectTo);

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

  const { queryClient } = renderWithProviders(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );

  return { queryClient, router, updates, courseUpdates, domainCalls, redirectQueries };
};

const openSettingsSection = async (label: string) => {
  await userEvent.click(await screen.findByRole('tab', { name: label }));
};

const findToast = async (kind: 'success' | 'error') =>
  screen.findByTestId(new RegExp(`^toast-${kind}-`));

const queryToast = (kind: 'success' | 'error') =>
  screen.queryByTestId(new RegExp(`^toast-${kind}-`));

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('SettingsPanel information architecture', () => {
  it('groups settings into five localized tabs', async () => {
    renderPanel();

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      en.settingsNavigation.company,
      en.settingsNavigation.legal,
      en.settingsNavigation.brand,
      en.settingsNavigation.security,
      en.settingsNavigation.diagnostics,
    ]);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'settings-panel-company');
    expect(document.querySelector('#support')).not.toBeNull();
    expect(screen.queryByTestId('billing-portal-url')).not.toBeInTheDocument();
  });

  it('summarises the redirects in one line that links to their page', async () => {
    const { redirectQueries } = renderPanel();

    await waitFor(() => {
      expect(redirectQueries.map((query) => query.get('limit'))).toEqual(['0']);
    });
    const summary = await screen.findByTestId('tenant-redirects-summary');
    expect(summary).toHaveTextContent(en.tenantDomains.redirectsCount({ count: 686 }));
    expect(within(summary).getByRole('link', { name: `${en.tenantDomains.redirectsManage} →` }))
      .toHaveAttribute('href', '/panel/settings/redirects');
  });

  it('keeps verified ownership beside pending routing and collapses active records', async () => {
    renderPanel();
    await screen.findByTestId('tenant-domain-check-new.acme.example');
    const host = 'courses.example.org';
    const records = [
      { type: 'CNAME', name: host, value: 'routing.example.org', purpose: 'routing', status: 'pending' },
      { type: 'TXT', name: `_vercel.${host}`, value: 'challenge', purpose: 'ownership', status: 'verified' },
    ];
    const routing = {
      ...initialRouting(),
      customDomains: [{
        domain: host, verified: false, status: 'pending-dns', records,
        lastCheckedAt: null, lastError: null, storageCorsStatus: 'unknown' as const,
      }],
    };
    server.use(
      http.get('/api/tenant/routing', () => HttpResponse.json({ ok: true, data: { routing } })),
      http.post('/api/tenant/domains/check', () => HttpResponse.json({ ok: true, data: { routing } })),
    );
    await userEvent.click(screen.getByTestId('tenant-domain-check-new.acme.example'));
    const ownership = await screen.findByTestId(`dns-record-TXT-_vercel.${host}`);
    expect(ownership).toHaveTextContent(en.tenantDomains.recordVerified);
    expect(screen.getByTestId(`dns-record-CNAME-${host}`)).toHaveTextContent(en.tenantDomains.recordPending);
    expect(await within(ownership).findByTestId(`dns-record-name-TXT-_vercel.${host}`)).toHaveTextContent(`_vercel.${host}`);
    expect(await within(ownership).findByTestId(`dns-record-value-TXT-_vercel.${host}`)).toHaveTextContent('challenge');
    routing.customDomains[0] = {
      domain: host, lastCheckedAt: null, lastError: null, verified: true, status: 'active',
      records: records.map((record) => ({ ...record, status: 'verified' })), storageCorsStatus: 'unknown' as const,
    };
    await userEvent.click(screen.getByTestId(`tenant-domain-check-${host}`));
    const summary = await screen.findByText(en.tenantDomains.recordsSummary({ count: 2 }));
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await userEvent.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(screen.getByTestId(`dns-record-TXT-_vercel.${host}`)).toHaveTextContent(en.tenantDomains.recordVerified);
    expect(screen.getByTestId(`dns-record-CNAME-${host}`)).toHaveTextContent(en.tenantDomains.recordVerified);
  });

  it('shows the workspace address with verified and pending custom domains', async () => {
    renderPanel();

    const address = await screen.findByTestId('tenant-workspace-address');
    expect(address).toHaveTextContent('academy.together.example');
    expect(address).toHaveStyle({ fontFamily: FONT_MONO });
    expect(await screen.findByTestId('tenant-domain-status-courses.acme.example'))
      .toHaveTextContent(en.tenantDomains.statusActive);
    const pending = await screen.findByTestId('tenant-domain-new.acme.example');
    expect(pending).toHaveTextContent(en.tenantDomains.statusPendingDns);
    expect(screen.getByTestId('dns-record-value-CNAME-new.acme.example'))
      .toHaveTextContent('cname.vercel-dns.com');
  });

  it('copies the workspace address', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderPanel();

    await userEvent.click(await screen.findByTestId('tenant-workspace-address-copy'));

    expect(writeText).toHaveBeenCalledWith('academy.together.example');
  });

  it('renders active domain checks as quiet links and pending checks as buttons', async () => {
    const { domainCalls } = renderPanel();

    const active = await screen.findByTestId('tenant-domain-check-courses.acme.example');
    expect(active).toHaveClass('MuiLink-root', 'MuiTypography-caption');
    expect(active).not.toHaveClass('MuiButton-root');
    expect(screen.getByTestId('tenant-domain-check-new.acme.example')).toHaveClass('MuiButton-root');
    await userEvent.click(active);

    await waitFor(() => { expect(domainCalls).toEqual(['check:courses.acme.example']); });
  });

  it('shows the storage CORS hint until the verified origin passes its probe', async () => {
    const { queryClient } = renderPanel();

    const hint = await screen.findByTestId('tenant-domain-cors-hint-courses.acme.example');
    expect(hint).toHaveTextContent(en.tenantDomains.storageCorsHint);
    expect(within(hint).getByRole('link', { name: en.tenantDomains.storageCorsLink }))
      .toHaveAttribute('href', '/panel/integrations#storage');
    expect(screen.queryByTestId('tenant-domain-cors-hint-new.acme.example')).not.toBeInTheDocument();

    server.use(http.get('/api/tenant/routing', () => HttpResponse.json({
      ok: true,
      data: {
        routing: {
          ...initialRouting(),
          customDomains: initialRouting().customDomains.map((entry) =>
            entry.domain === 'courses.acme.example'
              ? { ...entry, storageCorsStatus: 'ok' }
              : entry),
        },
      },
    })));
    await queryClient.invalidateQueries();

    await waitFor(() => {
      expect(screen.queryByTestId('tenant-domain-cors-hint-courses.acme.example')).not.toBeInTheDocument();
    });
  });

  it('warns about signing in again until a custom domain is verified', async () => {
    renderPanel();

    await screen.findByTestId('tenant-domain-courses.acme.example');
    expect(screen.queryByTestId('tenant-domain-warning')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('tenant-domain-remove-courses.acme.example'));
    await userEvent.click(await screen.findByTestId('tenant-domain-remove-confirm'));

    expect(await screen.findByTestId('tenant-domain-warning'))
      .toHaveTextContent(en.tenantDomains.firstDomainWarning);
    expect(screen.getByTestId('tenant-domain-new.acme.example')).toBeInTheDocument();
  });

  it('reports a refused domain with one message that names no other workspace', async () => {
    renderPanel();

    await screen.findByTestId('tenant-domain-input');
    server.use(http.post('/api/tenant/domains', () => HttpResponse.json(
      { ok: false, error: { code: 'conflict', message: 'This domain cannot be connected' } },
      { status: 409 },
    )));

    await userEvent.type(screen.getByTestId('tenant-domain-input'), 'taken.acme.example');
    await userEvent.click(screen.getByTestId('tenant-domain-add'));

    expect(await findToast('error'))
      .toHaveTextContent(en.tenantDomains.conflict);
  });

  it('advises using a subdomain unless apex routing is configured', async () => {
    renderPanel();

    expect(await screen.findByTestId('tenant-domain-hint'))
      .toHaveTextContent(en.tenantDomains.addHint);
  });

  it('does not advise using a subdomain when apex routing is configured', async () => {
    const { queryClient } = renderPanel();
    await screen.findByTestId('tenant-domain-hint');
    server.use(http.get('/api/tenant/routing', () => HttpResponse.json({
      ok: true,
      data: { routing: { ...initialRouting(), apexDomainsSupported: true } },
    })));
    await queryClient.invalidateQueries();

    await waitFor(() => {
      expect(screen.queryByTestId('tenant-domain-hint')).not.toBeInTheDocument();
    });
  });

  it('quotes the provider when it refuses the domain for good', async () => {
    renderPanel();

    await screen.findByTestId('tenant-domain-input');
    server.use(http.post('/api/tenant/domains', () => HttpResponse.json(
      {
        ok: false,
        error: {
          code: 'integration_unavailable',
          message: 'Vercel: Domain is already in use by another project',
        },
      },
      { status: 502 },
    )));

    await userEvent.type(screen.getByTestId('tenant-domain-input'), 'taken.acme.example');
    await userEvent.click(screen.getByTestId('tenant-domain-add'));

    expect(await findToast('error'))
      .toHaveTextContent('Vercel: Domain is already in use by another project');
  });

  it('shows the derived canonical address and its explanation', async () => {
    renderPanel();
    const address = await screen.findByTestId('tenant-canonical-address');
    expect(address).toHaveTextContent(en.tenantDomains.canonicalAddress);
    expect(address).toHaveTextContent('https://courses.acme.example');
    expect(address).toHaveTextContent(en.tenantDomains.canonicalExplanation);
  });

  it('shows the recorded error after a check the provider failed', async () => {
    renderPanel();

    await screen.findByTestId('tenant-domain-check-new.acme.example');
    let checked = false;
    server.use(
      http.get('/api/tenant/routing', () => HttpResponse.json({
        ok: true,
        data: {
          routing: {
            tenantHost: 'academy.together.example',
            storageCorsOrigins: ['https://academy.together.example'],
            canonicalOrigin: 'https://academy.together.example',
            customDomains: [{
              domain: 'new.acme.example',
              verified: false,
              status: checked ? 'error' : 'pending-dns',
              records: [],
              lastCheckedAt: null,
              lastError: checked ? 'Vercel is unreachable' : null,
              storageCorsStatus: 'unknown',
            }],
            customDomainTarget: 'cname.vercel-dns.com',
            apexDomainsSupported: false,
            canAddCustomDomain: true,
          },
        },
      })),
      http.post('/api/tenant/domains/check', () => {
        checked = true;
        return HttpResponse.json(
          { ok: false, error: { code: 'integration_unavailable', message: 'Vercel is unreachable' } },
          { status: 502 },
        );
      }),
    );

    await userEvent.click(screen.getByTestId('tenant-domain-check-new.acme.example'));

    await waitFor(() => {
      expect(screen.getByTestId('tenant-domain-status-new.acme.example'))
        .toHaveTextContent(en.tenantDomains.statusError);
    });
    expect(screen.getByTestId('tenant-domain-new.acme.example'))
      .toHaveTextContent('Vercel is unreachable');
    expect(screen.getByTestId('tenant-domain-check-new.acme.example')).toHaveClass('MuiButton-root');
  });

  it('adds a domain and lists it as waiting for DNS', async () => {
    const { domainCalls } = renderPanel();

    await userEvent.type(await screen.findByTestId('tenant-domain-input'), 'shop.acme.example');
    await userEvent.click(screen.getByTestId('tenant-domain-add'));

    const added = await screen.findByTestId('tenant-domain-shop.acme.example');
    expect(added).toHaveTextContent(en.tenantDomains.statusPendingDns);
    expect(screen.getByTestId('dns-record-value-CNAME-shop.acme.example'))
      .toHaveTextContent('cname.vercel-dns.com');
    expect(domainCalls).toEqual(['add:shop.acme.example']);
    expect(await findToast('success')).toHaveTextContent(en.common.saved);
  });

  it('checks a pending domain and shows it as active', async () => {
    const { domainCalls } = renderPanel();

    await userEvent.click(await screen.findByTestId('tenant-domain-check-new.acme.example'));

    await waitFor(() => {
      expect(screen.getByTestId('tenant-domain-status-new.acme.example'))
        .toHaveTextContent(en.tenantDomains.statusActive);
    });
    expect(domainCalls).toEqual(['check:new.acme.example']);
    expect(screen.getByTestId('tenant-domain-check-new.acme.example')).toHaveClass('MuiLink-root');
    expect(queryToast('success')).not.toBeInTheDocument();
  });

  it('offers the record name and value as separate copy fields', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderPanel();

    const record = await screen.findByTestId('dns-record-CNAME-new.acme.example');
    expect(within(record).getByTestId('dns-record-name-CNAME-new.acme.example'))
      .toHaveTextContent('new.acme.example');

    await userEvent.click(screen.getByTestId('dns-record-value-CNAME-new.acme.example-copy'));

    expect(writeText).toHaveBeenCalledWith('cname.vercel-dns.com');
    await waitFor(() => {
      expect(screen.getByTestId('dns-record-value-CNAME-new.acme.example-copied'))
        .toHaveTextContent(en.copyField.copied);
    });
  });

  it('stays silent about copying when the clipboard refuses the record', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>()
      .mockRejectedValue(new Error('Clipboard denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderPanel();

    await userEvent.click(
      await screen.findByTestId('dns-record-value-CNAME-new.acme.example-copy'),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByTestId('dns-record-value-CNAME-new.acme.example-copied'))
      .toHaveTextContent('');
  });

  it('removes a domain only after the owner confirms', async () => {
    const redirectTo = 'https://academy.together.example/panel/settings';
    const { domainCalls } = renderPanel(EMPTY_SETTINGS, true, [], [], redirectTo);

    await userEvent.click(await screen.findByTestId('tenant-domain-remove-courses.acme.example'));
    expect(await screen.findByText(en.tenantDomains.removeConfirmTitle)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(domainCalls).toEqual([]);

    await userEvent.click(screen.getByTestId('tenant-domain-remove-courses.acme.example'));
    await userEvent.click(await screen.findByTestId('tenant-domain-remove-confirm'));

    await waitFor(() => {
      expect(screen.queryByTestId('tenant-domain-courses.acme.example')).not.toBeInTheDocument();
    });
    expect(domainCalls).toEqual(['remove:courses.acme.example']);
    const redirect = await screen.findByTestId('tenant-domain-redirect');
    expect(redirect).toHaveTextContent(en.tenantDomains.removedRedirect);
    expect(within(redirect).getByRole('link', { name: redirectTo }))
      .toHaveAttribute('href', redirectTo);
    expect(queryToast('success')).not.toBeInTheDocument();
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

    expect(await screen.findByRole('tab', { name: en.settingsNavigation.company })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(document.querySelector('#support')).not.toBeNull();
  });

  it('opens the security tab from its deep link', async () => {
    window.history.replaceState(null, '', '/panel/settings#security');

    renderPanel();

    expect(await screen.findByRole('tab', { name: en.settingsNavigation.security })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByTestId('security-reset-password')).toBeInTheDocument();
    expect(screen.getByTestId('passkey-name')).toBeInTheDocument();
  });

  it('follows a router-driven hash change while the panel stays mounted', async () => {
    const { router } = renderPanel();
    await screen.findByRole('tab', { name: en.settingsNavigation.company });

    await router.navigate({ to: '/panel/settings', hash: 'branding' });

    expect(await screen.findByRole('tab', { name: en.settingsNavigation.brand })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('records the active tab in the router hash', async () => {
    const { router } = renderPanel();

    await openSettingsSection(en.settingsNavigation.legal);

    expect(router.state.location.hash).toBe('legal');
  });
});

describe('SettingsPanel build information', () => {
  it('shows matching browser and server versions from the health action', async () => {
    renderPanel();
    await openSettingsSection(en.settingsNavigation.diagnostics);

    expect(await screen.findByText(`${en.buildInfo.serverVersion}: ${BUILD_VERSION}`))
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
    await openSettingsSection(en.settingsNavigation.diagnostics);

    expect(await screen.findByTestId('build-mismatch-warning')).toHaveTextContent(
      en.buildInfo.mismatch,
    );
  });
});

describe('SettingsPanel security', () => {
  it('mounts passkey and two-factor management on the creator surface', async () => {
    renderPanel();
    await openSettingsSection(en.settingsNavigation.security);

    expect(await screen.findByTestId('passkeys-empty')).toHaveTextContent(en.security.noPasskeys);
    expect(screen.getByLabelText(en.security.passkeyPasswordLabel)).toBeInTheDocument();
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
    await openSettingsSection(en.settingsNavigation.security);

    expect(await screen.findByText(en.emailVerification.pending({ email: 'creator3@together.dev' })))
      .toBeInTheDocument();
    await userEvent.click(screen.getByTestId('resend-verification-email'));
    expect(await findToast('success')).toHaveTextContent(en.emailVerification.sent);
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
    await openSettingsSection(en.settingsNavigation.security);

    await userEvent.type(await screen.findByTestId('change-current-password'), 'current-password');
    await userEvent.type(screen.getByTestId('change-new-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('change-confirm-password'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('change-revoke-sessions'));
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await findToast('success')).toHaveTextContent(
      en.changePassword.success,
    );
    expect(body).toEqual({
      currentPassword: 'current-password',
      newPassword: VALID_PASSWORD,
      revokeOtherSessions: true,
    });
    expect(screen.getByText(en.security.setOrResetPasswordHeading)).toBeInTheDocument();
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
    await openSettingsSection(en.settingsNavigation.security);

    await userEvent.click(await screen.findByTestId('passkey-set-password'));

    expect(await findToast('success')).toHaveTextContent(
      en.security.resetSent,
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
    await openSettingsSection(en.settingsNavigation.legal);

    await userEvent.type(await screen.findByTestId('legal-terms-url'), 'https://academy.test/terms');
    await userEvent.type(screen.getByTestId('legal-privacy-url'), 'https://academy.test/privacy');
    await userEvent.click(screen.getByTestId('legal-save'));

    expect(await findToast('success')).toHaveTextContent(en.legal.saved);
    expect(updates).toContainEqual({
      termsUrl: 'https://academy.test/terms',
      privacyUrl: 'https://academy.test/privacy',
    });
  });

  it('clears the documents by saving empty fields', async () => {
    const { updates } = renderPanel({
      ...EMPTY_SETTINGS,
      termsUrl: 'https://academy.test/terms',
    });
    await openSettingsSection(en.settingsNavigation.legal);

    const termsInput = await screen.findByTestId('legal-terms-url');
    await waitFor(() => {
      expect(termsInput).toHaveValue('https://academy.test/terms');
    });
    await userEvent.clear(termsInput);
    await userEvent.click(screen.getByTestId('legal-save'));

    expect(await findToast('success')).toBeInTheDocument();
    expect(updates).toContainEqual({ termsUrl: null, privacyUrl: null });
  });
});

describe('SettingsPanel public access', () => {
  const spaces: StubSpace[] = [
    { id: 's1', name: 'General', publicReadOnly: true, archivedAt: null },
    { id: 's2', name: 'Closed', publicReadOnly: false, archivedAt: null },
    { id: 's3', name: 'Archived', publicReadOnly: true, archivedAt: '2026-07-20T09:00:00.000Z' },
  ];

  it('offers only active publicly readable spaces as the visitors home space', async () => {
    renderPanel(EMPTY_SETTINGS, true, spaces);

    const picker = await screen.findByRole('combobox', { name: en.publicAccess.homeSpaceLabel });
    await waitFor(() => expect(picker).toBeEnabled());
    await userEvent.click(picker);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      en.publicAccess.homeSpaceUnset,
      'General',
    ]);
  });

  it('only saves the picked home space once the section is submitted', async () => {
    const { updates } = renderPanel({ ...EMPTY_SETTINGS, defaultHomeSpaceId: 's1' }, true, spaces);

    const picker = await screen.findByRole('combobox', { name: en.publicAccess.homeSpaceLabel });
    await waitFor(() => expect(picker).toHaveTextContent('General'));
    await userEvent.click(picker);
    await userEvent.click(screen.getByRole('option', { name: en.publicAccess.homeSpaceUnset }));

    expect(updates).toHaveLength(0);

    await userEvent.click(screen.getByTestId('public-access-save'));

    await waitFor(() => expect(updates).toContainEqual({ defaultHomeSpaceId: null }));
    expect(await findToast('success')).toHaveTextContent(en.publicAccess.saved);
  });

  it('keeps a dormant home space when the section is saved for other reasons', async () => {
    const { updates, courseUpdates } = renderPanel(
      { ...EMPTY_SETTINGS, defaultHomeSpaceId: 's3' },
      true,
      spaces,
      [{ id: 'c1', name: 'Camper from Scratch', publiclyVisible: false }],
    );

    const picker = await screen.findByRole('combobox', { name: en.publicAccess.homeSpaceLabel });
    await waitFor(() => expect(picker).toHaveTextContent(en.publicAccess.homeSpaceUnset));

    await userEvent.click(await screen.findByRole('switch', { name: 'Camper from Scratch' }));
    await userEvent.click(screen.getByTestId('public-access-save'));

    await waitFor(() => expect(courseUpdates).toEqual([{ id: 'c1', publiclyVisible: true }]));
    expect(updates).toEqual([]);
  });

  it('manages course public visibility next to the home space picker', async () => {
    const { courseUpdates } = renderPanel(EMPTY_SETTINGS, true, spaces, [
      { id: 'c1', name: 'Camper from Scratch', publiclyVisible: false },
      { id: 'c2', name: 'Routes', publiclyVisible: true },
    ]);

    const toggle = await screen.findByRole('switch', { name: 'Camper from Scratch' });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(screen.getByRole('switch', { name: 'Routes' })).toBeChecked();

    await userEvent.click(toggle);
    await userEvent.click(screen.getByTestId('public-access-save'));

    await waitFor(() =>
      expect(courseUpdates).toEqual([{ id: 'c1', publiclyVisible: true }]));
  });

  it('still saves the home space when the course list fails to load', async () => {
    const { updates } = renderPanel({ ...EMPTY_SETTINGS, defaultHomeSpaceId: 's1' }, true, spaces, 'unavailable');

    const picker = await screen.findByRole('combobox', { name: en.publicAccess.homeSpaceLabel });
    await waitFor(() => expect(picker).toBeEnabled());
    await userEvent.click(picker);
    await userEvent.click(screen.getByRole('option', { name: en.publicAccess.homeSpaceUnset }));
    await userEvent.click(screen.getByTestId('public-access-save'));

    await waitFor(() => expect(updates).toContainEqual({ defaultHomeSpaceId: null }));
  });
});

describe('SettingsPanel direct messages', () => {
  const findToggle = () => screen.findByRole('switch', { name: en.directMessages.toggleLabel });

  it('shows the switch on for tenants that never touched it', async () => {
    renderPanel(EMPTY_SETTINGS);

    const toggle = await findToggle();
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
  });

  it('turns direct messages off', async () => {
    const { updates } = renderPanel(EMPTY_SETTINGS);

    const toggle = await findToggle();
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);

    await waitFor(() => expect(updates).toContainEqual({ directMessagesEnabled: false }));
  });

  it('turns direct messages back on', async () => {
    const { updates } = renderPanel({ ...EMPTY_SETTINGS, directMessagesEnabled: false });

    const toggle = await findToggle();
    await waitFor(() => expect(toggle).not.toBeChecked());
    await userEvent.click(toggle);

    await waitFor(() => expect(updates).toContainEqual({ directMessagesEnabled: true }));
  });
});

describe('SettingsPanel video playback', () => {
  it('updates the tenant default and member override policy', async () => {
    const { updates } = renderPanel(EMPTY_SETTINGS);

    const defaultToggle = await screen.findByRole('switch', { name: en.videoPlayback.defaultLabel });
    const overrideToggle = screen.getByRole('switch', { name: en.videoPlayback.overrideLabel });
    await waitFor(() => expect(defaultToggle).toBeEnabled());
    expect(defaultToggle).not.toBeChecked();
    expect(overrideToggle).not.toBeChecked();

    await userEvent.click(defaultToggle);
    await waitFor(() => expect(updates).toContainEqual({ videoAutoplayDefault: true }));
    await userEvent.click(overrideToggle);
    await waitFor(() => expect(updates).toContainEqual({ memberVideoAutoplayOverride: true }));
  });
});

describe('SettingsPanel e-mail language', () => {
  it('labels the picker and saves the chosen platform default', async () => {
    const { updates } = renderPanel({ ...EMPTY_SETTINGS, defaultLanguage: 'pl' });

    const picker = await screen.findByRole('combobox', { name: en.emailLanguageSettings.label });
    await waitFor(() => expect(picker).toBeEnabled());
    await userEvent.click(picker);
    await userEvent.click(
      screen.getByRole('option', { name: en.emailLanguageSettings.options.en }),
    );
    await userEvent.click(screen.getByRole('button', { name: en.emailLanguageSettings.save }));

    await waitFor(() => expect(updates).toContainEqual({ defaultLanguage: 'en' }));
  });

  it('saves the stored default back instead of the English fallback', async () => {
    const { updates } = renderPanel({ ...EMPTY_SETTINGS, defaultLanguage: 'pl' });

    const picker = await screen.findByRole('combobox', { name: en.emailLanguageSettings.label });
    await waitFor(() => expect(picker).toHaveTextContent(en.emailLanguageSettings.options.pl));
    await userEvent.click(screen.getByRole('button', { name: en.emailLanguageSettings.save }));

    await waitFor(() => expect(updates).toContainEqual({ defaultLanguage: 'pl' }));
  });
});

describe('SettingsPanel direct KSeF', () => {
  it('points the KSeF credentials at the invoicing integration instead of duplicating them', async () => {
    renderPanel({ ...EMPTY_SETTINGS, invoicingProvider: 'ksef' });

    expect(await screen.findByText(en.billing.ksefConfiguredInIntegrations)).toBeInTheDocument();
    expect(screen.getByTestId('ksef-integrations-link')).toHaveAttribute(
      'href',
      '/panel/integrations#invoicing',
    );
    expect(screen.queryByTestId('secret-input-ksef.token')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ksef-test-connection')).not.toBeInTheDocument();
  });

  it('leaves the invoice provider unset until the owner picks one', async () => {
    renderPanel(EMPTY_SETTINGS);

    const picker = await screen.findByRole('combobox', { name: en.billing.invoicingProvider });
    expect(picker).toHaveTextContent(en.billing.providerUnset);
    expect(picker).not.toHaveTextContent('iFirma');
    expect(screen.queryByText(en.billing.ksefConfiguredInIntegrations)).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: en.billing.saveSeller }));
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

    expect(await screen.findByText(en.billing.exemptionBasisRequired)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.billing.saveSeller })).toBeDisabled();
  });
});

const BRANDING_TEST_TIMEOUT = 10_000;

describe('SettingsPanel branding', () => {
  it('saves logo, accent color and favicon through the settings endpoint', async () => {
    const user = userEvent.setup();
    const { updates } = renderPanel();
    await openSettingsSection(en.settingsNavigation.brand);

    expect(await screen.findAllByRole('button', { name: en.imageAssets.upload })).toHaveLength(4);
    await user.click(await screen.findByTestId('branding-logo-url'));
    await user.paste('https://cdn.example.com/logo.svg');
    await userEvent.type(screen.getByTestId('branding-accent-color'), '#0E7490');
    await user.click(screen.getByTestId('branding-favicon-url'));
    await user.paste('https://cdn.example.com/favicon.svg');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await findToast('success')).toHaveTextContent(en.branding.saved);
    expect(updates).toContainEqual({
      name: 'Academy',
      socialLinks: [],
      logoUrl: 'https://cdn.example.com/logo.svg',
      logoDarkUrl: null,
      accentColor: '#0E7490',
      faviconUrl: 'https://cdn.example.com/favicon.svg',
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
    });
  }, BRANDING_TEST_TIMEOUT);

  it('saves and reloads social metadata through the settings endpoint', async () => {
    const user = userEvent.setup();
    const { updates } = renderPanel();
    await openSettingsSection(en.settingsNavigation.brand);

    await userEvent.type(await screen.findByTestId('branding-og-title'), 'Acme Academy');
    await userEvent.type(screen.getByTestId('branding-og-description'), 'Practical learning');
    await user.click(screen.getByTestId('branding-og-image-url'));
    await user.paste('https://cdn.example.com/social.png');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await findToast('success')).toBeInTheDocument();
    expect(updates).toContainEqual({
      name: 'Academy',
      socialLinks: [],
      logoUrl: null,
      logoDarkUrl: null,
      accentColor: null,
      faviconUrl: null,
      ogTitle: 'Acme Academy',
      ogDescription: 'Practical learning',
      ogImageUrl: 'https://cdn.example.com/social.png',
    });
  }, BRANDING_TEST_TIMEOUT);

  it('counts share preview characters and warns once the limit is reached', async () => {
    renderPanel({
      ...EMPTY_SETTINGS,
      ogTitle: 'x'.repeat(TENANT_OG_TITLE_MAX_LENGTH),
      ogDescription: 'description',
    });
    await openSettingsSection(en.settingsNavigation.brand);

    expect(await screen.findByTestId('branding-og-description-count')).toHaveTextContent(
      en.branding.charCount({ used: 11, limit: TENANT_OG_DESCRIPTION_MAX_LENGTH }),
    );
    const titleCount = screen.getByTestId('branding-og-title-count');
    expect(titleCount).toHaveTextContent(
      en.branding.charCount({ used: TENANT_OG_TITLE_MAX_LENGTH, limit: TENANT_OG_TITLE_MAX_LENGTH }),
    );
    expect(titleCount).toHaveTextContent(en.branding.charLimitReached);
  }, BRANDING_TEST_TIMEOUT);

  it('renames the tenant and round-trips social profiles without a slug field', async () => {
    const { queryClient, updates } = renderPanel();
    await openSettingsSection(en.settingsNavigation.brand);
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    const name = await screen.findByTestId('branding-name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Practitioner Academy');
    await userEvent.click(screen.getByTestId('branding-social-add'));
    await userEvent.type(screen.getByTestId('branding-social-label-0'), 'YouTube');
    await userEvent.type(
      screen.getByTestId('branding-social-url-0'),
      'https://youtube.com/@academy',
    );
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await findToast('success')).toBeInTheDocument();
    expect(updates).toContainEqual(expect.objectContaining({
      name: 'Practitioner Academy',
      socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@academy' }],
    }));
    expect(updates.some((update) => typeof update === 'object' && update !== null && 'slug' in update))
      .toBe(false);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['me'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['public-offer'] });
  }, BRANDING_TEST_TIMEOUT);

  it('marks a non-http profile URL before sending settings', async () => {
    const { updates } = renderPanel();
    await openSettingsSection(en.settingsNavigation.brand);

    await screen.findByTestId('branding-name');
    await userEvent.click(screen.getByTestId('branding-social-add'));
    await userEvent.type(screen.getByTestId('branding-social-label-0'), 'Profile');
    await userEvent.type(screen.getByTestId('branding-social-url-0'), 'ftp://social.example.com/acme');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByText(en.branding.socialLinkUrlInvalid)).toBeInTheDocument();
    expect(screen.getByTestId('branding-social-url-0')).toHaveAttribute('aria-invalid', 'true');
    expect(updates).toHaveLength(0);
  }, BRANDING_TEST_TIMEOUT);

  it('previews the accent in the swatch as you type', async () => {
    renderPanel();
    await openSettingsSection(en.settingsNavigation.brand);

    await userEvent.type(await screen.findByTestId('branding-accent-color'), '#0E7490');

    await waitFor(() => {
      expect(screen.getByTestId('branding-accent-swatch')).toHaveStyle({ backgroundColor: '#0E7490' });
    });
  }, BRANDING_TEST_TIMEOUT);

  it('rejects a malformed accent color without calling the API', async () => {
    const { updates } = renderPanel();
    await openSettingsSection(en.settingsNavigation.brand);

    await userEvent.type(await screen.findByTestId('branding-accent-color'), 'blue');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByText(en.branding.accentInvalid)).toBeInTheDocument();
    expect(queryToast('success')).not.toBeInTheDocument();
    expect(updates).toHaveLength(0);
  }, BRANDING_TEST_TIMEOUT);

  it('clears branding by saving empty fields', async () => {
    const { updates } = renderPanel({
      ...EMPTY_SETTINGS,
      logoUrl: 'https://cdn.example.com/logo.svg',
      accentColor: '#0E7490',
    });
    await openSettingsSection(en.settingsNavigation.brand);

    const logoInput = await screen.findByTestId('branding-logo-url');
    await waitFor(() => {
      expect(logoInput).toHaveValue('https://cdn.example.com/logo.svg');
    });
    await userEvent.clear(logoInput);
    await userEvent.clear(screen.getByTestId('branding-accent-color'));
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await findToast('success')).toBeInTheDocument();
    expect(updates).toContainEqual({
      name: 'Academy',
      socialLinks: [],
      logoUrl: null,
      logoDarkUrl: null,
      accentColor: null,
      faviconUrl: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
    });
  }, BRANDING_TEST_TIMEOUT);

  it('saves the dark logo variant beside the light one', async () => {
    const user = userEvent.setup();
    const { updates } = renderPanel();
    await openSettingsSection(en.settingsNavigation.brand);

    await user.click(await screen.findByTestId('branding-logo-url'));
    await user.paste('https://cdn.example.com/light.svg');
    await user.click(screen.getByTestId('branding-logo-dark-url'));
    await user.paste('https://cdn.example.com/dark.svg');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await findToast('success')).toBeInTheDocument();
    expect(updates).toContainEqual(expect.objectContaining({
      logoUrl: 'https://cdn.example.com/light.svg',
      logoDarkUrl: 'https://cdn.example.com/dark.svg',
    }));
  }, BRANDING_TEST_TIMEOUT);

  it('previews each logo slot on its matching background swatch', async () => {
    renderPanel({
      ...EMPTY_SETTINGS,
      logoUrl: 'https://cdn.example.com/light.svg',
      logoDarkUrl: 'https://cdn.example.com/dark.svg',
    });
    await openSettingsSection(en.settingsNavigation.brand);

    expect(await screen.findByTestId('branding-logo-url-preview-surface'))
      .toHaveAttribute('data-background', 'light');
    expect(screen.getByTestId('branding-logo-dark-url-preview-surface'))
      .toHaveAttribute('data-background', 'dark');
  }, BRANDING_TEST_TIMEOUT);

  it('removes the dark logo without touching the light one', async () => {
    const { updates } = renderPanel({
      ...EMPTY_SETTINGS,
      logoUrl: 'https://cdn.example.com/light.svg',
      logoDarkUrl: 'https://cdn.example.com/dark.svg',
    });
    await openSettingsSection(en.settingsNavigation.brand);

    await userEvent.click(await screen.findByTestId('branding-logo-dark-url-remove'));
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await findToast('success')).toBeInTheDocument();
    expect(updates).toContainEqual(expect.objectContaining({
      logoUrl: 'https://cdn.example.com/light.svg',
      logoDarkUrl: null,
    }));
  }, BRANDING_TEST_TIMEOUT);

  it('fills the share image field from an upload and still accepts a typed URL', async () => {
    const servePath = '/api/public/assets/share-image/6f1c0f2e-2b8a-4c3d-8e5f-9a0b1c2d3e4f.png';
    server.use(
      http.post('/api/image-assets/branding/upload', () => HttpResponse.json({
        ok: true,
        data: {
          key: 'image-assets/tenant-academy/share-image/6f1c0f2e-2b8a-4c3d-8e5f-9a0b1c2d3e4f.png',
          servePath,
          upload: {
            url: 'https://storage.example.com/put',
            headers: { 'content-type': 'image/png' },
            expiresAt: '2026-09-03T12:00:00.000Z',
          },
        },
      })),
      http.put('https://storage.example.com/put', () => new HttpResponse(null, { status: 200 })),
      http.post('/api/image-assets/branding/complete', () =>
        HttpResponse.json({ ok: true, data: { url: servePath } })),
    );
    const { updates } = renderPanel();
    await openSettingsSection(en.settingsNavigation.brand);

    const shareImageInput = await screen.findByTestId('branding-og-image-url');
    await userEvent.upload(
      screen.getByTestId('branding-og-image-url-file-input'),
      new File(['x'], 'share.png', { type: 'image/png' }),
    );
    await waitFor(() => {
      expect(shareImageInput).toHaveValue(servePath);
    });

    await userEvent.clear(shareImageInput);
    await userEvent.type(shareImageInput, 'https://cdn.example.com/share.png');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await findToast('success')).toBeInTheDocument();
    expect(updates).toContainEqual(expect.objectContaining({
      ogImageUrl: 'https://cdn.example.com/share.png',
    }));
  }, BRANDING_TEST_TIMEOUT);
});
