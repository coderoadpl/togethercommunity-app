import { describe, expect, it } from 'vitest';

import { renderCampaignMarkdown, renderCampaignPreview } from './marketing-markdown.js';

describe('campaign Markdown rendering', () => {
  it('renders GitHub-flavored tables, task lists, and strikethrough', () => {
    const html = renderCampaignMarkdown([
      '| Plan | Status |',
      '| --- | --- |',
      '| Start | ~~later~~ now |',
      '',
      '- [x] Ready',
    ].join('\n'));

    expect(html).toContain('<table>');
    expect(html).toContain('<del>later</del>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
  });

  it('removes unsafe markup and attributes from rendered e-mail HTML', () => {
    const html = renderCampaignMarkdown([
      '<script>alert(1)</script>',
      '<img src="x" onerror="alert(2)">',
      '[unsafe](javascript:alert(3))',
    ].join('\n'));

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('onerror');
  });

  it('interpolates sample variables only after Markdown has rendered', () => {
    const html = renderCampaignPreview('Hello **{{member.name}}** from {{tenant.name}}.');

    expect(html).toContain('<strong>Anna Kowalska</strong>');
    expect(html).toContain('Studio Razem');
    expect(html).not.toContain('{{');
  });
});
