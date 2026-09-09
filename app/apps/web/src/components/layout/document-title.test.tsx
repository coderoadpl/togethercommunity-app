import { StrictMode } from 'react';
import { render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemberPage } from './MemberPage.js';
import { DocumentTitleProvider, useDocumentTitle } from './document-title.js';

describe('useDocumentTitle', () => {
  it.each([
    { parts: [' Course ', null, undefined, '', ' ', ' Acme '], expected: 'Course · Acme' },
    { parts: ['Acme'], expected: 'Acme' },
    { parts: ['Products', 'Studio', 'Acme'], expected: 'Products · Studio · Acme' },
    { parts: [], expected: '' },
  ])('joins $parts as $expected and restores the initial title on unmount', ({ parts, expected }) => {
    const original = document.title;
    const { unmount } = renderHook(() => useDocumentTitle(parts));
    expect(document.title).toBe(expected);
    unmount();
    expect(document.title).toBe(original);
  });

  it('updates without remounting', () => {
    const { rerender } = renderHook(({ page }) => useDocumentTitle([page, 'Acme']), {
      initialProps: { page: 'First lesson' },
    });
    expect(document.title).toBe('First lesson · Acme');
    rerender({ page: 'Next lesson' });
    expect(document.title).toBe('Next lesson · Acme');
  });

  it('keeps the deepest title through tenant updates and restores each fallback in StrictMode', () => {
    const original = document.title;
    const tree = (tenantName: string, page: boolean, studio: boolean) => (
      <StrictMode>
        <DocumentTitleProvider tenantName={tenantName}>
          {studio ? (
            <DocumentTitleProvider tenantName={tenantName} studio>
              {page ? <MemberPage breadcrumbLabel="Breadcrumbs" title="Products" /> : null}
            </DocumentTitleProvider>
          ) : null}
        </DocumentTitleProvider>
      </StrictMode>
    );
    const { rerender, unmount } = render(tree('Acme', true, true));
    expect(document.title).toBe('Products · Studio · Acme');
    rerender(tree('Studio Academy', true, true));
    expect(document.title).toBe('Products · Studio · Studio Academy');
    rerender(tree('Studio Academy', false, true));
    expect(document.title).toBe('Studio Academy');
    rerender(tree('Acme', false, false));
    expect(document.title).toBe('Acme');
    unmount();
    expect(document.title).toBe(original);
  });

  it('uses explicit text for a rich heading and inherits resolved public branding', () => {
    render(
      <DocumentTitleProvider tenantName="Acme">
        <DocumentTitleProvider tenantName={undefined}>
          <MemberPage
            breadcrumbLabel="Breadcrumbs"
            title={<strong>Thread heading</strong>}
            documentTitle="First line of the post"
          />
        </DocumentTitleProvider>
      </DocumentTitleProvider>,
    );
    expect(document.title).toBe('First line of the post · Acme');
  });

  it('falls back to the platform name only without a tenant', () => {
    const { rerender } = render(<DocumentTitleProvider tenantName={null}>{null}</DocumentTitleProvider>);
    expect(document.title).toBe('Together');
    rerender(<DocumentTitleProvider tenantName="Acme">{null}</DocumentTitleProvider>);
    expect(document.title).toBe('Acme');
  });
});
