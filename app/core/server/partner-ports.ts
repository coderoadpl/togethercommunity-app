import type { AppError, CheckoutSnapshot, Commission, Partner, PartnerCode, PartnerProgram, PartnerCheckoutReservation, Result } from '#core/domain/index.js';

export interface PartnerCheckoutRecovery {
  recovered: true;
  previousStatus: 'released' | 'missing';
  partnerCodeId: string;
  totalRedemptions: number;
  maxRedemptions: number | null;
  overCap: boolean;
}

export interface PartnerRepository {
  listPrograms(tenantId: string): Promise<PartnerProgram[]>;
  findProgram(tenantId: string, id: string): Promise<PartnerProgram | null>;
  saveProgram(tenantId: string, program: PartnerProgram, expectedRevision: number | null): Promise<Result<PartnerProgram, AppError>>;
  listPartners(tenantId: string, programId: string): Promise<Partner[]>;
  findPartner(tenantId: string, id: string): Promise<Partner | null>;
  savePartner(tenantId: string, partner: Partner): Promise<Result<Partner, AppError>>;
  listCodes(tenantId: string, programId: string): Promise<PartnerCode[]>;
  findCode(tenantId: string, id: string): Promise<PartnerCode | null>;
  findCodeByCode(tenantId: string, code: string): Promise<PartnerCode | null>;
  saveCode(tenantId: string, code: PartnerCode, expectedRevision: number | null): Promise<Result<PartnerCode, AppError>>;
  cacheStripeIds(tenantId: string, id: string, stripeIds: { stripeCouponId: string; stripePromotionCodeId: string }, expectedRevision: number): Promise<PartnerCode | null>;
  reserveCheckout(tenantId: string, snapshot: CheckoutSnapshot): Promise<Result<void, AppError>>;
  attachCheckoutSession(tenantId: string, checkoutSnapshotId: string, providerSessionId: string): Promise<void>;
  releaseCheckout(tenantId: string, checkoutSnapshotId: string, now: string): Promise<boolean>;
  listCheckoutReservations(tenantId: string, partnerCodeId: string): Promise<PartnerCheckoutReservation[]>;
  completeCheckout(tenantId: string, checkoutSnapshotId: string, orderId: string, now: string): Promise<Result<undefined | PartnerCheckoutRecovery, AppError>>;
  countRedemptions(tenantId: string, partnerCodeId: string): Promise<number>;
  hasActiveCodeForSalesLink(tenantId: string, salesLinkId: string): Promise<boolean>;
  listCommissions(tenantId: string, programId: string, now: string): Promise<Commission[]>;
  createCommissions(tenantId: string, commissions: Commission[]): Promise<void>;
  voidPendingCommissions(tenantId: string, orderId: string, reason: string, now: string): Promise<void>;
}
