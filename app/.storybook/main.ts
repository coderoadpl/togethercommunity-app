import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../apps/web/src/stories/**/*.stories.tsx'],
  addons: [],
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      resolve: {
        alias: {
          '@core': fileURLToPath(new URL('../core', import.meta.url)),
          '@adapters': fileURLToPath(new URL('../adapters', import.meta.url)),
        },
      },
    }),
};

export default config;
