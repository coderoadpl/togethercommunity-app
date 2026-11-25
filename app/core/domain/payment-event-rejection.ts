import { z } from 'zod';

import { ERROR_CODES } from './errors.js';
import { sha256HexOfText } from './change-proposal-group-digest.js';

const PAYMENT_EVENT_REJECTION_MESSAGE_MAX_LENGTH = 500;

export const paymentEventRejectionSchema = z.object({
  tenantId: z.string().min(1),
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  checkoutSessionId: z.string().min(1).nullable(),
  reasonCode: z.enum(ERROR_CODES),
  reasonMessage: z.string().max(PAYMENT_EVENT_REJECTION_MESSAGE_MAX_LENGTH),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  attempts: z.number().int().positive(),
  resolvedAt: z.string().datetime().nullable(),
});

export type PaymentEventRejection = z.output<typeof paymentEventRejectionSchema>;

export const paymentEventRejectionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const RECIPIENT_KEY_LENGTH = 16;

export const paymentEventRejectedOutboxId = (tenantId: string, eventId: string, recipientEmail: string): string =>
  `payment-event-rejected:${tenantId}:${eventId}:${sha256HexOfText(recipientEmail.trim().toLowerCase()).slice(0, RECIPIENT_KEY_LENGTH)}`;
