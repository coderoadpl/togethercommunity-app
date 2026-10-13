import { describe, expect, it, vi } from 'vitest';
import { ok, partnerCodeSchema, partnerProgramSchema, salesLinkSchema, type PartnerCode } from '#core/domain/index.js';
import type { PartnerRepository } from '../partner-ports.js';
import { materialisePartnerCode, validatePartnerCodeForCheckout } from './partner-checkout.js';

const now = '2026-10-13T10:00:00.000Z';
const code = partnerCodeSchema.parse({ id: 'code', tenantId: 'tenant', programId: 'program', partnerId: 'partner', code: 'SAVE10', discountPct: 10, salesLinkIds: ['offer'], stripeCouponId: null, stripePromotionCodeId: null, createdAt: now, revision: 1 });
const program = partnerProgramSchema.parse({ id: 'program', tenantId: 'tenant', name: 'Program', commissionPct: 50, createdAt: now, revision: 1 });
const link = salesLinkSchema.parse({ id: 'offer', tenantId: 'tenant', slug: 'offer', title: 'Offer', heading: 'Offer', productIds: ['product'], allowsCodes: true, revision: 1, createdAt: now, updatedAt: now });
const repository = (value: PartnerCode = code): PartnerRepository => ({
  listPrograms: async () => [program], findProgram: async () => program, saveProgram: async (_, item) => ok(item),
  listPartners: async () => [], findPartner: async () => ({ id: 'partner', tenantId: 'tenant', programId: program.id, memberId: 'member', status: 'active', createdAt: now }), savePartner: async (_, item) => ok(item),
  listCodes: async () => [value], findCode: async () => value, findCodeByCode: async () => value, saveCode: async (_, item) => ok(item), cacheStripeIds: async () => value,
  reserveCheckout: async () => ok(undefined), attachCheckoutSession: async () => undefined, releaseCheckout: async () => undefined, completeCheckout: async () => ok(undefined), countRedemptions: async () => 0, hasActiveCodeForSalesLink: async () => true,
  listCommissions: async () => [], createCommissions: async () => undefined, voidPendingCommissions: async () => undefined,
});
const deps = (value = code) => ({ partners: repository(value), clock: { nowIso: () => now }, salesLinks: { list: async () => [link], findById: async () => link, findBySlug: async () => link, save: async (_: string, item: typeof link) => ok(item), delete: async () => ok(undefined) } });
const input = { code: 'save10', salesLinkId: 'offer', amountCents: 10005, currency: 'PLN' };

describe('partner checkout validation', () => {
  it('normalises lookup and returns a rounded discount with attribution', async () => {
    const current = deps();
    const find = vi.spyOn(current.partners, 'findCodeByCode');
    expect(await validatePartnerCodeForCheckout('tenant', input, current)).toMatchObject({ ok: true, value: { code: { id: code.id }, breakdown: { discountCents: 1001, finalCents: 9004 } } });
    expect(find).toHaveBeenCalledWith('tenant', 'SAVE10');
  });
  it.each([
    { status: 'archived' as const }, { validFrom: '2026-10-14T00:00:00.000Z' },
    { validTo: now }, { salesLinkIds: ['another-offer'] }, { maxRedemptions: 1 },
  ])('rejects unavailable codes %j', async (patch) => {
    const current = deps({ ...code, ...patch });
    current.partners.countRedemptions = async () => 1;
    expect(await validatePartnerCodeForCheckout('tenant', input, current)).toMatchObject({ ok: false, error: { message: 'Coupon cannot be applied' } });
  });
  it('requires the offer to allow codes and rejects a single product clearly', async () => {
    const current = deps();
    current.salesLinks.findById = async () => ({ ...link, allowsCodes: false });
    expect(await validatePartnerCodeForCheckout('tenant', input, current)).toMatchObject({ ok: false });
    expect(await validatePartnerCodeForCheckout('tenant', { code: input.code, amountCents: 100, currency: 'PLN' }, current)).toMatchObject({ ok: false, error: { message: 'Partner codes require a sales-link offer' } });
  });
  it('leaves unknown codes available to the regular coupon path', async () => {
    const current = deps();
    current.partners.findCodeByCode = async () => null;
    expect(await validatePartnerCodeForCheckout('tenant', input, current)).toEqual(ok(null));
  });
  it('accepts zero percent attribution without a Stripe operation', async () => {
    const current = deps({ ...code, discountPct: 0 });
    const result = await validatePartnerCodeForCheckout('tenant', input, current);
    expect(result).toMatchObject({ ok: true, value: { breakdown: { discountCents: 0, finalCents: input.amountCents } } });
    const ensureCouponPromotion = vi.fn(async () => ok({ stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' }));
    const payment = { createCheckoutSession: async () => ok({ url: 'https://example.test', sessionId: 'session' }), expireCheckoutSession: async () => ok({ expired: true as const }), cancelSubscription: async () => ok({ canceled: true as const, alreadySettled: false }), verifyWebhookEvent: async () => { throw new Error('Unused'); }, test: async () => { throw new Error('Unused'); }, ensureCouponPromotion };
    expect(await materialisePartnerCode('tenant', { ...code, discountPct: 0 }, 'PLN', { partners: current.partners, payment })).toEqual(ok({}));
    expect(ensureCouponPromotion).not.toHaveBeenCalled();
    expect(await materialisePartnerCode('tenant', code, 'PLN', { partners: current.partners, payment })).toEqual(ok({ promotionCodeId: 'promotion' }));
    expect(ensureCouponPromotion).toHaveBeenCalledWith(expect.objectContaining({ couponId: code.id, kind: 'percent', value: 10 }));
  });
  it('rejects a checkout whose promotion cache loses a concurrent code edit', async () => {
    const partners = repository();
    partners.cacheStripeIds = vi.fn(async () => null);
    const ensureCouponPromotion = vi.fn(async () => ok({ stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' }));
    const payment = { createCheckoutSession: async () => ok({ url: 'https://example.test', sessionId: 'session' }), expireCheckoutSession: async () => ok({ expired: true as const }), cancelSubscription: async () => ok({ canceled: true as const, alreadySettled: false }), verifyWebhookEvent: async () => { throw new Error('Unused'); }, test: async () => { throw new Error('Unused'); }, ensureCouponPromotion };
    expect(await materialisePartnerCode('tenant', code, 'PLN', { partners, payment })).toMatchObject({ ok: false, error: { message: 'Coupon cannot be applied' } });
    expect(partners.cacheStripeIds).toHaveBeenCalledWith('tenant', code.id, { stripeCouponId: 'coupon', stripePromotionCodeId: 'promotion' }, code.revision);
  });
});
