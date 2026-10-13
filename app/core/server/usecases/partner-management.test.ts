import { describe, expect, it, vi } from 'vitest';
import { err, validation, appError, ok, memberSchema, partnerCodeSchema, partnerProgramSchema, salesLinkSchema, type Identity } from '#core/domain/index.js';
import type { PartnerManagementDeps } from './partner-management.js';
import { assignPartner, createPartnerCode, createPartnerProgram, updatePartnerCode, updatePartnerProgram } from './partner-management.js';

const now = '2026-10-13T12:00:00.000Z';
const identity: Identity = { userId: 'owner', email: 'owner@example.org', name: 'Owner', emailVerified: true, tenantAccess: 'staff', tenantId: 'tenant', tenantSlug: 'acme', tenantName: 'Workspace', staffRole: 'owner', memberId: null, image: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false };
const program = partnerProgramSchema.parse({ id: 'program', tenantId: 'tenant', name: 'Partners', commissionPct: 50, createdAt: now, revision: 1 });
const partner = { id: 'partner', tenantId: 'tenant', programId: program.id, memberId: 'member', status: 'active' as const, createdAt: now };
const input = { programId: program.id, partnerId: partner.id, code: 'FRIEND10', discountPct: 10, salesLinkIds: ['offer'] };
const code = partnerCodeSchema.parse({ ...input, id: 'code', tenantId: 'tenant', stripeCouponId: null, stripePromotionCodeId: null, createdAt: now, revision: 1 });
const link = salesLinkSchema.parse({ id: 'offer', tenantId: 'tenant', slug: 'offer', title: 'The offer', heading: 'The offer', productIds: ['product'], active: true, allowsCodes: true, revision: 1, createdAt: now, updatedAt: now });
const harness = () => {
  const deps: PartnerManagementDeps = {
    partners: {
      listPrograms: async () => [program], findProgram: async () => program, saveProgram: vi.fn(async (_tenantId, value) => ok(value)),
      listPartners: async () => [partner], findPartner: async () => partner, savePartner: vi.fn(async (_tenantId, value) => ok(value)),
      listCodes: async () => [], findCode: async () => code, findCodeByCode: async () => null, saveCode: vi.fn(async (_tenantId, value) => ok(value)),
      cacheStripeIds: async () => code, reserveCheckout: async () => ok(undefined), attachCheckoutSession: async () => undefined, releaseCheckout: async () => undefined, completeCheckout: async () => ok(undefined), countRedemptions: async () => 0, hasActiveCodeForSalesLink: async () => false,
      listCommissions: async () => [], createCommissions: async () => undefined, voidPendingCommissions: async () => undefined,
    },
    orders: { findById: async () => null },
    coupons: { findByCode: async () => null }, members: { findByEmail: async () => null, findById: async () => null }, salesLinks: { findById: async () => link },
    payments: { ensureCouponPromotion: vi.fn(async () => ok({ stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' })), deactivateCouponPromotion: vi.fn(async () => ok({ deactivated: true as const })), activateCouponPromotion: vi.fn(async () => ok({ activated: true as const })) },
    ids: { nextId: () => 'new-id' }, clock: { nowIso: () => now },
  };
  return deps;
};
describe('partner management', () => {
  it('requires owner or admin capabilities', async () => {
    const deps = harness();
    expect(await createPartnerProgram({ identity: { ...identity, staffRole: null, memberId: 'member', tenantAccess: 'member' } }, { name: 'Partners', commissionPct: 50 }, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(deps.partners.saveProgram).not.toHaveBeenCalled();
  });
  it('creates default program terms and preserves discount constraints on update', async () => {
    const deps = harness();
    expect(await createPartnerProgram({ identity }, { name: 'Partners', commissionPct: 50 }, deps)).toMatchObject({ ok: true, value: { program: { graceDays: 14, revision: 1 } } });
    deps.partners.listCodes = async () => [code];
    expect(await updatePartnerProgram({ identity }, { id: program.id, expectedRevision: 1, name: 'Partners', commissionPct: 5 }, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('requires an existing member and normalises their email', async () => {
    const deps = harness();
    expect(await assignPartner({ identity }, { programId: program.id, email: 'member@example.org' }, deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const member = memberSchema.parse({ id: 'member', tenantId: 'tenant', userId: 'user', email: 'member@example.org', displayName: null, avatarUrl: null, language: null, videoAutoplay: null, deletedAt: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: now });
    deps.members.findByEmail = vi.fn(async () => member);
    expect(await assignPartner({ identity }, { programId: program.id, email: 'MEMBER@example.org' }, deps)).toMatchObject({ ok: true });
    expect(deps.members.findByEmail).toHaveBeenCalledWith('tenant', 'member@example.org');
  });
  it('rejects excessive discounts, foreign partners and offers that disallow codes', async () => {
    const deps = harness();
    expect(await createPartnerCode({ identity }, { ...input, discountPct: 51 }, deps)).toMatchObject({ ok: false, error: { code: 'validation', details: { reason: 'discount_exceeds_commission' } } });
    deps.partners.findPartner = async () => ({ ...partner, programId: 'foreign' });
    expect(await createPartnerCode({ identity }, input, deps)).toMatchObject({ ok: false, error: { details: { reason: 'partner_program_mismatch' } } });
    deps.partners.findPartner = async () => partner;
    deps.salesLinks.findById = async () => ({ ...link, allowsCodes: false });
    expect(await createPartnerCode({ identity }, input, deps)).toMatchObject({ ok: false, error: { message: 'Discount codes are disabled for offer: The offer', details: { reason: 'sales_link_codes_disabled', salesLinkTitle: 'The offer' } } });
    expect(deps.payments.ensureCouponPromotion).not.toHaveBeenCalled();
    expect(deps.partners.saveCode).not.toHaveBeenCalled();
  });
  it('rejects namespace collisions and invalid validity windows before materialising', async () => {
    const deps = harness();
    deps.partners.findCodeByCode = async () => code;
    expect(await createPartnerCode({ identity }, input, deps)).toMatchObject({ ok: false });
    deps.partners.findCodeByCode = async () => null;
    expect(await createPartnerCode({ identity }, { ...input, validFrom: now, validTo: now }, deps)).toMatchObject({ ok: false });
    expect(deps.payments.ensureCouponPromotion).not.toHaveBeenCalled();
  });
  it('materialises positive discounts and keeps zero discount attribution provider-free', async () => {
    const deps = harness();
    expect(await createPartnerCode({ identity }, input, deps)).toMatchObject({ ok: true, value: { code: { stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' } } });
    expect(deps.payments.ensureCouponPromotion).toHaveBeenCalledOnce();
    expect(await createPartnerCode({ identity }, { ...input, discountPct: 0 }, deps)).toMatchObject({ ok: true, value: { code: { stripeCouponId: null, stripePromotionCodeId: null } } });
    expect(deps.payments.ensureCouponPromotion).toHaveBeenCalledOnce();
  });
  it('deactivates archived promotions and rejects stale edits before provider calls', async () => {
    const deps = harness();
    deps.partners.findCode = async () => ({ ...code, stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' });
    expect(await updatePartnerCode({ identity }, { ...input, id: code.id, expectedRevision: 2, status: 'archived' }, deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(deps.payments.deactivateCouponPromotion).not.toHaveBeenCalled();
    expect(await updatePartnerCode({ identity }, { ...input, id: code.id, expectedRevision: 1, status: 'archived' }, deps)).toMatchObject({ ok: true });
    expect(deps.payments.deactivateCouponPromotion).toHaveBeenCalledWith({ tenantId: 'tenant', stripePromotionCodeId: 'promotion' });
  });
  it('archives codes whose assigned offers were deleted', async () => {
    const deps = harness();
    deps.salesLinks.findById = async () => null;
    deps.partners.findCode = async () => ({ ...code, stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' });
    expect(await updatePartnerCode({ identity }, { ...input, id: code.id, expectedRevision: 1, status: 'archived' }, deps)).toMatchObject({ ok: true, value: { code: { salesLinkIds: ['offer'], status: 'archived' } } });
    expect(deps.payments.deactivateCouponPromotion).toHaveBeenCalledWith({ tenantId: 'tenant', stripePromotionCodeId: 'promotion' });
  });
  it('restores the active promotion when its replacement fails', async () => {
    const deps = harness();
    deps.partners.findCode = async () => ({ ...code, stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' });
    deps.payments.ensureCouponPromotion = vi.fn(async () => err(validation('Replacement failed')));
    expect(await updatePartnerCode({ identity }, { ...input, id: code.id, expectedRevision: 1, discountPct: 20 }, deps)).toMatchObject({ ok: false, error: { message: 'Replacement failed' } });
    expect(deps.payments.activateCouponPromotion).toHaveBeenCalledWith({ tenantId: 'tenant', stripePromotionCodeId: 'promotion' });
    expect(deps.partners.saveCode).not.toHaveBeenCalled();
  });
  it('retires a failed replacement and restores the original on a persistence conflict', async () => {
    const deps = harness();
    deps.partners.findCode = async () => ({ ...code, stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' });
    deps.payments.ensureCouponPromotion = vi.fn(async () => ok({ stripeCouponId: 'replacement-coupon', stripePromotionCodeId: 'replacement-promotion' }));
    deps.partners.saveCode = vi.fn(async () => err(appError('conflict', 'Concurrent change')));
    expect(await updatePartnerCode({ identity }, { ...input, id: code.id, expectedRevision: 1, discountPct: 20 }, deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(deps.payments.deactivateCouponPromotion).toHaveBeenNthCalledWith(1, { tenantId: 'tenant', stripePromotionCodeId: 'promotion' });
    expect(deps.payments.deactivateCouponPromotion).toHaveBeenNthCalledWith(2, { tenantId: 'tenant', stripePromotionCodeId: 'replacement-promotion' });
    expect(deps.payments.activateCouponPromotion).toHaveBeenCalledWith({ tenantId: 'tenant', stripePromotionCodeId: 'promotion' });
  });
  it('deactivates a restored promotion when member erasure archives its code during activation', async () => {
    const deps = harness();
    let current = { ...code, stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' };
    let promotionActive = true;
    let activationStarted: () => void = () => undefined;
    let finishActivation: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { activationStarted = resolve; });
    const pending = new Promise<void>((resolve) => { finishActivation = resolve; });
    deps.partners.findCode = async () => current;
    deps.partners.saveCode = vi.fn(async () => err(appError('conflict', 'Concurrent change')));
    deps.payments.deactivateCouponPromotion = vi.fn(async () => {
      promotionActive = false;
      return ok({ deactivated: true as const });
    });
    deps.payments.activateCouponPromotion = vi.fn(async () => {
      activationStarted();
      await pending;
      promotionActive = true;
      return ok({ activated: true as const });
    });
    const update = updatePartnerCode({ identity }, { ...input, id: code.id, expectedRevision: 1, status: 'archived' }, deps);
    await started;
    current = { ...current, status: 'archived', revision: 2 };
    await deps.payments.deactivateCouponPromotion({ tenantId: 'tenant', stripePromotionCodeId: 'promotion' });
    finishActivation();
    expect(await update).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(promotionActive).toBe(false);
    expect(deps.payments.deactivateCouponPromotion).toHaveBeenCalledTimes(3);
  });
  it('restores the promotion when archiving cannot persist', async () => {
    const deps = harness();
    deps.partners.findCode = async () => ({ ...code, stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' });
    deps.partners.saveCode = vi.fn(async () => err(appError('conflict', 'Concurrent change')));
    expect(await updatePartnerCode({ identity }, { ...input, id: code.id, expectedRevision: 1, status: 'archived' }, deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(deps.payments.activateCouponPromotion).toHaveBeenCalledWith({ tenantId: 'tenant', stripePromotionCodeId: 'promotion' });
  });
  it('restores the promotion if persistence rejects unexpectedly', async () => {
    const deps = harness();
    deps.partners.findCode = async () => ({ ...code, stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' });
    deps.partners.saveCode = vi.fn(async () => { throw new Error('Database unavailable'); });
    await expect(updatePartnerCode({ identity }, { ...input, id: code.id, expectedRevision: 1, status: 'archived' }, deps)).rejects.toThrow('Database unavailable');
    expect(deps.payments.activateCouponPromotion).toHaveBeenCalledWith({ tenantId: 'tenant', stripePromotionCodeId: 'promotion' });
  });
  it('deactivates new promotions if transactional offer validation rejects creation', async () => {
    const deps = harness();
    deps.partners.saveCode = vi.fn(async () => err(validation('Offer no longer allows codes')));
    expect(await createPartnerCode({ identity }, input, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(deps.payments.deactivateCouponPromotion).toHaveBeenCalledWith({ tenantId: 'tenant', stripePromotionCodeId: 'promotion' });
  });
  it('deactivates a reactivated replacement if persistence fails', async () => {
    const deps = harness();
    deps.partners.findCode = async () => ({ ...code, status: 'archived', stripeCouponId: 'old-coupon', stripePromotionCodeId: 'old-promotion' });
    deps.partners.saveCode = vi.fn(async () => err(appError('conflict', 'Concurrent change')));
    expect(await updatePartnerCode({ identity }, { ...input, id: code.id, expectedRevision: 1, status: 'active' }, deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(deps.payments.deactivateCouponPromotion).toHaveBeenCalledWith({ tenantId: 'tenant', stripePromotionCodeId: 'promotion' });
    expect(deps.payments.activateCouponPromotion).not.toHaveBeenCalled();
  });
});
