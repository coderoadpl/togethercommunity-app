import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { ConsentDefinition, ConsentDefinitionVersion } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { formatDateTime } from '../../../lib/format.js';
import { FONT_MONO } from '../../../theme.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ConsentDetailPage, ConsentForm, ConsentsPanel } from './ConsentsPanel.js';

const now = '2026-08-01T10:00:00.000Z';
const hostedDocumentVersionId = 'document-version-uuid-2';
const urlDocumentVersionUrl = 'https://example.test/legal/product-news';

const definition: ConsentDefinition = {
  id: 'consent-news',
  tenantId: 'tenant-1',
  key: 'product-news',
  kind: 'optional_marketing',
  channel: 'email',
  doubleOptIn: false,
  documentRef: { mode: 'hosted', documentId: 'document-privacy' },
  status: 'active',
  createdAt: now,
  updatedAt: now,
};

const hostedVersion: ConsentDefinitionVersion = {
  id: 'consent-news-v2',
  tenantId: 'tenant-1',
  definitionId: definition.id,
  version: 2,
  label: 'Send me product updates',
  documentVersionRef: { mode: 'hosted', documentVersionId: hostedDocumentVersionId },
  createdAt: now,
  createdBy: null,
};

const urlVersion: ConsentDefinitionVersion = {
  ...hostedVersion,
  id: 'consent-news-v3',
  version: 3,
  documentVersionRef: { mode: 'url', url: urlDocumentVersionUrl },
};

const archivedDefinition: ConsentDefinition = {
  ...definition,
  id: 'consent-archived',
  key: 'archived-news',
  status: 'archived',
};

const privacyDocument = (status: 'draft' | 'published' | 'archived' = 'published') => ({
  id: 'document-privacy',
  tenantId: 'tenant-1',
  slug: 'privacy',
  title: 'Privacy policy',
  status,
  createdAt: now,
  updatedAt: now,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  Reflect.deleteProperty(navigator, 'clipboard');
});

const renderRoute = async ({
  path,
  initialEntry,
  component,
}: {
  path: string;
  initialEntry: string;
  component: () => ReactElement;
}) => {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path,
    component,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  renderWithProviders(<RouterProvider router={router} />);
};

const renderConsentForm = async (element: ReactElement = <ConsentForm />) => {
  await renderRoute({
    path: '/panel/marketing/consents/new',
    initialEntry: '/panel/marketing/consents/new',
    component: () => element,
  });
};

describe('ConsentForm', () => {
  it('shows localized field guidance for an invalid consent key', async () => {
    server.use(
      http.get('/api/marketing/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [] } })),
    );
    await renderConsentForm();

    const key = await screen.findByLabelText(en.marketing.keyLabel);
    await userEvent.type(key, 'Product_News');
    await userEvent.type(screen.getByLabelText(en.marketing.wordingLabel), 'Product news');
    await userEvent.type(screen.getByLabelText(en.marketing.documentUrlLabel), 'https://example.test/news');
    await userEvent.click(screen.getByRole('button', { name: en.marketing.createConsentAction }));

    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(en.marketing.keyFormatError)).toBeInTheDocument();
    expect(screen.queryByText(/validation error/i)).not.toBeInTheDocument();
  }, 20_000);

  it('keeps URL mode available and explains hosted mode when no documents are published', async () => {
    server.use(
      http.get('/api/marketing/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [] } })),
    );

    await renderConsentForm();

    expect(await screen.findByText(en.marketing.noPublishedDocuments)).toBeInTheDocument();
    expect(screen.getByLabelText(en.marketing.documentUrlLabel)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: en.marketing.documentModeLabel })).toHaveTextContent(en.marketing.documentUrlMode);
    expect(screen.getByRole('combobox', { name: en.marketing.hostedDocumentLabel })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('link', { name: en.marketing.createDocumentLink })).toHaveAttribute('href', '/panel/marketing/documents/new');
  });

  it('keeps an existing hosted document selected when the document is no longer published', async () => {
    server.use(
      http.get('/api/marketing/documents', () =>
        HttpResponse.json({
          ok: true,
          data: { documents: [privacyDocument('archived')] },
        })),
    );

    await renderConsentForm(<ConsentForm definition={definition} versions={[hostedVersion]} />);

    expect(await screen.findByRole('combobox', { name: en.marketing.documentModeLabel })).toHaveTextContent(en.marketing.documentHostedMode);
    expect(screen.queryByLabelText(en.marketing.documentUrlLabel)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox', { name: en.marketing.hostedDocumentLabel })).toHaveTextContent('Privacy policy'));
    expect(screen.queryByText(en.marketing.noPublishedDocumentsSelect)).not.toBeInTheDocument();
  });

  it('presents immutable keys and fixed metadata as non-editable consent metadata', async () => {
    server.use(
      http.get('/api/marketing/documents', () =>
        HttpResponse.json({
          ok: true,
          data: {
            documents: [privacyDocument()],
          },
        })),
    );

    await renderConsentForm(<ConsentForm definition={definition} versions={[hostedVersion]} />);

    const key = await screen.findByLabelText(en.marketing.keyLabel);
    expect(key).not.toBeDisabled();
    expect(key).toHaveAttribute('readonly');
    expect(key).toHaveStyle({ fontFamily: FONT_MONO });
    expect(screen.getByText(en.marketing.keyImmutableHint)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(en.marketing.purposeMarketing)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(en.marketing.channelEmail)).not.toBeInTheDocument();
    expect(screen.getByText(en.marketing.purposeMarketing)).toHaveClass('MuiChip-label');
    expect(screen.getByText(en.marketing.channelEmail)).toHaveClass('MuiChip-label');
  });

  it('preserves the hosted document reference when saving a wording-only edit', async () => {
    let updateBody: unknown = null;
    server.use(
      http.get('/api/marketing/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [privacyDocument()] } })),
      http.post('/api/marketing/consent-definitions/update', async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json({ ok: true, data: { definition, versions: [hostedVersion] } });
      }),
    );

    await renderConsentForm(<ConsentForm definition={definition} versions={[hostedVersion]} />);

    await userEvent.clear(await screen.findByLabelText(en.marketing.wordingLabel));
    await userEvent.type(screen.getByLabelText(en.marketing.wordingLabel), 'Updated product updates');
    expect(screen.getByText(en.marketing.footerLabelHint)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(en.marketing.footerLabelLabel), 'Product updates');
    await userEvent.click(screen.getByRole('button', { name: en.marketing.saveConsentAction }));

    await waitFor(() => expect(updateBody).toEqual({
      definitionId: definition.id,
      label: 'Updated product updates',
      doubleOptIn: definition.doubleOptIn,
      footerLabel: 'Product updates',
      documentRef: definition.documentRef,
      status: definition.status,
    }));
  });
});

describe('ConsentsPanel', () => {
  it('uses colored status chips and short opt-in chips on consent rows', async () => {
    server.use(
      http.get('/api/marketing/consent-definitions', () =>
        HttpResponse.json({ ok: true, data: { definitions: [definition, archivedDefinition] } })),
    );

    await renderRoute({
      path: '/panel/marketing/consents',
      initialEntry: '/panel/marketing/consents',
      component: ConsentsPanel,
    });

    expect(await screen.findAllByTestId('marketing-consent-row')).toHaveLength(2);
    expect(screen.getByText(en.marketing.active).closest('.MuiChip-root')).toHaveClass('MuiChip-colorSuccess');
    expect(screen.getByText(en.marketing.archived).closest('.MuiChip-root')).toHaveClass('MuiChip-colorWarning');
    expect(screen.getAllByText(en.marketing.singleOptInChip)[0]?.closest('.MuiChip-root')).toHaveClass('MuiChip-colorWarning');
    expect(screen.queryByText(en.marketing.singleOptInWarning)).not.toBeInTheDocument();
  });

  it('shows wording history as version and date, with URLs inline and hosted references copied on request', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    server.use(
      http.get('/api/marketing/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [] } })),
      http.get('/api/marketing/consent-definitions/:id', () =>
        HttpResponse.json({ ok: true, data: { definition, versions: [hostedVersion, urlVersion] } })),
    );

    await renderRoute({
      path: '/panel/marketing/consents/$consentId',
      initialEntry: '/panel/marketing/consents/consent-news',
      component: ConsentDetailPage,
    });

    expect(await screen.findByText(en.marketing.versionLabel({ version: hostedVersion.version }))).toBeInTheDocument();
    expect(screen.getByText(en.marketing.versionLabel({ version: urlVersion.version }))).toBeInTheDocument();
    expect(screen.getAllByText(formatDateTime(hostedVersion.createdAt, 'en')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(urlDocumentVersionUrl)).toBeInTheDocument();
    expect(screen.queryByText(hostedDocumentVersionId)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.marketing.copyDocumentReference }));
    expect(writeText).toHaveBeenCalledWith(hostedDocumentVersionId);
    await waitFor(() => expect(screen.getByTestId('marketing-consent-document-reference-copied')).toHaveTextContent(en.copyField.copied));
  });

  it('reveals and selects the hosted document reference when clipboard copy is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    server.use(
      http.get('/api/marketing/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [] } })),
      http.get('/api/marketing/consent-definitions/:id', () =>
        HttpResponse.json({ ok: true, data: { definition, versions: [hostedVersion] } })),
    );

    await renderRoute({
      path: '/panel/marketing/consents/$consentId',
      initialEntry: '/panel/marketing/consents/consent-news',
      component: ConsentDetailPage,
    });

    await userEvent.click(await screen.findByRole('button', { name: en.marketing.copyDocumentReference }));

    const manualValue = await screen.findByTestId('marketing-consent-document-reference-manual-value');
    expect(manualValue).toHaveTextContent(hostedDocumentVersionId);
    await waitFor(() => expect(window.getSelection()?.toString()).toBe(hostedDocumentVersionId));
  });
});
