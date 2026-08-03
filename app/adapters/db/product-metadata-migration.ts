import { productSlugFromTitle } from '#core/domain/index.js';

export interface ProductSlugBackfillRow {
  id: string;
  tenantId: string;
  title: string;
  createdAt: string;
}

export const backfillProductSlugs = (
  rows: ProductSlugBackfillRow[],
): { id: string; slug: string }[] => {
  const takenByTenant = new Map<string, Set<string>>();
  return [...rows]
    .sort((left, right) =>
      left.tenantId.localeCompare(right.tenantId)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id))
    .map((row) => {
      const taken = takenByTenant.get(row.tenantId) ?? new Set<string>();
      takenByTenant.set(row.tenantId, taken);
      const base = productSlugFromTitle(row.title).slice(0, 90).replace(/-+$/u, '') || 'product';
      let slug = base;
      for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;
      taken.add(slug);
      return { id: row.id, slug };
    });
};
