import { defineConfig } from 'vitest/config';

import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT_SHA__: JSON.stringify('unknown'),
  },
  test: {
    coverage: {
      provider: 'v8',
      all: true,
      reportsDirectory: './coverage',
      reporter: ['text-summary', 'json', 'json-summary'],
      include: [
        'core/**/*.{ts,tsx}',
        'adapters/**/*.{ts,tsx}',
        'apps/**/*.{ts,tsx}',
        'scripts/**/*.ts',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.stories.tsx',
        '**/*.d.ts',
        'apps/web/src/test/**',
        'apps/web/**/*.config.ts',
        'core/domain/snapshots/fixtures.ts',
        'adapters/db/seed.ts',
        'adapters/db/reseed.ts',
        'adapters/db/migrate.ts',
        'scripts/coverage-layers.ts',
        'scripts/coverage-report.ts',
        'scripts/coverage-check.ts',
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          hookTimeout: 60000,
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
            'config-regression/**/*.test.ts',
            'scripts/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          hookTimeout: 60000,
          testTimeout: 15000,
          include: ['apps/web/**/*.test.ts', 'apps/web/**/*.test.tsx'],
          setupFiles: ['apps/web/src/test/setup.ts'],
        },
      },
    ],
  },
});
