import type { AppError, MetaCapiState, MetaCapiEvent, MetaCapiPayload, Order, Result } from '#core/domain/index.js';

export interface MetaCapiOrder {
  order: Order;
  consent: MetaCapiState;
  email: string;
  memberDeleted: boolean;
  sourceUrl: string;
  consentAt: string | null;
}
interface MetaCapiCapture {
  ip: string | null;
  userAgent: string | null;
  fbp: string | null;
  textVersion: string;
  textSnapshot: string;
  at: string;
}
export type MetaCapiOrderAccess = { sessionId: string } | { orderToken: string } | { orderId: string; memberId: string };
interface MetaCapiDecisionWrite {
  decision: 'granted' | 'denied' | 'withdrawn';
  capture: MetaCapiCapture;
}
export interface MetaCapiJob extends MetaCapiOrder {
  capture: MetaCapiCapture;
  attempts: number;
}
export type MetaCapiJobOutcome = { event: MetaCapiEvent } | { retryAt: string };
export interface MetaCapiRepository {
  findOrder(tenantId: string, access: MetaCapiOrderAccess): Promise<MetaCapiOrder | null>;
  decide(tenantId: string, access: MetaCapiOrderAccess, decide: (current: MetaCapiOrder) => Promise<Result<MetaCapiDecisionWrite, AppError>>): Promise<Result<MetaCapiState, AppError>>;
  processNext(tenantId: string, now: string, process: (job: MetaCapiJob) => Promise<MetaCapiJobOutcome>): Promise<boolean>;
  listEvents(tenantId: string): Promise<MetaCapiEvent[]>;
  listMemberConsents(tenantId: string, memberId: string): Promise<(MetaCapiState & { orderId: string; consentAt: string | null })[]>;
}
type MetaCapiSendResult = { ok: true; fbtraceId: string | null } | { ok: false; retryable: boolean; error: string };
export interface MetaCapiGateway {
  send(tenantId: string, input: { pixelId: string; accessToken: string; payload: MetaCapiPayload; testEventCode?: string }): Promise<MetaCapiSendResult>;
}
