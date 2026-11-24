import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProductDownloadAssetView } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { DOWNLOAD_PENDING_MS, ProductDownloads } from './ProductDownloads.js';

const version = {
  lineageId: 'asset-guide', productId: 'product-guide', status: 'ready' as const,
  createdAt: '2026-07-01T00:00:00.000Z', personalisationSizeExceeded: false,
};

const previous = {
  ...version, id: 'asset-guide-v1', versionNumber: 1, versionNote: 'First release',
  supersededAt: '2026-07-12T00:00:00.000Z', fileName: 'guide.pdf', contentType: 'application/pdf',
  sizeBytes: 2048, downloadPath: '/api/my/products/product-guide/downloads/asset-guide-v1',
};

const downloads: ProductDownloadAssetView[] = [
  {
    ...version, id: 'asset-guide', versionNumber: 2, versionNote: 'Updated examples', supersededAt: null,
    fileName: 'guide.pdf', contentType: 'application/pdf', sizeBytes: 2_621_440,
    downloadPath: '/api/my/products/product-guide/downloads/asset-guide', previousVersions: [previous],
  },
  {
    ...version, id: 'asset-sheets', lineageId: 'asset-sheets', versionNumber: 1, versionNote: null, supersededAt: null,
    fileName: 'sheets.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 4096, downloadPath: '/api/my/products/product-guide/downloads/asset-sheets', previousVersions: [],
  },
];

const renderDownloads = () => renderWithProviders(
  <ProductDownloads productId="product-guide" productTitle="Field guide" downloads={downloads} />,
);

describe('product downloads', () => {
  it('groups the files under the product title with a Downloads heading', () => {
    renderDownloads();

    const group = screen.getByRole('group', { name: en.student.downloadsGroupLabel({ title: 'Field guide' }) });
    expect(within(group).getByRole('heading', { level: 3, name: en.student.downloadsHeading })).toBeVisible();
  });

  it('leaves the heading to the surrounding card when asked to', () => {
    renderWithProviders(
      <ProductDownloads productId="product-guide" productTitle="Field guide" downloads={downloads} withHeading={false} />,
    );

    const group = screen.getByRole('group', { name: en.student.downloadsGroupLabel({ title: 'Field guide' }) });
    expect(within(group).queryByRole('heading')).not.toBeInTheDocument();
    expect(within(group).getByTestId('download-asset-guide')).toBeVisible();
  });

  it('shows one row per file with a meta line and a Download button named after the file', () => {
    renderDownloads();

    expect(screen.getByTestId('download-meta-asset-guide')).toHaveTextContent('PDF · 2.5 MB · v2');
    expect(screen.getByTestId('download-meta-asset-sheets')).toHaveTextContent('XLSX · 4 KB · v1');
    const guide = screen.getByRole('link', { name: en.student.downloadFileVersion({ name: 'guide.pdf', number: 2 }) });
    expect(guide).toHaveTextContent(en.student.downloadButton);
    expect(guide).toHaveAttribute('href', '/api/my/products/product-guide/downloads/asset-guide');
    expect(screen.getByRole('link', { name: en.student.downloadFileVersion({ name: 'sheets.xlsx', number: 1 }) })).toBeVisible();
    expect(screen.getByText('Updated examples')).toBeVisible();
  });

  it('keeps previous versions in a closed disclosure with the same row layout', async () => {
    renderDownloads();

    expect(screen.getByText('First release')).not.toBeVisible();
    await userEvent.click(screen.getByText(en.products.previousVersions));

    expect(screen.getByText('First release')).toBeVisible();
    expect(screen.getByTestId('download-meta-asset-guide-v1')).toHaveTextContent('PDF · 2 KB · v1');
    expect(screen.getByRole('link', { name: en.student.downloadFileVersion({ name: 'guide.pdf', number: 1 }) }))
      .toHaveAttribute('href', previous.downloadPath);
  });
});

describe('product download pending cue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says the file is being prepared and ignores a second click for a few seconds', () => {
    vi.useFakeTimers();
    renderDownloads();
    const button = screen.getByTestId('download-asset-guide');
    const preventedByPage: boolean[] = [];
    const preventNavigation = (event: Event) => {
      preventedByPage.push(event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener('click', preventNavigation);

    try {
      fireEvent.click(button);
      expect(button).toHaveTextContent(en.student.downloadPreparing);
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleName(`${en.student.downloadPreparing} guide.pdf`);

      fireEvent.click(button);
      expect(preventedByPage).toEqual([false, true]);

      act(() => {
        vi.advanceTimersByTime(DOWNLOAD_PENDING_MS);
      });
      expect(button).toHaveTextContent(en.student.downloadButton);
      expect(button).toHaveAccessibleName(en.student.downloadFileVersion({ name: 'guide.pdf', number: 2 }));
    } finally {
      document.removeEventListener('click', preventNavigation);
    }
  });
});
