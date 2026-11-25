import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { StorageWizard, storageCorsJson } from './StorageWizard.js';

const openConnectionStep = async () => {
  await userEvent.click(screen.getByTestId('storage-provider-minio'));
  await userEvent.click(screen.getByTestId('storage-provider-continue'));
};

describe('StorageWizard CORS settings', () => {
  it.each([
    [['https://courses.example.org']],
    [[
      'https://courses.example.org',
      'https://community.example.org',
      'https://members.example.org',
    ]],
  ])('renders every one of %s tenant origins in the connection step', async (origins) => {
    renderWithProviders(<StorageWizard configured={false} origins={origins} />);
    await openConnectionStep();

    expect(screen.getAllByTestId(/^storage-cors-origin-\d+$/)).toHaveLength(origins.length);
    origins.forEach((origin, index) => {
      expect(screen.getByTestId(`storage-cors-origin-${String(index + 1)}`)).toHaveTextContent(origin);
    });
  });

  it('generates the exact bucket CORS JSON', async () => {
    const origins = ['https://courses.example.org', 'https://members.example.org'];

    expect(JSON.parse(storageCorsJson(origins))).toEqual([{
      AllowedOrigins: origins,
      AllowedMethods: ['PUT', 'GET', 'DELETE'],
      AllowedHeaders: ['Content-Type'],
      ExposeHeaders: ['ETag'],
    }]);

    renderWithProviders(<StorageWizard configured={false} origins={origins} />);
    await openConnectionStep();

    expect(screen.queryByTestId('storage-cors-json')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: en.integrations.storageCorsJsonToggle });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'storage-cors-json-panel');
    expect(document.getElementById('storage-cors-json-panel')).toBeInTheDocument();

    const policy = screen.getByTestId('storage-cors-json');
    expect(policy.tagName).toBe('CODE');
    expect(policy.textContent).toBe(storageCorsJson(origins));
    expect(screen.getByTestId('storage-cors-json-copy')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
    expect(screen.queryByTestId('storage-cors-json')).not.toBeInTheDocument();
  });

  it('opens on the provider step without CORS settings above it', () => {
    renderWithProviders(<StorageWizard configured={false} origins={['https://courses.example.org']} />);

    expect(screen.getByTestId('storage-provider-step')).toBeInTheDocument();
    expect(screen.queryByTestId('storage-cors-settings')).not.toBeInTheDocument();
  });

  it('keeps CORS origins visible after the bucket field while the JSON is collapsed', async () => {
    renderWithProviders(<StorageWizard configured={false} origins={['https://courses.example.org']} />);
    await openConnectionStep();

    const bucket = screen.getByTestId('storage-bucket');
    const cors = screen.getByTestId('storage-cors-settings');
    const accessKey = screen.getByTestId('storage-access-key');

    expect((bucket.compareDocumentPosition(cors) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect((cors.compareDocumentPosition(accessKey) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect(screen.getByTestId('storage-cors-origin-1')).toHaveTextContent('https://courses.example.org');
    expect(screen.getByTestId('storage-cors-json-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('storage-cors-json-toggle')).not.toHaveAttribute('aria-controls');
    expect(screen.queryByTestId('storage-cors-json')).not.toBeInTheDocument();
  });
});

describe('StorageWizard download link check', () => {
  const diagnostic = (signedResponseOverrides: 'honoured' | 'ignored' | 'refused') => ({
    code: 'storage.available',
    message: 'Server diagnostic text',
    signedResponseOverrides,
  });

  const probeAndSave = async (signedResponseOverrides: 'honoured' | 'ignored' | 'refused') => {
    server.use(
      http.post('/api/integrations/storage/probe', () => HttpResponse.json({ ok: true, data: { diagnostic: diagnostic(signedResponseOverrides) } })),
      http.post('/api/integrations/storage/configure', () => HttpResponse.json({
        ok: true,
        data: {
          diagnostic: diagnostic(signedResponseOverrides),
          secret: { key: 's3.configuration', maskedPreview: 'acce…', updatedAt: '2026-11-20T10:00:00.000Z' },
        },
      })),
    );
    renderWithProviders(<StorageWizard configured={false} origins={['https://courses.example.org']} />);
    await openConnectionStep();
    await userEvent.type(screen.getByTestId('storage-endpoint'), 'https://storage.example.org');
    await userEvent.type(screen.getByTestId('storage-bucket'), 'files');
    await userEvent.type(screen.getByTestId('storage-access-key'), 'access');
    await userEvent.type(screen.getByTestId('storage-secret-key'), 'secret');
    await userEvent.click(screen.getByTestId('storage-connection-continue'));
    await userEvent.click(screen.getByTestId('storage-probe'));
  };

  it.each([
    ['refused', en.integrations.storageDownloadOverridesRefused, en.integrations.storageSavedOverridesRefused],
    ['ignored', en.integrations.storageDownloadOverridesIgnored, en.integrations.storageSavedOverridesIgnored],
  ] as const)('warns after a successful probe and confirms the save with the warning when the storage %s the download link overrides', async (outcome, warning, saved) => {
    await probeAndSave(outcome);

    expect(await screen.findByTestId('storage-probe-warning')).toHaveTextContent(warning);
    expect(screen.queryByTestId('storage-probe-success')).not.toBeInTheDocument();
    expect(screen.queryByText('Server diagnostic text')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('storage-save'));
    const savedWarning = await screen.findByTestId('storage-save-warning');
    expect(savedWarning).toHaveTextContent(saved);
    expect(savedWarning).toHaveTextContent(en.integrations.storageSaved.replace(/\.$/u, ''));
    expect(savedWarning).not.toHaveTextContent('You can still save');
  });

  it('shows plain success when the storage honours the download link overrides', async () => {
    await probeAndSave('honoured');

    expect(await screen.findByTestId('storage-probe-success')).toHaveTextContent(en.integrations.storageProbeSuccess);
    expect(screen.queryByTestId('storage-probe-warning')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('storage-save'));
    expect(await screen.findByTestId('storage-save-success')).toBeInTheDocument();
    expect(screen.queryByTestId('storage-save-warning')).not.toBeInTheDocument();
  });
});
