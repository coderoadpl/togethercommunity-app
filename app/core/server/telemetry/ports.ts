import type {
  AppError, Result,
} from '#core/domain/index.js';
import type {
  TelemetryEvent, TelemetryStoreSettings, TelemetryStoreView,
} from '#core/domain/telemetry.js';

export interface TelemetryWriter {
  appendBatch(tenantId: string, events: TelemetryEvent[]): Promise<void>;
}
export interface TelemetryReader {
  campaignStats(tenantId: string, campaignIds: string[]): Promise<Array<{
    campaignId: string; totalOpens: number; uniqueOpens: number; totalClicks: number; uniqueClicks: number;
  }>>;
  contactTimeline(tenantId: string, contactId: string, cursor: string | null, limit: number): Promise<{ events: TelemetryEvent[]; nextCursor: string | null }>;
  bounceComplaints(tenantId: string, cursor: string | null, limit: number): Promise<{ events: TelemetryEvent[]; nextCursor: string | null }>;
}
export interface TelemetryStoreProbe {
  probe(tenantId: string): Promise<Result<void, AppError>>;
}
export interface TelemetryErasure {
  deleteSubject(tenantId: string, contactId: string): Promise<void>;
}
export interface TelemetryStore extends TelemetryWriter, TelemetryReader, TelemetryStoreProbe, TelemetryErasure {
  close(tenantId: string): Promise<void>;
}
export interface TelemetryStoreFactory {
  open(tenantId: string, connectionString: string): TelemetryStore;
}
export interface TelemetryCheckpoint {
  acknowledge(tenantId: string, throughSequence: number, at: string): Promise<void>;
  status(tenantId: string, now: string): Promise<TelemetryStoreView['sync']>;
}
export interface TelemetryOutbox extends TelemetryCheckpoint {
  pending(tenantId: string, now: string, limit: number): Promise<Array<{ sequence: number; event: TelemetryEvent; attempts: number }>>;
  retry(tenantId: string, throughSequence: number, retryAt: string): Promise<void>;
  discard(tenantId: string): Promise<void>;
}
export interface TelemetrySettingsRepository {
  get(tenantId: string): Promise<TelemetryStoreSettings>;
  save(tenantId: string, settings: TelemetryStoreSettings): Promise<void>;
}
