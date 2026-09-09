import { appError, err, ok } from '#core/domain/index.js';
import type { MarketingOutbox } from '#core/domain/marketing-outbox.js';
import type { MarketingSnsInbox } from '#core/domain/marketing-sns-inbox.js';

import type { MarketingDeliveryRepos, MarketingDeliveryTransaction, MarketingOutboxRepository, MarketingSnsInboxRepository } from '../marketing-delivery-ports.js';

class InMemoryMarketingOutboxRepository implements MarketingOutboxRepository {
  readonly rows: MarketingOutbox[] = [];
  async enqueue(tenantId: string, row: MarketingOutbox) { this.rows.push(structuredClone({ ...row, tenantId })); }
  async claim(tenantId: string, input: { workerId: string; now: string; lockedUntil: string }) {
    const row = this.rows.find((item) => item.tenantId === tenantId && ['pending', 'retry'].includes(item.status) && item.nextAttemptAt <= input.now && (item.lockedUntil === null || item.lockedUntil <= input.now));
    if (row === undefined) return null;
    row.lockedBy = input.workerId; row.lockedUntil = input.lockedUntil; row.claimVersion += 1;
    return structuredClone(row);
  }
  async save(tenantId: string, row: MarketingOutbox) {
    const index = this.rows.findIndex((item) => item.tenantId === tenantId && item.id === row.id && item.claimVersion === row.claimVersion);
    if (index < 0) return false;
    this.rows[index] = structuredClone(row); return true;
  }
  async recoverExpired(tenantId: string, now: string) {
    let count = 0;
    for (const row of this.rows) if (row.tenantId === tenantId && row.status === 'dispatching' && row.lockedUntil !== null && row.lockedUntil <= now) {
      row.status = 'uncertain'; row.claimVersion += 1; row.lockedBy = null; row.lockedUntil = null; count += 1;
    }
    return count;
  }
  async listTenantIds() { return [...new Set(this.rows.map((row) => row.tenantId))]; }
  async purge(tenantId: string, before: string, now: string) {
    let count = 0;
    for (const row of this.rows) if (row.tenantId === tenantId && ['sent', 'failed', 'skipped'].includes(row.status) && row.updatedAt < before) {
      row.payload = null; row.payloadPurgedAt = now; count += 1;
    }
    return count;
  }
  async reconcile(tenantId: string, send: { id: string; sesMessageId: string | null }) {
    const row = this.rows.find((item) => item.tenantId === tenantId && item.campaignSendId === send.id);
    if (row !== undefined) { row.status = 'sent'; row.sesMessageId = send.sesMessageId; row.claimVersion += 1; }
  }
}

class InMemoryMarketingSnsInboxRepository implements MarketingSnsInboxRepository {
  readonly rows: MarketingSnsInbox[] = [];
  async record(tenantId: string, row: MarketingSnsInbox) {
    const existing = this.rows.find((item) => item.tenantId === tenantId && item.topicArn === row.topicArn && item.snsMessageId === row.snsMessageId);
    if (existing !== undefined) return existing.bodySha256 === row.bodySha256 ? ok(structuredClone(existing)) : err(appError('conflict', 'Conflicting SNS content'));
    this.rows.push(structuredClone({ ...row, tenantId })); return ok(row);
  }
  async claim(tenantId: string, input: { workerId: string; now: string; lockedUntil: string }) {
    const row = this.rows.find((item) => item.tenantId === tenantId && ['pending', 'retry', 'processing'].includes(item.status) && item.nextAttemptAt <= input.now && (item.lockedUntil === null || item.lockedUntil <= input.now));
    if (row === undefined) return null;
    row.status = 'processing'; row.lockedBy = input.workerId; row.lockedUntil = input.lockedUntil; row.claimVersion += 1; row.attempts += 1;
    return structuredClone(row);
  }
  async save(tenantId: string, row: MarketingSnsInbox) {
    const index = this.rows.findIndex((item) => item.tenantId === tenantId && item.id === row.id && item.claimVersion === row.claimVersion);
    if (index < 0) return false;
    this.rows[index] = structuredClone(row); return true;
  }
  async list(tenantId: string) { return structuredClone(this.rows.filter((row) => row.tenantId === tenantId)); }
  async retry(tenantId: string, id: string, now: string) {
    const row = this.rows.find((item) => item.tenantId === tenantId && item.id === id && ['retry', 'dead_letter'].includes(item.status));
    if (row === undefined) return false;
    row.status = 'retry'; row.nextAttemptAt = now; row.claimVersion += 1; return true;
  }
  async listTenantIds() { return [...new Set(this.rows.map((row) => row.tenantId))]; }
  async purge(tenantId: string, before: string) {
    let count = 0;
    for (const row of this.rows) if (row.tenantId === tenantId && ['processed', 'ignored'].includes(row.status) && row.processedAt !== null && row.processedAt < before) { row.rawBody = null; count += 1; }
    return count;
  }
}

export const createInMemoryMarketingDelivery = (repos: () => Omit<MarketingDeliveryRepos, 'marketingOutbox' | 'snsInbox'>) => {
  const marketingOutbox = new InMemoryMarketingOutboxRepository();
  const snsInbox = new InMemoryMarketingSnsInboxRepository();
  const delivery: MarketingDeliveryTransaction = { run: async (_tenantId, operation) => operation({ ...repos(), marketingOutbox, snsInbox }) };
  return { marketingOutbox, snsInbox, delivery };
};
