import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { DOWNLOAD_COPY_PAGE_SIZE } from '#core/domain/index.js';

import { LanguageProvider } from '../../../i18n/index.js';
import { pl } from '../../../i18n/pl.js';
import { languagePreference } from '../../../theme-mode.js';
import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { DownloadCopies, DownloadCopyLookup } from './DownloadCopies.js';

const copy = {
  id: 'copy-1', tenantId: 'tenant', copyIdentifier: 'copy_AAAAAAAAAAAAAAAAAAAAAAAAAA',
  memberId: 'member', orderId: 'order', productId: 'product', assetId: 'asset', lineageId: 'lineage',
  versionNumber: 2, fileName: 'workbook.pdf', personalised: false, contentHash: null, bytes: null,
  createdAt: '2026-10-01T12:00:00.000Z',
};

describe('staff copy registry', () => {
  describe.each([{ language: 'en', t: en }, { language: 'pl', t: pl }] as const)('$language', ({ language, t }) => {
    it.each([{ orderId: 'order' }, { memberId: 'member' }, { productId: 'product', copyIdentifier: copy.copyIdentifier }])('lists issued copies for %o', async (query) => {
      server.use(http.get('*/api/download-copies', ({ request }) => {
        const url = new URL(request.url);
        for (const [key, value] of Object.entries(query)) expect(url.searchParams.get(key)).toBe(value);
        return HttpResponse.json({ ok: true, data: { copies: [copy] } });
      }));
      languagePreference.save(language);
      renderWithProviders(<LanguageProvider><DownloadCopies query={query} /></LanguageProvider>);
      expect(await screen.findByText(`${t.downloadCopies.identifier}: ${copy.copyIdentifier}`)).toBeInTheDocument();
      expect(screen.getByText(`${t.downloadCopies.file}: workbook.pdf`)).toBeInTheDocument();
      expect(screen.getByText(`${t.downloadCopies.version}: 2`)).toBeInTheDocument();
      expect(screen.getByText(t.downloadCopies.fallback)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: copy.memberId })).toHaveAttribute('href', '/panel/members/member');
      expect(screen.getByRole('link', { name: copy.orderId })).toHaveAttribute('href', '/panel/sales/order');
      expect(screen.getByText(`${t.downloadCopies.member}:`)).toBeInTheDocument();
      expect(screen.getByText(`${t.downloadCopies.order}:`)).toBeInTheDocument();
      if ('memberId' in query) {
        expect(screen.getByRole('link', { name: copy.productId })).toHaveAttribute('href', '/panel/products/product');
        expect(screen.getByText(`${t.downloadCopies.product}:`)).toBeInTheDocument();
      }
    });
    it('loads older copies on demand and retains the first page', async () => {
      const user = userEvent.setup();
      const cursors: (string | null)[] = [];
      const first = Array.from({ length: DOWNLOAD_COPY_PAGE_SIZE }, (_unused, index) => ({
        ...copy, id: `copy-${String(index)}`, fileName: `workbook-${String(index)}.pdf`,
      }));
      server.use(http.get('*/api/download-copies', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json({ ok: true, data: { copies: cursor === null ? first : [{ ...copy, id: 'older', fileName: 'older.pdf' }] } });
      }));
      languagePreference.save(language);
      renderWithProviders(<LanguageProvider><DownloadCopies query={{ memberId: copy.memberId }} /></LanguageProvider>);
      await user.click(await screen.findByRole('button', { name: t.downloadCopies.showMore }));
      expect(await screen.findByText(`${t.downloadCopies.file}: older.pdf`)).toBeInTheDocument();
      expect(screen.getByText(`${t.downloadCopies.file}: workbook-0.pdf`)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: t.downloadCopies.showMore })).not.toBeInTheDocument();
      expect(cursors).toEqual([null, `${copy.createdAt}~copy-49`]);
    });

    it('labels copies without an order', async () => {
      server.use(http.get('*/api/download-copies', () => HttpResponse.json({ ok: true, data: { copies: [{ ...copy, orderId: null }] } })));
      languagePreference.save(language);
      renderWithProviders(<LanguageProvider><DownloadCopies query={{ memberId: copy.memberId }} /></LanguageProvider>);
      expect(await screen.findByText(`${t.downloadCopies.order}: ${t.downloadCopies.noOrder}`)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: copy.orderId })).not.toBeInTheDocument();
    });
  });

  it('validates identifiers and looks up a copy only inside its product', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    server.use(http.get('*/api/download-copies', ({ request }) => {
      const url = new URL(request.url);
      calls.push(url.searchParams.get('productId') ?? '');
      expect(url.searchParams.get('copyIdentifier')).toBe(copy.copyIdentifier);
      return HttpResponse.json({ ok: true, data: { copies: [copy] } });
    }));
    renderWithProviders(<DownloadCopyLookup productId="product" />);
    await user.click(screen.getByRole('button', { name: en.downloadCopies.search }));
    expect(screen.getByText(en.downloadCopies.invalid)).toBeInTheDocument();
    expect(calls).toEqual([]);
    await user.type(screen.getByRole('textbox', { name: en.downloadCopies.identifier }), copy.copyIdentifier);
    await user.click(screen.getByRole('button', { name: en.downloadCopies.search }));
    expect(await screen.findByText(`${en.downloadCopies.file}: workbook.pdf`)).toBeInTheDocument();
    expect(calls).toEqual(['product']);
  });
});
