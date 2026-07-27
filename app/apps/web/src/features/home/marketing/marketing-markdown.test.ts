import { describe, expect, it } from 'vitest';

import {
  prepareCampaignHtml,
  renderCampaignMarkdown,
  renderCampaignPreview,
} from './marketing-markdown.js';

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

  it('preserves template variables in Markdown links until interpolation', () => {
    const rendered = renderCampaignMarkdown('[Unsubscribe]({{unsubscribeUrl}})');
    const preview = renderCampaignPreview('[Unsubscribe]({{unsubscribeUrl}})');

    expect(rendered).toContain('href="{{unsubscribeUrl}}"');
    expect(rendered).not.toContain('%7B');
    expect(preview).toContain('href="https://example.com/u/sample"');
  });

  it('allows only HTTPS images in Markdown and raw HTML', () => {
    const markdown = renderCampaignMarkdown([
      '![Safe](https://cdn.example.test/photo.jpg)',
      '![Unsafe](http://cdn.example.test/photo.jpg)',
    ].join('\n'));
    const rawHtml = prepareCampaignHtml(
      '<img src="https://cdn.example.test/photo.jpg" alt="Safe"><img src="data:image/png;base64,abc" alt="Unsafe">',
      'html',
    );

    expect(markdown).toContain('src="https://cdn.example.test/photo.jpg"');
    expect(markdown).not.toContain('http://cdn.example.test');
    expect(rawHtml).toContain('src="https://cdn.example.test/photo.jpg"');
    expect(rawHtml).not.toContain('data:image');
  });

  it('uses the same sanitized raw HTML for submission and preview', () => {
    const source = '<table style="color:red"><tr><td>{{member.name}}</td></tr></table><script>alert(1)</script>';

    expect(prepareCampaignHtml(source, 'html')).toBe('<table><tbody><tr><td>{{member.name}}</td></tr></tbody></table>');
    expect(renderCampaignPreview(source, 'html')).toContain('<td>Anna Kowalska</td>');
    expect(renderCampaignPreview(source, 'html')).not.toContain('<script');
  });
});
