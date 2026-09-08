import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
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
    const toggle = screen.getByRole('button', { name: pl.integrations.storageCorsJsonToggle });
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
