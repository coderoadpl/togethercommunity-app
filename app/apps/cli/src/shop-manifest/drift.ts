import { ok } from '#core/domain/index.js';
import { planManifest, type ManifestClientFactory } from './plan.js';

export const driftManifest = async (input: unknown, clientFor: ManifestClientFactory, workspace?: string) => {
  const plan = await planManifest(input, clientFor, workspace);
  if (!plan.ok) return plan;
  const drifted = plan.value.shops.some((shop) => shop.provisioning === 'create' || shop.settings.change.length > 0 ||
    shop.products.some((product) => product.product !== 'unchanged' || product.price !== 'unchanged' ||
      product.deactivatePriceIds.length > 0 || product.publication !== 'unchanged' ||
      (product.stock !== 'unchanged' && product.stock !== 'unmanaged') ||
      (product.cover !== 'unchanged' && product.cover !== 'unmanaged')));
  return ok({ ...plan.value, drifted });
};
