import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/render.js';
import { StorageWizard, storageCorsJson } from './StorageWizard.js';

describe('StorageWizard CORS settings', () => {
  it.each([
    [['https://courses.example.org']],
    [[
      'https://courses.example.org',
      'https://community.example.org',
      'https://members.example.org',
    ]],
  ])('renders every one of %s tenant origins', (origins) => {
    renderWithProviders(<StorageWizard configured={false} origins={origins} />);

    expect(screen.getAllByTestId(/^storage-cors-origin-\d+$/)).toHaveLength(origins.length);
    origins.forEach((origin, index) => {
      expect(screen.getByTestId(`storage-cors-origin-${String(index + 1)}`)).toHaveTextContent(origin);
    });
  });

  it('generates the exact bucket CORS JSON', () => {
    const origins = ['https://courses.example.org', 'https://members.example.org'];

    expect(JSON.parse(storageCorsJson(origins))).toEqual([{
      AllowedOrigins: origins,
      AllowedMethods: ['PUT', 'GET', 'DELETE'],
      AllowedHeaders: ['Content-Type'],
      ExposeHeaders: ['ETag'],
    }]);

    renderWithProviders(<StorageWizard configured={false} origins={origins} />);
    const policy = screen.getByTestId('storage-cors-json');
    expect(policy.tagName).toBe('CODE');
    expect(policy.textContent).toBe(storageCorsJson(origins));
  });
});
