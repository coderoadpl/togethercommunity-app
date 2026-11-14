import { z } from 'zod';
import {
  configureShipxInputSchema,
  orderListItemSchema,
  shipxDiscardOutputSchema,
  shipxOrderInputSchema,
  shipxOrderViewSchema,
  shipxSettingsViewSchema,
  shipxShipmentSchema,
} from '#core/domain/index.js';

const shipxLabelFileSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  bytes: z.instanceof(Uint8Array),
});

export const shipxContracts = {
  shipxShipment: { input: shipxOrderInputSchema, output: shipxOrderViewSchema },
  shipxCreate: { input: shipxOrderInputSchema, output: z.object({ order: orderListItemSchema, shipment: shipxShipmentSchema }) },
  shipxDiscard: { input: shipxOrderInputSchema, output: shipxDiscardOutputSchema },
  shipxLabel: { input: shipxOrderInputSchema, output: shipxLabelFileSchema },
  shipxSettings: { input: z.object({}).strict(), output: shipxSettingsViewSchema },
  shipxConfigure: { input: configureShipxInputSchema, output: shipxSettingsViewSchema },
} as const;

export const SHIPX_ROUTES = {
  shipxShipment: { method: 'GET', path: '/api/orders/:orderId/shipx' },
  shipxCreate: { method: 'POST', path: '/api/orders/:orderId/shipx' },
  shipxDiscard: { method: 'POST', path: '/api/orders/:orderId/shipx/discard' },
  shipxLabel: { method: 'GET', path: '/api/orders/:orderId/shipx/label' },
  shipxSettings: { method: 'GET', path: '/api/integrations/shipx' },
  shipxConfigure: { method: 'POST', path: '/api/integrations/shipx/configure' },
} as const;
