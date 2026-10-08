export const sampleSalesLink = { id: 'link-1', tenantId: 't1', slug: 'complete-bundle', title: 'In-person bundle', heading: 'A complete learning bundle', description: 'One purchase, three complementary products.', productIds: ['product-1', 'product-2', 'product-3'], active: true, listed: false, validFrom: null, validTo: null, revision: 1, createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z' };
export const sampleBundleLines = [
  { productId: 'product-1', name: 'Printed workbook', grossCents: 4200, netCents: 4000, vatRate: 5 as const, vatCents: 200, vatExemptionBasis: null },
  { productId: 'product-2', name: 'Digital reference', grossCents: 2160, netCents: 2000, vatRate: 8 as const, vatCents: 160, vatExemptionBasis: null },
  { productId: 'product-3', name: 'Practice course', grossCents: 12300, netCents: 10000, vatRate: 23 as const, vatCents: 2300, vatExemptionBasis: null },
];
export const sampleBundleProducts = sampleBundleLines.map((line, index) => ({ id: line.productId, tenantId: 't1', type: index === 0 ? 'physical' as const : index === 1 ? 'digital_download' as const : 'course' as const, slug: `product-${index + 1}`, title: line.name, description: '', coverUrl: null, priceCents: line.grossCents, currency: 'PLN' as const, visibility: 'listed' as const, published: true, accessItems: [], legacyId: null, vatRate: line.vatRate, vatExemptionBasis: null, createdAt: '2026-10-08T10:00:00.000Z' }));

export const sampleBundleOrder = {
  id: 'order-2026-001', tenantId: 't1', memberId: 'member-1', productId: 'product-1', priceId: null,
  kind: 'one_time' as const, status: 'paid' as const, amountCents: 18660, currency: 'PLN' as const, provider: 'simulated' as const,
  mode: 'test' as const, providerObjectIds: {}, couponId: null, discountCents: 0, couponCode: null,
  createdAt: '2026-10-08T10:00:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Alex Smith',
  productTitle: 'Printed workbook', salesLinkId: 'link-1', salesLinkTitle: 'In-person bundle',
  verificationToken: 'a'.repeat(64),
  lines: sampleBundleLines.map((line, index) => ({ ...line, productType: index === 0 ? 'physical' as const : index === 1 ? 'digital_download' as const : 'course' as const, issuedCount: index === 0 ? 0 : null })),
};
