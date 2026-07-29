import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../apps/web/src/stories/**/*.stories.tsx'],
  addons: [],
  core: { disableTelemetry: true },
};

export default config;
