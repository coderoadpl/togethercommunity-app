import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelContextProvider } from '../panel-context.js';
import { SettingsPanel } from './SettingsPanel.js';

interface StoredSettings {
  billingPortalUrl: string | null;
  bunnyStreamLibraryId: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  faviconUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
}

const EMPTY_SETTINGS: StoredSettings = {
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  logoUrl: null,
  accentColor: null,
  faviconUrl: null,
  termsUrl: null,
  privacyUrl: null,
};

const renderPanel = (initial: StoredSettings = EMPTY_SETTINGS) => {
  let settings = { ...initial };
  const updates: unknown[] = [];

  server.use(
    http.get('/api/tenant/settings', () => HttpResponse.json({ ok: true, data: { settings } })),
    http.post('/api/tenant/settings', async ({ request }) => {
      const body = await request.json();
      updates.push(body);
      if (typeof body === 'object' && body !== null) {
        settings = { ...settings, ...body };
      }
      return HttpResponse.json({ ok: true, data: { settings } });
    }),
  );

  renderWithProviders(
    <PanelContextProvider
      value={{
        tenant: { id: 'tenant-akademia', slug: 'akademia', name: 'Akademia', staffRole: 'owner', memberId: null },
        email: 'creator3@together.dev',
      }}
    >
      <SettingsPanel />
    </PanelContextProvider>,
  );

  return { updates };
};

describe('SettingsPanel legal documents', () => {
  it('saves terms and privacy urls through the settings endpoint', async () => {
    const { updates } = renderPanel();

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

describe('SettingsPanel branding', () => {
  it('saves logo, accent color and favicon through the settings endpoint', async () => {
    const { updates } = renderPanel();

    await userEvent.type(await screen.findByTestId('branding-logo-url'), 'https://cdn.example.com/logo.svg');
    await userEvent.type(screen.getByTestId('branding-accent-color'), '#0E7490');
    await userEvent.type(screen.getByTestId('branding-favicon-url'), 'https://cdn.example.com/favicon.svg');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByTestId('branding-saved')).toHaveTextContent(pl.branding.saved);
    expect(updates).toContainEqual({
      logoUrl: 'https://cdn.example.com/logo.svg',
      accentColor: '#0E7490',
      faviconUrl: 'https://cdn.example.com/favicon.svg',
    });
  });

  it('previews the accent in the swatch as you type', async () => {
    renderPanel();

    await userEvent.type(await screen.findByTestId('branding-accent-color'), '#0E7490');

    await waitFor(() => {
      expect(screen.getByTestId('branding-accent-swatch')).toHaveStyle({ backgroundColor: '#0E7490' });
    });
  });

  it('rejects a malformed accent color without calling the API', async () => {
    const { updates } = renderPanel();

    await userEvent.type(await screen.findByTestId('branding-accent-color'), 'niebieski');
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByText(pl.branding.accentInvalid)).toBeInTheDocument();
    expect(screen.queryByTestId('branding-saved')).not.toBeInTheDocument();
    expect(updates).toHaveLength(0);
  });

  it('clears branding by saving empty fields', async () => {
    const { updates } = renderPanel({
      ...EMPTY_SETTINGS,
      logoUrl: 'https://cdn.example.com/logo.svg',
      accentColor: '#0E7490',
    });

    const logoInput = await screen.findByTestId('branding-logo-url');
    await waitFor(() => {
      expect(logoInput).toHaveValue('https://cdn.example.com/logo.svg');
    });
    await userEvent.clear(logoInput);
    await userEvent.clear(screen.getByTestId('branding-accent-color'));
    await userEvent.click(screen.getByTestId('branding-save'));

    expect(await screen.findByTestId('branding-saved')).toBeInTheDocument();
    expect(updates).toContainEqual({ logoUrl: null, accentColor: null, faviconUrl: null });
  });
});
