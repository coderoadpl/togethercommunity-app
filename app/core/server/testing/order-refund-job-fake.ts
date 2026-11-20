import type { OrderRefundJob } from '#core/domain/index.js';

import type { EmailOutboxEnqueueInput, OrderRefundJobRepository } from '../ports.js';

export const createOrderRefundJobFake = () => {
  const jobs: OrderRefundJob[] = [];
  const alerts: EmailOutboxEnqueueInput[] = [];
  let failingAlertWrites = 0;
  const isDue = (job: OrderRefundJob, now: string) =>
    ['pending', 'blocked_permission', 'submitted', 'succeeded'].includes(job.status) && job.nextAttemptAt !== null && job.nextAttemptAt <= now;
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
        .filter((job) => isDue(job, now))
        .toSorted((left, right) => (left.nextAttemptAt ?? '').localeCompare(right.nextAttemptAt ?? '') || left.id.localeCompare(right.id))[0];
      if (due === undefined) return null;
      const refunding = due.status === 'pending' || due.status === 'blocked_permission';
      Object.assign(due, refunding
        ? { status: 'running', attempts: due.attempts + 1, lockedAt: now, updatedAt: now }
        : { lockedAt: now, nextAttemptAt: new Date(Date.parse(now) + leaseMs).toISOString(), updatedAt: now });
      return { job: structuredClone(due), phase: refunding ? 'refund' : 'status_check', lease: { status: due.status, lockedAt: now } };
    },
    countDue: async ({ now }) => jobs.filter((job) => isDue(job, now)).length,
    release: async (tenantId, jobId, lease, { now, ...update }, staffAlerts = []) => {
      const job = jobs.find((candidate) => candidate.tenantId === tenantId && candidate.id === jobId
        && candidate.status === lease.status && candidate.lockedAt === lease.lockedAt);
      if (job === undefined) return null;
      if (staffAlerts.length > 0 && failingAlertWrites > 0) {
        failingAlertWrites -= 1;
        throw new Error('Could not enqueue email: connection terminated');
      }
      for (const alert of staffAlerts) {
        if (!alerts.some((queued) => queued.id === alert.id)) alerts.push(structuredClone(alert));
      }
      Object.assign(job, { ...update, lockedAt: null, updatedAt: now });
      return structuredClone(job);
    },
    noteChargeRefunded: async (tenantId, orderId, now) => {
      const job = jobs.find((candidate) => candidate.tenantId === tenantId && candidate.orderId === orderId);
      if (job === undefined) return null;
      if (job.status === 'failed' || (job.status === 'blocked_permission' && job.providerRefundId === null)) {
        Object.assign(job, { status: 'resolved_externally', nextAttemptAt: null, lockedAt: null, updatedAt: now });
      } else if (job.status === 'pending') {
        Object.assign(job, { nextAttemptAt: now, updatedAt: now });
      } else {
        return null;
      }
      return structuredClone(job);
    },
  };
  const failAlertWrites = (count: number) => { failingAlertWrites = count; };
  return { repository, jobs, alerts, failAlertWrites };
};
