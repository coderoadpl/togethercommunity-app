import type { MetaCapiConfig } from '#core/domain/index.js';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';
import { en } from '../../i18n/en.js';
import { metaCapiConfig } from '../../test/meta-capi-fixtures.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { sessionFlag } from '../../theme-mode.js';
import { MetaCapiConsent } from './MetaCapiConsent.js';

const sessionId = 'cs_live_consent';
const dismissal = sessionFlag(`meta-capi-dismissed:${sessionId}`);
const renderConsent = (config: MetaCapiConfig = metaCapiConfig) => renderWithProviders(<MetaCapiConsent config={config} sessionId={sessionId} />);
beforeEach(() => { dismissal.clear(); document.cookie = '_fbp=; Max-Age=0; Path=/'; });

it('shows labelled modal, equal choices, disclosures and privacy link without choosing', async () => {
  const user = userEvent.setup();
  renderConsent();
  expect(screen.getByRole('dialog', { name: metaCapiConfig.heading })).toHaveAttribute('aria-modal', 'true');
  const accept = screen.getByRole('button', { name: metaCapiConfig.acceptLabel });
  const decline = screen.getByRole('button', { name: metaCapiConfig.declineLabel });
  expect(accept).toHaveClass('MuiButton-outlined', 'MuiButton-fullWidth');
  expect(decline).toHaveClass('MuiButton-outlined', 'MuiButton-fullWidth');
  expect(accept).not.toHaveFocus();
  expect(decline).not.toHaveFocus();
  expect(screen.getByRole('link', { name: en.metaCapi.privacyPolicy })).toHaveAttribute('href', metaCapiConfig.privacyUrl);
  await user.click(screen.getByRole('button', { name: en.metaCapi.fieldsToggle }));
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
  decline.focus();
  await user.tab();
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
});

it.each(['granted', 'denied'] as const)('closes immediately for %s and sends the displayed version and browser cookie', async (choice) => {
  let finish: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const requestBody = vi.fn();
  server.use(http.post('/api/public/meta-capi/consent', async ({ request }) => {
    requestBody(await request.json());
    return pending;
  }));
  document.cookie = '_fbp=fb.1.123456.987; Path=/';
  renderConsent();
  fireEvent.click(screen.getByRole('button', { name: choice === 'granted' ? metaCapiConfig.acceptLabel : metaCapiConfig.declineLabel }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(requestBody).toHaveBeenCalledWith({ sessionId, decision: choice, textVersion: metaCapiConfig.textVersion, fbp: 'fb.1.123456.987' }));
  await act(async () => { finish(HttpResponse.json({ ok: true, data: { consent: choice, withdrawnAt: null } })); });
  if (choice === 'granted') expect(await screen.findByRole('button', { name: en.metaCapi.withdraw })).toBeVisible();
});

it.each(['escape', 'backdrop'])('dismisses with %s without recording a choice and waits until a later session', async (method) => {
  const decide = vi.fn(() => HttpResponse.json({ ok: true, data: { consent: 'denied', withdrawnAt: null } }));
  server.use(http.post('/api/public/meta-capi/consent', decide));
  const rendered = renderConsent();
  if (method === 'escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  else {
    const backdrop = document.querySelector('.MuiDialog-container');
    if (!backdrop) throw new Error('Missing dialog backdrop');
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
  }
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  rendered.unmount();
  const revisited = renderConsent();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(decide).not.toHaveBeenCalled();
  revisited.unmount();
  dismissal.clear();
  renderConsent();
  expect(screen.getByRole('dialog')).toBeVisible();
});

it('clears dismissal after a write error so a reload can retry', async () => {
  server.use(http.post('/api/public/meta-capi/consent', () => HttpResponse.error()));
  const rendered = renderConsent();
  fireEvent.click(screen.getByRole('button', { name: metaCapiConfig.declineLabel }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.metaCapi.decisionError);
  expect(dismissal.load()).toBe(false);
  expect(screen.queryByRole('dialog')).toBeNull();
  rendered.unmount();
  renderConsent();
  expect(screen.getByRole('dialog')).toBeVisible();
});

it('keeps a granted state and retry action when guest withdrawal fails, even after disabling CAPI', async () => {
  const requestBody = vi.fn();
  server.use(http.post('/api/public/meta-capi/consent', async ({ request }) => {
    requestBody(await request.json());
    return HttpResponse.error();
  }));
  renderConsent({ ...metaCapiConfig, enabled: false, consent: 'granted' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: en.metaCapi.withdraw }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: en.metaCapi.withdraw })).toBeEnabled();
  expect(requestBody).toHaveBeenCalledWith({ sessionId, decision: 'withdrawn' });
  server.use(http.post('/api/public/meta-capi/consent', () => HttpResponse.json({ ok: true, data: { consent: 'granted', withdrawnAt: '2026-11-05T10:00:00.000Z' } })));
  fireEvent.click(screen.getByRole('button', { name: en.metaCapi.withdraw }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.metaCapi.withdrawn));
  expect(screen.queryByRole('button', { name: en.metaCapi.withdraw })).toBeNull();
});

it.each([
  { ...metaCapiConfig, enabled: false },
  { ...metaCapiConfig, consent: 'denied' as const },
  { ...metaCapiConfig, consent: 'granted' as const },
  { ...metaCapiConfig, withdrawnAt: '2026-11-05T10:00:00.000Z' },
])('does not ask when disabled or already decided: %j', (config) => {
  renderConsent(config);
  expect(screen.queryByRole('dialog')).toBeNull();
});
