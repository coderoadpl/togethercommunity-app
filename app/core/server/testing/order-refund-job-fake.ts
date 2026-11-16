import type { OrderRefundJob } from '#core/domain/index.js';

import type { OrderRefundJobRepository } from '../ports.js';

export const createOrderRefundJobFake = () => {
  const jobs: OrderRefundJob[] = [];
  const repository: OrderRefundJobRepository = {
    enqueue: async (tenantId, job) => {
      if (jobs.some((existing) => existing.tenantId === tenantId && (existing.orderId === job.orderId || existing.idempotencyKey === job.idempotencyKey))) return false;
      jobs.push(structuredClone({ ...job, tenantId }));
      return true;
    },
    findByOrderId: async (tenantId, orderId) => structuredClone(jobs.find((job) => job.tenantId === tenantId && job.orderId === orderId) ?? null),
  };
  return { repository, jobs };
};
