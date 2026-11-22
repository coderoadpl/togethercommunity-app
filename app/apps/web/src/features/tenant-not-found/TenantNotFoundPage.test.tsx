import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/en.js';
import { pl } from '../../i18n/pl.js';
import {
  hostHasTenantSubdomain,
  isConfiguredBaseDomainHost,
  isTenantHost,
  tenantUrl,
  usesPlatformAuthSurface,
} from '../../lib/tenant.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { TenantGate } from './TenantNotFoundPage.js';

const children = <div>APP</div>;

const okOffer = () =>
  http.get('/api/public/offer', () =>
    HttpResponse.json({ ok: true, data: { tenant: { slug: 'acme', name: 'Acme' }, contentVersion: 1, products: [] } }));

const anonymousMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } }, { status: 401 }));

const emptyNavigation = () =>
  http.get('/api/public/navigation', () =>
    HttpResponse.json({ ok: true, data: { navigation: { defaultHomeSpaceId: null, spaces: [], courses: [], lockedSpaces: [] } } }));

const deferred = () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
};

afterEach(() => vi.unstubAllEnvs());

describe('tenantUrl', () => {
  it('uses the configured base domain on the apex host', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(tenantUrl('acme', new URL('https://togethercommunity.app'))).toBe(
      'https://acme.togethercommunity.app',
    );
  });

  it('keeps a bare hostname intact without a configured base domain', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');

    expect(tenantUrl('acme', new URL('https://togethercommunity.app'))).toBe(
      'https://acme.togethercommunity.app',
    );
  });

  it('uses the configured base domain on a tenant subdomain and preserves the port', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(tenantUrl('studio', new URL('https://acme.togethercommunity.app:8443'))).toBe(
      'https://studio.togethercommunity.app:8443',
    );
  });

  it('keeps the localhost fallback for local development', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');

    expect(tenantUrl('studio', new URL('http://acme.localhost:48731'))).toBe(
      'http://studio.localhost:48731',
    );
  });

  it('infers the base from a tenant-shaped host without configuration', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');

    expect(tenantUrl('studio', new URL('https://acme.preview.example'))).toBe(
      'https://studio.preview.example',
    );
  });

  it('uses the configured platform base domain from a custom domain', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(tenantUrl('acme', new URL('https://community.customer.example'))).toBe(
      'https://acme.togethercommunity.app',
    );
  });

  it('keeps tenant links on the configured base domain from the start host', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(tenantUrl('acme', new URL('https://start.togethercommunity.app'))).toBe(
      'https://acme.togethercommunity.app',
    );
  });
});

describe('platform host helpers', () => {
  it('recognizes both the configured base domain and its start host', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(isConfiguredBaseDomainHost('togethercommunity.app')).toBe(true);
    expect(isConfiguredBaseDomainHost('START.TOGETHERCOMMUNITY.APP')).toBe(true);
    expect(isConfiguredBaseDomainHost('acme.togethercommunity.app')).toBe(false);
  });

  it('uses the platform auth surface on the base and start hosts only', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(usesPlatformAuthSurface('togethercommunity.app')).toBe(true);
    expect(usesPlatformAuthSurface('start.togethercommunity.app')).toBe(true);
    expect(usesPlatformAuthSurface('acme.togethercommunity.app')).toBe(false);
  });

  it('keeps the existing single-tenant platform fallback without configuration', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');

    expect(isConfiguredBaseDomainHost('start.example.com')).toBe(false);
    expect(usesPlatformAuthSurface('start.example.com')).toBe(true);
  });
});

describe('hostHasTenantSubdomain', () => {
  it('is false on the configured apex domain', () => {
    expect(hostHasTenantSubdomain('togethercommunity.app', 'togethercommunity.app')).toBe(false);
  });

  it('is true for a single-label tenant subdomain', () => {
    expect(hostHasTenantSubdomain('acme.togethercommunity.app', 'togethercommunity.app')).toBe(true);
  });

  it('is false on the derived platform host', () => {
    expect(hostHasTenantSubdomain('start.togethercommunity.app', 'togethercommunity.app')).toBe(false);
  });

  it('supports the localhost fallback', () => {
    expect(hostHasTenantSubdomain('acme.localhost', 'localhost')).toBe(true);
  });

  it('ignores custom domains and multi-label tenant hosts', () => {
    expect(hostHasTenantSubdomain('community.customer.example', 'togethercommunity.app')).toBe(false);
    expect(hostHasTenantSubdomain('a.b.togethercommunity.app', 'togethercommunity.app')).toBe(false);
  });
});

describe('isTenantHost', () => {
  it.each([
    ['example.com', false],
    ['start.example.com', false],
    ['acme.example.com', true],
    ['courses.example.org', true],
  ])('classifies %s with a configured base domain', (hostname, expected) => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'example.com');

    expect(isTenantHost(hostname)).toBe(expected);
  });

  it('does not treat a custom-looking host as a tenant without a configured base domain', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');

    expect(isTenantHost('courses.example.org')).toBe(false);
    expect(isTenantHost('acme.localhost')).toBe(true);
  });
});

describe('TenantGate', () => {
  it('renders the app on the apex domain without probing', () => {
    renderWithProviders(<TenantGate hostname="localhost">{children}</TenantGate>);
    expect(screen.getByText('APP')).toBeInTheDocument();
  });

  it('renders the app on the platform host without probing', () => {
    renderWithProviders(<TenantGate hostname="start.localhost">{children}</TenantGate>);
    expect(screen.getByText('APP')).toBeInTheDocument();
  });

  it('renders the app on a bare host without a configured base domain without probing', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');
    const probe = vi.fn(() =>
      HttpResponse.json({ ok: false, error: { code: 'tenant_not_found', message: 'no such tenant' } }, { status: 404 }),
    );
    server.use(http.get('/api/public/offer', probe));

    renderWithProviders(<TenantGate hostname="example.org">{children}</TenantGate>);

    expect(screen.getByText('APP')).toBeInTheDocument();
    expect(probe).not.toHaveBeenCalled();
  });

  it('probes a custom domain and shows a friendly 404 when its tenant fails to resolve', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'example.com');
    const probe = vi.fn(() =>
      HttpResponse.json({ ok: false, error: { code: 'tenant_not_found', message: 'no such tenant' } }, { status: 404 }),
    );
    server.use(http.get('/api/public/offer', probe), anonymousMe());

    renderWithProviders(<TenantGate hostname="courses.example.org" pathname="/panel">{children}</TenantGate>);

    expect(await screen.findByTestId('tenant-not-found')).toBeInTheDocument();
    expect(probe).toHaveBeenCalledOnce();
    expect(screen.queryByText('APP')).not.toBeInTheDocument();
  });

  it('renders the app when the tenant subdomain resolves', async () => {
    server.use(okOffer(), anonymousMe());
    renderWithProviders(<TenantGate hostname="acme.localhost" pathname="/panel">{children}</TenantGate>);
    expect(await screen.findByText('APP')).toBeInTheDocument();
  });

  it('starts the session and the home navigation together with the offer', async () => {
    const offerHeld = deferred();
    const requested: string[] = [];
    server.use(
      http.get('/api/public/offer', async () => {
        requested.push('offer');
        await offerHeld.gate;
        return HttpResponse.json({ ok: true, data: { tenant: { slug: 'acme', name: 'Acme' }, contentVersion: 1, products: [] } });
      }),
      http.get('/api/me', () => {
        requested.push('me');
        return HttpResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } }, { status: 401 });
      }),
      http.get('/api/public/navigation', () => {
        requested.push('navigation');
        return HttpResponse.json({ ok: true, data: { navigation: { defaultHomeSpaceId: null, spaces: [], courses: [], lockedSpaces: [] } } });
      }),
    );

    renderWithProviders(<TenantGate hostname="acme.localhost" pathname="/">{children}</TenantGate>);

    await waitFor(() => expect([...requested].sort()).toEqual(['me', 'navigation', 'offer']));
    expect(screen.getByTestId('tenant-gate-pending')).toBeInTheDocument();
    offerHeld.release();
    expect(await screen.findByText('APP')).toBeInTheDocument();
  });

  it('leaves the public navigation alone outside the home path', async () => {
    const navigation = vi.fn(() =>
      HttpResponse.json({ ok: true, data: { navigation: { defaultHomeSpaceId: null, spaces: [], courses: [], lockedSpaces: [] } } }));
    server.use(okOffer(), anonymousMe(), http.get('/api/public/navigation', navigation));

    renderWithProviders(<TenantGate hostname="acme.localhost" pathname="/login">{children}</TenantGate>);

    expect(await screen.findByText('APP')).toBeInTheDocument();
    expect(navigation).not.toHaveBeenCalled();
  });

  it('keeps one splash mounted until the session answers', async () => {
    const sessionHeld = deferred();
    server.use(
      okOffer(),
      emptyNavigation(),
      http.get('/api/me', async () => {
        await sessionHeld.gate;
        return HttpResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } }, { status: 401 });
      }),
    );

    renderWithProviders(<TenantGate hostname="acme.localhost" pathname="/">{children}</TenantGate>);

    const splash = screen.getByTestId('tenant-gate-pending');
    expect(splash).toHaveAccessibleName(en.common.loading);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('tenant-gate-pending')).toBe(splash);
    expect(screen.queryByText('APP')).not.toBeInTheDocument();
    sessionHeld.release();
    expect(await screen.findByText('APP')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-gate-pending')).not.toBeInTheDocument();
  });

  it('paints the splash on the member background outside the panel and on the theme background inside it', () => {
    server.use(
      http.get('/api/public/offer', () => new Promise<never>(() => undefined)),
      http.get('/api/me', () => new Promise<never>(() => undefined)),
      http.get('/api/public/navigation', () => new Promise<never>(() => undefined)),
    );

    const home = renderWithProviders(<TenantGate hostname="acme.localhost" pathname="/">{children}</TenantGate>);
    expect(screen.getByTestId('tenant-gate-pending')).toHaveAttribute('data-surface', 'member');
    home.unmount();

    renderWithProviders(<TenantGate hostname="acme.localhost" pathname="/panel/spaces">{children}</TenantGate>);
    expect(screen.getByTestId('tenant-gate-pending')).toHaveAttribute('data-surface', 'theme');
  });

  it('shows a friendly 404 when an unknown subdomain fails to resolve', async () => {
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({ ok: false, error: { code: 'tenant_not_found', message: 'no such tenant' } }, { status: 404 }),
      ),
      http.get('/api/me', () =>
        HttpResponse.json({ ok: false, error: { code: 'tenant_not_found', message: 'no such tenant' } }, { status: 404 })),
    );
    renderWithProviders(<TenantGate hostname="ghost.localhost" pathname="/panel">{children}</TenantGate>);

    expect(await screen.findByTestId('tenant-not-found')).toBeInTheDocument();
    expect(screen.getByAltText(en.common.appName)).toBeInTheDocument();
    expect(screen.getByText(en.tenantNotFound.title)).toBeInTheDocument();
    expect(screen.queryByText('APP')).not.toBeInTheDocument();
    expect(en.tenantNotFound.title).not.toBe(pl.tenantNotFound.title);
  });

  it('labels the not-found card in words and offers one way out to the start host', async () => {
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({ ok: false, error: { code: 'tenant_not_found', message: 'no such tenant' } }, { status: 404 }),
      ),
      http.get('/api/me', () =>
        HttpResponse.json({ ok: false, error: { code: 'tenant_not_found', message: 'no such tenant' } }, { status: 404 })),
    );
    renderWithProviders(<TenantGate hostname="ghost.localhost" pathname="/panel">{children}</TenantGate>);

    const card = await screen.findByTestId('tenant-not-found');
    expect(card).toHaveTextContent(en.tenantNotFound.eyebrow);
    expect(card).not.toHaveTextContent('404');
    expect(screen.getByRole('heading', { level: 1, name: en.errors.headingTenantNotFound })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: en.tenantNotFound.startCta })).toHaveAttribute(
      'href',
      expect.stringContaining('//start.localhost'),
    );
  });

  it('shows an offer failure in a headed focus card with one retry', async () => {
    let calls = 0;
    server.use(
      http.get('/api/public/offer', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 })
          : HttpResponse.json({ ok: true, data: { tenant: { slug: 'acme', name: 'Acme' }, contentVersion: 1, products: [] } });
      }),
      anonymousMe(),
    );
    const user = userEvent.setup();
    renderWithProviders(<TenantGate hostname="acme.localhost" pathname="/panel">{children}</TenantGate>);

    const card = await screen.findByTestId('tenant-gate-error');
    expect(within(card).getByRole('heading', { level: 1, name: en.errors.headingGeneric })).toBeInTheDocument();
    expect(within(card).getByRole('alert')).toHaveTextContent(en.errors.messageInternal);
    expect(within(card).getAllByRole('button')).toHaveLength(1);
    await user.click(within(card).getByRole('button', { name: en.common.retry }));
    expect(await screen.findByText('APP')).toBeInTheDocument();
  });
});
