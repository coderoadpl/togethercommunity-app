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
    claimDue: async ({ now, leaseMs }) => {
      for (const job of jobs) {
        if (job.status === 'running' && job.lockedAt !== null && Date.parse(job.lockedAt) < Date.parse(now) - leaseMs) {
          Object.assign(job, { status: 'pending', lockedAt: null, updatedAt: now });
        }
      }
      const due = jobs
        .filter((job) => ['pending', 'submitted', 'succeeded'].includes(job.status) && job.nextAttemptAt !== null && job.nextAttemptAt <= now)
        .toSorted((left, right) => (left.nextAttemptAt ?? '').localeCompare(right.nextAttemptAt ?? '') || left.id.localeCompare(right.id))[0];
      if (due === undefined) return null;
      const refunding = due.status === 'pending';
      Object.assign(due, refunding
        ? { status: 'running', attempts: due.attempts + 1, lockedAt: now, updatedAt: now }
        : { lockedAt: now, nextAttemptAt: new Date(Date.parse(now) + leaseMs).toISOString(), updatedAt: now });
      return { job: structuredClone(due), phase: refunding ? 'refund' : 'status_check', lease: { status: due.status, lockedAt: now } };
    },
    release: async (tenantId, jobId, lease, { now, ...update }) => {
      const job = jobs.find((candidate) => candidate.tenantId === tenantId && candidate.id === jobId
        && candidate.status === lease.status && candidate.lockedAt === lease.lockedAt);
      if (job === undefined) return null;
      Object.assign(job, { ...update, lockedAt: null, updatedAt: now });
      return structuredClone(job);
    },
  };
  return { repository, jobs };
};
