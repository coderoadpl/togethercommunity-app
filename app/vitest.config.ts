import { defineConfig } from 'vitest/config';

export default defineConfig({
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
