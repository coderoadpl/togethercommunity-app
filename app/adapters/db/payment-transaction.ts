import { internal, type AppError, type Result } from '#core/domain/index.js';
import type { EnrollmentTransactionPort, PaymentTransactionPort } from '#core/server/index.js';

import { createCouponRedemptionRepository } from './coupon-repositories.js';
import { createEmailOutboxRepository } from './email-outbox.js';
import {
  createMemberRepository,
  createMemberSubscriptionRepository,
  createOrderRepository,
  createPaymentRefundRepository,
  createProcessedPaymentEventRepository,
  createProductGrantRepository,
} from './repositories.js';
import type { Db } from './client.js';

export const createPaymentTransactionPort = (db: Db): PaymentTransactionPort => ({
  run: async (operation) => {
    let rejected: Result<never, AppError> | null = null;
    try {
      return await db.transaction(async (tx) => {
        const members = createMemberRepository(tx);
        const grants = createProductGrantRepository(tx);
        const emailOutbox = createEmailOutboxRepository(tx);
        const enrollmentTransaction: EnrollmentTransactionPort = {
          run: async (nestedOperation) => nestedOperation({ members, grants, emailOutbox }),
        };
        const result = await operation({
          members,
          grants,
          orders: createOrderRepository(tx),
          subscriptions: createMemberSubscriptionRepository(tx),
          paymentRefunds: createPaymentRefundRepository(tx),
          couponRedemptions: createCouponRedemptionRepository(tx),
          emailOutbox,
          processedPaymentEvents: createProcessedPaymentEventRepository(tx),
          enrollmentTransaction,
        });
        if (!result.ok) {
          rejected = result;
          tx.rollback();
        }
        return result;
      });
    } catch (cause) {
      if (rejected !== null) return rejected;
      return {
        ok: false,
        error: internal(`Could not complete payment transaction: ${String(cause)}`),
      };
    }
  },
});
