import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './adapters/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together',
  },
});
