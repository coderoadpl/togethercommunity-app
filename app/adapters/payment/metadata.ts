export const checkoutProductIdsMetadata = (
  metadata: Record<string, string> | null | undefined,
): { productIds?: string } => {
  if (metadata?.['productIds']) return { productIds: metadata['productIds'] };
  if (metadata?.['productIds_0'] === undefined) return {};
  const chunks: string[] = [];
  for (let index = 0; metadata[`productIds_${index}`] !== undefined; index += 1) {
    chunks.push(metadata[`productIds_${index}`] ?? '');
  }
  return { productIds: chunks.join('') };
};
