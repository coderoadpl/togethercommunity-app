import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/en.js';
import { server } from '../../../test/server.js';
import { renderDirectory } from './directory-test-helpers.js';
import { DocumentCreatePage } from './DocumentsPanel.js';

describe('legal document body', () => {
  it('saves the Markdown written in the editor and explains an empty body', async () => {
    const requests: unknown[] = [];
    server.use(http.post('/api/marketing/documents', async ({ request }) => {
      requests.push(await request.json());
      return HttpResponse.json({ ok: true, data: { document: { id: 'document-1', tenantId: 'tenant-studio', slug: 'terms', title: 'Terms', status: 'draft', createdAt: '2026-09-09T10:00:00.000Z', updatedAt: '2026-09-09T10:00:00.000Z' } } });
    }));
    const user = userEvent.setup();
    await renderDirectory(DocumentCreatePage, '/panel/marketing/documents/new');

    expect(await screen.findByTestId('marketing-document-markdown-wysiwyg')).toBeInTheDocument();
    await user.type(screen.getByLabelText(en.marketing.slugLabel), 'terms');
    await user.type(screen.getByLabelText(en.marketing.titleLabel), 'Terms');
    await user.click(screen.getByRole('button', { name: en.marketing.createDocumentAction }));

    expect(await screen.findByText(en.marketing.documentMarkdownRequired)).toBeInTheDocument();
    expect(requests).toHaveLength(0);

    await user.click(screen.getByRole('tab', { name: en.markdownEditor.markdownTab }));
    await user.type(screen.getByTestId('marketing-document-markdown-markdown'), '## Terms');
    await user.click(screen.getByRole('button', { name: en.marketing.createDocumentAction }));

    expect(requests).toEqual([{ slug: 'terms', title: 'Terms', content: '## Terms' }]);
  });
});
