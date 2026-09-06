import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import type { StorybookConfig } from '@storybook/react-vite';

const fixtureApi = fileURLToPath(new URL('../apps/web/src/stories/api.fixtures.ts', import.meta.url));
const webApi = fileURLToPath(new URL('../apps/web/src/api.ts', import.meta.url));
const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../apps/web/src/stories/**/*.stories.tsx', '../apps/server/src/**/*.stories.tsx'],
  staticDirs: ['../apps/web/public'],
  addons: [],
  core: { disableTelemetry: true },
  viteFinal: (config) => ({
    ...config,
    define: { ...config.define, __APP_VERSION__: JSON.stringify(pkg.version), __APP_COMMIT_SHA__: JSON.stringify('unknown'), 'import.meta.env.VITE_APP_BASE_DOMAIN': JSON.stringify('localhost') },
    plugins: [...(config.plugins ?? []), {
      name: 'storybook-fixture-api',
      enforce: 'pre',
      resolveId: (source, importer) => {
        if (importer === fixtureApi && source === '../api.js') return webApi;
        if (importer && resolve(dirname(importer), source).replace(/\.js$/, '.ts') === webApi) return fixtureApi;
        return undefined;
      },
    }],
  }),
};

export default config;
