import { describe, expect, it } from 'vitest';

import { productSlugSchema } from '#core/domain/index.js';

import { backfillProductSlugs, type ProductSlugBackfillRow } from './product-metadata-migration.js';

const row = (
  id: string,
  title: string,
  tenantId = 'tenant-1',
  createdAt = '2026-07-01T00:00:00.000Z',
): ProductSlugBackfillRow => ({ id, tenantId, title, createdAt });

describe('product metadata migration', () => {
  it('uses the application transliteration for Polish titles', () => {
    expect(backfillProductSlugs([
      row('p1', 'Wstęp do programowania'),
      row('p2', 'Żółw & Łódź', 'tenant-2'),
    ])).toEqual([
      { id: 'p1', slug: 'wstep-do-programowania' },
      { id: 'p2', slug: 'zo-w-odz' },
    ]);
  });

  it('allocates stable tenant-local suffixes without changing the first slug', () => {
    const migrated = backfillProductSlugs([
      row('p3', 'Creator Club', 'tenant-1', '2026-07-03T00:00:00.000Z'),
      row('p1', 'Creator Club', 'tenant-1', '2026-07-01T00:00:00.000Z'),
      row('p2', 'Creator Club', 'tenant-1', '2026-07-02T00:00:00.000Z'),
      row('p4', 'Creator Club', 'tenant-2', '2026-07-04T00:00:00.000Z'),
    ]);

    expect(migrated).toEqual([
      { id: 'p1', slug: 'creator-club' },
      { id: 'p2', slug: 'creator-club-2' },
      { id: 'p3', slug: 'creator-club-3' },
      { id: 'p4', slug: 'creator-club' },
    ]);
    for (const product of migrated) expect(productSlugSchema.safeParse(product.slug).success).toBe(true);
  });
});
