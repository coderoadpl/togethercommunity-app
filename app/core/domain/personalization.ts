import { z } from 'zod';

import { validation, type AppError } from './errors.js';
import { err, ok, type Result } from './result.js';

const PERSONALIZATION_MAX_LENGTH_LIMIT = 500;

const DEFAULT_PERSONALIZATION_MAX_LENGTH = 200;

const MAX_CHECKOUT_PERSONALIZATIONS = 20;

const personalizationShape = {
  label: z.string().trim().min(1, 'Personalisation label must not be empty').max(80, 'Personalisation label too long'),
  description: z.string().max(1000, 'Personalisation description too long').default(''),
  inputLabel: z.string().trim().min(1, 'Personalisation input label must not be empty').max(80, 'Personalisation input label too long'),
  maxLength: z.number().int().min(1).max(PERSONALIZATION_MAX_LENGTH_LIMIT).default(DEFAULT_PERSONALIZATION_MAX_LENGTH),
  condition: z.string().trim().min(1, 'Personalisation condition must not be empty').max(1000, 'Personalisation condition too long').nullable().default(null),
};

export const productPersonalizationSchema = z.object(personalizationShape).strict();

export type ProductPersonalization = z.output<typeof productPersonalizationSchema>;

export const publicProductPersonalizationSchema = z.object(personalizationShape);

export type PublicProductPersonalization = z.output<typeof publicProductPersonalizationSchema>;

export const PERSONALIZATION_MEMBERSHIP_MESSAGE = 'A membership cannot offer a personalisation';

export const personalizationAllowed = (type: string, personalization: ProductPersonalization | null | undefined): boolean =>
  personalization == null || type !== 'membership';

const checkoutPersonalizationRequestSchema = z.object({
  productId: z.string().min(1),
  text: z.string().max(4000),
  conditionAccepted: z.boolean(),
}).strict();

export type CheckoutPersonalizationRequest = z.output<typeof checkoutPersonalizationRequestSchema>;

export const checkoutPersonalizationsSchema = z.array(checkoutPersonalizationRequestSchema).max(MAX_CHECKOUT_PERSONALIZATIONS);

export const orderLinePersonalizationSchema = z.object({
  text: z.string(),
  label: z.string(),
  description: z.string(),
  inputLabel: z.string(),
  condition: z.string().nullable(),
  maxLength: z.number().int().positive(),
  requestedAt: z.string().datetime(),
  conditionAcceptedAt: z.string().datetime().nullable(),
  originalText: z.string().optional(),
  editedAt: z.string().datetime().optional(),
  editedBy: z.string().min(1).optional(),
});

export type OrderLinePersonalization = z.output<typeof orderLinePersonalizationSchema>;

const textLengthMessage = (maxLength: number): string => `Personalisation text must contain 1 to ${String(maxLength)} characters`;

export const resolveCheckoutPersonalizations = (
  requests: readonly CheckoutPersonalizationRequest[],
  products: readonly { id: string; personalization?: ProductPersonalization | null | undefined }[],
  requestedAt: string,
): Result<ReadonlyMap<string, OrderLinePersonalization>, AppError> => {
  const resolved = new Map<string, OrderLinePersonalization>();
  for (const request of requests) {
    const product = products.find((item) => item.id === request.productId);
    if (product === undefined) return err(validation('Personalisation was requested for a product outside this checkout', { productId: request.productId }));
    if (resolved.has(request.productId)) return err(validation('Personalisation was requested more than once for the same product', { productId: request.productId }));
    const setting = product.personalization;
    if (setting == null) return err(validation('This product does not offer a personalisation', { productId: request.productId }));
    const text = request.text.trim();
    if (text.length < 1 || text.length > setting.maxLength) return err(validation(textLengthMessage(setting.maxLength), { productId: request.productId }));
    if (setting.condition !== null && !request.conditionAccepted) {
      return err(validation('Accept the personalisation condition before paying', { productId: request.productId }));
    }
    resolved.set(request.productId, {
      text,
      label: setting.label,
      description: setting.description,
      inputLabel: setting.inputLabel,
      condition: setting.condition,
      maxLength: setting.maxLength,
      requestedAt,
      conditionAcceptedAt: setting.condition === null ? null : requestedAt,
    });
  }
  return ok(resolved);
};

export const correctOrderPersonalizationInputSchema = z.object({
  orderId: z.string().min(1),
  productId: z.string().min(1),
  text: z.string().trim().min(1, textLengthMessage(PERSONALIZATION_MAX_LENGTH_LIMIT)).max(PERSONALIZATION_MAX_LENGTH_LIMIT, textLengthMessage(PERSONALIZATION_MAX_LENGTH_LIMIT)),
}).strict();

export const correctedLinePersonalization = (
  current: OrderLinePersonalization | undefined,
  correction: { text: string; editedAt: string; editedBy: string },
): Result<OrderLinePersonalization, AppError> => {
  if (current === undefined) return err(validation('This order line has no personalisation'));
  const text = correction.text.trim();
  if (text.length < 1 || text.length > current.maxLength) return err(validation(textLengthMessage(current.maxLength)));
  return ok({
    ...current,
    text,
    originalText: current.originalText ?? current.text,
    editedAt: correction.editedAt,
    editedBy: correction.editedBy,
  });
};

export const orderPersonalizationSummary = (
  lines: readonly { name: string; personalization?: { text: string } | undefined }[],
): string => lines
  .flatMap((line) => line.personalization === undefined ? [] : [`${line.name}: ${line.personalization.text}`])
  .join('; ');
