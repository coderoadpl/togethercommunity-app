import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { metaCapiCopy } from '#core/domain/index.js';
import { ToastProvider } from '../../../components/ui/Toast.js';
import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { AnalyticsSettingsPanel } from './AnalyticsSettingsPanel.js';
import { MetaCapiTokenSettings } from './MetaCapiTokenSettings.js';

it('saves CAPI separately from pixel consent and restores empty copy fields to defaults', async () => {
  const updates = vi.fn();
  server.use(
    http.get('/api/tenant/settings', () => HttpResponse.json({ ok: true, data: { settings: { name: 'Acme', socialLinks: [], billingPortalUrl: null, bunnyStreamLibraryId: null } } })),
    http.post('/api/tenant/settings', async ({ request }) => {
      updates(await request.json());
      return HttpResponse.json({ ok: true, data: { settings: { name: 'Acme', socialLinks: [], billingPortalUrl: null, bunnyStreamLibraryId: null } } });
    }),
  );
  renderWithProviders(<ToastProvider><AnalyticsSettingsPanel canEdit /></ToastProvider>);
  const toggle = await screen.findByRole('switch', { name: en.metaCapi.enabled });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(screen.getByRole('textbox', { name: en.metaCapi.copyHeading })).toHaveAttribute('placeholder', metaCapiCopy({}).heading);
  fireEvent.click(toggle);
  fireEvent.change(screen.getByRole('textbox', { name: en.metaCapi.testCode }), { target: { value: 'TEST123' } });
  fireEvent.change(screen.getByRole('textbox', { name: en.metaCapi.copyHeading }), { target: { value: 'Share purchase data' } });
  fireEvent.change(screen.getByRole('textbox', { name: en.metaCapi.copyBody }), { target: { value: ' ' } });
  fireEvent.click(within(screen.getByTestId('analytics-settings')).getByRole('button', { name: en.common.save }));
  await waitFor(() => expect(updates).toHaveBeenCalledWith({
    analyticsMetaCapiEnabled: true, analyticsMetaCapiTestEventCode: 'TEST123', analyticsMetaCapiConsentHeading: 'Share purchase data',
    analyticsMetaCapiConsentBody: null, analyticsMetaCapiConsentAcceptLabel: null, analyticsMetaCapiConsentDeclineLabel: null,
    analyticsTagId: null, analyticsMetaPixelId: null, analyticsConsentCookieName: null, analyticsConsentCookieValue: null, analyticsLoadWithoutConsent: false,
  }));
});

it('keeps the token write-only, clears the draft on save and confirms removal', async () => {
  const user = userEvent.setup();
  let configured = false;
  const saved = vi.fn();
  const removed = vi.fn();
  server.use(
    http.get('/api/tenant-secrets', () => HttpResponse.json({ ok: true, data: { secrets: configured ? [{ key: 'analyticsMetaCapiAccessToken', maskedPreview: 'configured', updatedAt: '2026-11-05T10:00:00.000Z' }] : [], stripeMode: null, stripeWebhookUrl: 'https://example.org/api/webhooks/stripe' } })),
    http.post('/api/tenant-secrets', async ({ request }) => {
      saved(await request.json());
      configured = true;
      return HttpResponse.json({ ok: true, data: { secret: { key: 'analyticsMetaCapiAccessToken', maskedPreview: 'configured', updatedAt: '2026-11-05T10:00:00.000Z' } } });
    }),
    http.delete('/api/tenant-secrets/analyticsMetaCapiAccessToken', () => {
      removed(); configured = false;
      return HttpResponse.json({ ok: true, data: { key: 'analyticsMetaCapiAccessToken' } });
    }),
  );
  renderWithProviders(<MetaCapiTokenSettings />);
  const input = await screen.findByLabelText(en.metaCapi.token);
  expect(input).toHaveAttribute('type', 'password');
  await user.type(input, 'local-token');
  await user.click(screen.getByTestId('secret-save-analyticsMetaCapiAccessToken'));
  await waitFor(() => expect(saved).toHaveBeenCalledWith({ key: 'analyticsMetaCapiAccessToken', value: 'local-token' }));
  await waitFor(() => expect(input).toHaveValue(''));
  expect(screen.queryByDisplayValue('local-token')).toBeNull();
  await user.click(await screen.findByTestId('secret-remove-analyticsMetaCapiAccessToken'));
  await user.click(within(screen.getByRole('dialog')).getByTestId('secret-remove-confirm-analyticsMetaCapiAccessToken'));
  await waitFor(() => expect(removed).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByTestId('secret-remove-analyticsMetaCapiAccessToken')).toBeNull());
});
