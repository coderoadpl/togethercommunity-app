import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./core', import.meta.url)),
      '@adapters': fileURLToPath(new URL('./adapters', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'core/**/*.test.ts',
            'core/**/*.test.tsx',
            'adapters/**/*.test.ts',
            'adapters/**/*.test.tsx',
            'apps/cli/**/*.test.ts',
            'apps/cli/**/*.test.tsx',
            'apps/server/**/*.test.ts',
            'apps/server/**/*.test.tsx',
            'eslint-plugin-together/**/*.test.js',
            'scripts/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/**/*.test.ts', 'apps/web/**/*.test.tsx'],
          setupFiles: ['apps/web/src/test/setup.ts'],
        },
      },
    ],
  },
});
