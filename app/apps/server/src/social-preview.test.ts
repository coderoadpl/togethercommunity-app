import { describe, expect, it } from 'vitest';

import { renderSocialPreview } from './social-preview.js';

describe('renderSocialPreview', () => {
  it('escapes interpolated metadata and page content', () => {
    const html = renderSocialPreview({
      tenantName: 'Acme "<School>',
      title: 'Learn "<Now>',
      description: 'A "<better>" course',
      imageUrl: null,
      canonicalUrl: 'https://acme.example/path?a="<',
    });

    expect(html).toContain('<title>Learn &quot;&lt;Now&gt;</title>');
    expect(html).toContain('content="Acme &quot;&lt;School&gt;"');
    expect(html).toContain('content="A &quot;&lt;better&gt;&quot; course"');
    expect(html).toContain('href="https://acme.example/path?a=&quot;&lt;"');
  });

  it('omits image metadata and emits a summary card without an image', () => {
    const html = renderSocialPreview({
      tenantName: 'Acme',
      title: 'Acme',
      description: null,
      imageUrl: null,
      canonicalUrl: 'https://acme.example/',
    });

    expect(html).not.toContain('og:image');
    expect(html).toContain('name="twitter:card" content="summary"');
  });

  it('emits image metadata and a large image card when an image exists', () => {
    const html = renderSocialPreview({
      tenantName: 'Acme',
      title: 'Acme',
      description: null,
      imageUrl: 'https://cdn.example.com/social.png',
      canonicalUrl: 'https://acme.example/',
    });

    expect(html).toContain('property="og:image" content="https://cdn.example.com/social.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });
});
