import { afterEach, describe, expect, it, vi } from 'vitest';

import { publicAssetUrl } from './theme-public-asset.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('publicAssetUrl', () => {
  it.each(['/brand/together-horizontal-light.svg', 'brand/together-horizontal-light.svg'])(
    'keeps app assets at the root on nested routes: %s',
    (path) => {
      vi.stubEnv('BASE_URL', '/');
      vi.spyOn(document, 'baseURI', 'get').mockReturnValue('https://courses.example.org/panel/products/');
      expect(publicAssetUrl(path)).toBe('/brand/together-horizontal-light.svg');
    },
  );

  it.each(['/', '/together-storybook-static/', '/nested/storybook/'])(
    'resolves relative Storybook assets under %s',
    (base) => {
      vi.stubEnv('BASE_URL', './');
      vi.spyOn(document, 'baseURI', 'get').mockReturnValue(`https://courses.example.org${base}iframe.html?id=login`);
      expect(publicAssetUrl('/brand/together-horizontal-dark.svg'))
        .toBe(`https://courses.example.org${base}brand/together-horizontal-dark.svg`);
    },
  );

  it('honors a configured app base', () => {
    vi.stubEnv('BASE_URL', '/community/');
    expect(publicAssetUrl('/brand/together-horizontal-light.svg'))
      .toBe('/community/brand/together-horizontal-light.svg');
  });
});
