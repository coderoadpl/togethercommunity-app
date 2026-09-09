import type { FunctionComponent } from 'react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';

import { MARKETING_CONTACT_ROUTES } from '#core/contract/marketing-contacts.js';
import { PanelContextProvider } from '../panel-context.js';
import { validateContactImportSearch } from './ContactImportWizard.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';

export const fixtureValue = (fixture: { calls: Record<string, unknown> }, method: string): unknown => {
  const call = Object.entries(fixture.calls).find(([key]) => key.startsWith(`${method}:`));
  return z.object({ ok: z.literal(true), value: z.unknown() }).parse(call?.[1]).value;
};

export const installDirectoryFixture = (fixture: { calls: Record<string, unknown> }) => {
  for (const [method, route] of Object.entries(MARKETING_CONTACT_ROUTES)) {
    const call = Object.entries(fixture.calls).find(([key]) => key.startsWith(`${method}:`));
    if (!call) continue;
    const result = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), value: z.unknown() }), z.object({ ok: z.literal(false), error: z.unknown() })]).parse(call[1]);
    const handler = route.method === 'GET' ? http.get : http.post;
    server.use(handler(route.path, () => HttpResponse.json(result.ok ? { ok: true, data: result.value } : result)));
  }
  const consents = Object.keys(fixture.calls).some((key) => key.startsWith('listMarketingConsentDefinitions:'));
  server.use(http.get('/api/marketing/consent-definitions', () => HttpResponse.json({ ok: true, data: consents ? fixtureValue(fixture, 'listMarketingConsentDefinitions') : { definitions: [] } })));
};

const TestPanel = () => <PanelContextProvider value={{ tenant: { id: 'tenant-studio', slug: 'studio', name: 'Studio', staffRole: 'owner', memberId: null }, email: 'creator@example.org', emailVerified: true }}><Outlet /></PanelContextProvider>;
export const renderDirectory = async (component: FunctionComponent, path: string, initialEntry = path) => {
  const root = createRootRoute({ component: TestPanel });
  const page = createRoute({ getParentRoute: () => root, path, component, validateSearch: validateContactImportSearch });
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};
