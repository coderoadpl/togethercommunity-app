import type { PickupPointLookup } from '#core/domain/index.js';

export interface PickupPointDirectory {
  lookup(code: string): Promise<PickupPointLookup>;
}
