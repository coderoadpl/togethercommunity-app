import { err, ok, notFound, validation, appError, partnerProgramInputSchema, partnerProgramUpdateSchema, partnerAssignInputSchema, partnerUpdateInputSchema, partnerCodeInputSchema, partnerCodeUpdateSchema, type PartnerCode, type PartnerProgram } from '#core/domain/index.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { PartnerRepository } from '../partner-ports.js';
import type { Clock, CouponRepository, IdGenerator, MemberRepository, OrderDetailRepository, PaymentProvider } from '../ports.js';
import { reconcilePartnerReservations } from './partner-reservations.js';
import type { SalesLinkRepository } from '../sales-link-ports.js';

export interface PartnerManagementDeps {
  partners: PartnerRepository;
  orders: OrderDetailRepository;
  coupons: Pick<CouponRepository, 'findByCode'>;
  members: Pick<MemberRepository, 'findByEmail' | 'findById'>;
  salesLinks: Pick<SalesLinkRepository, 'findById'>;
  payments: Pick<PaymentProvider, 'ensureCouponPromotion' | 'deactivateCouponPromotion' | 'activateCouponPromotion' | 'retrieveCheckoutSession'>;
  ids: IdGenerator;
  clock: Clock;
}


export const listPartnerPrograms = async (ctx: Ctx, deps: PartnerManagementDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'partner:read');
  if (!tenant.ok) return tenant;
  const programs = await Promise.all((await deps.partners.listPrograms(tenant.value)).map(async (program) => {
    const [partners, codes, commissions] = await Promise.all([deps.partners.listPartners(tenant.value, program.id), deps.partners.listCodes(tenant.value, program.id), deps.partners.listCommissions(tenant.value, program.id, deps.clock.nowIso())]);
    const orders = await Promise.all([...new Set(commissions.map((entry) => entry.orderId))].map(async (orderId) => {
      const order = await deps.orders.findById(tenant.value, orderId);
      if (order === null) throw new Error('Commission order was not found');
      return order;
    }));
    const currencyByOrder = new Map(orders.map((order) => [order.id, order.currency]));
    const currencyTotals = [...new Set(orders.map((order) => order.currency))].sort().map((currency) => {
      const sum = (status: string) => commissions.filter((entry) => entry.status === status && currencyByOrder.get(entry.orderId) === currency).reduce((total, entry) => total + entry.amountCents, 0);
      return { currency, pendingCents: sum('pending'), payableCents: sum('payable'), paidCents: sum('paid') };
    });
    return { program, partnerCount: partners.length, codeCount: codes.length, currencyTotals };
  }));
  return ok({ programs });
};
export const getPartnerProgram = async (ctx: Ctx, input: { id: string }, deps: PartnerManagementDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'partner:read');
  if (!tenant.ok) return tenant;
  const program = await deps.partners.findProgram(tenant.value, input.id);
  if (program === null) return err(notFound('Partner program was not found'));
  const partners = await Promise.all((await deps.partners.listPartners(tenant.value, program.id)).map(async (partner) => ({ ...partner, email: (await deps.members.findById(tenant.value, partner.memberId))?.email ?? '' })));
  return ok({ program, partners, codes: await deps.partners.listCodes(tenant.value, program.id), commissions: await deps.partners.listCommissions(tenant.value, program.id, deps.clock.nowIso()) });
};
export const createPartnerProgram = async (ctx: Ctx, input: unknown, deps: PartnerManagementDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'partner:write');
  if (!tenant.ok) return tenant;
  const parsed = partnerProgramInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid partner program', parsed.error.flatten()));
  const saved = await deps.partners.saveProgram(tenant.value, { ...parsed.data, id: deps.ids.nextId(), tenantId: tenant.value, createdAt: deps.clock.nowIso(), revision: 1 }, null);
  return saved.ok ? ok({ program: saved.value }) : saved;
};
export const updatePartnerProgram = async (ctx: Ctx, input: unknown, deps: PartnerManagementDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'partner:write');
  if (!tenant.ok) return tenant;
  const parsed = partnerProgramUpdateSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid partner program', parsed.error.flatten()));
  const existing = await deps.partners.findProgram(tenant.value, parsed.data.id);
  if (existing === null) return err(notFound('Partner program was not found'));
  const codes = await deps.partners.listCodes(tenant.value, existing.id);
  if (codes.some((code) => code.discountPct > parsed.data.commissionPct)) return err(validation('Program commission cannot be lower than an existing code discount'));
  const { expectedRevision, ...fields } = parsed.data;
  const saved = await deps.partners.saveProgram(tenant.value, { ...existing, ...fields, revision: expectedRevision + 1 }, expectedRevision);
  return saved.ok ? ok({ program: saved.value }) : saved;
};
export const assignPartner = async (ctx: Ctx, input: unknown, deps: PartnerManagementDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'partner:write');
  if (!tenant.ok) return tenant;
  const parsed = partnerAssignInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid partner assignment', parsed.error.flatten()));
  const [program, member] = await Promise.all([deps.partners.findProgram(tenant.value, parsed.data.programId), deps.members.findByEmail(tenant.value, parsed.data.email.trim().toLowerCase())]);
  if (program === null || member === null) return err(notFound('Program or member was not found'));
  const saved = await deps.partners.savePartner(tenant.value, { id: deps.ids.nextId(), tenantId: tenant.value, programId: program.id, memberId: member.id, createdAt: deps.clock.nowIso(), status: 'active' });
  return saved.ok ? ok({ partner: saved.value }) : saved;
};
export const updatePartner = async (ctx: Ctx, input: unknown, deps: PartnerManagementDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'partner:write');
  if (!tenant.ok) return tenant;
  const parsed = partnerUpdateInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid partner update', parsed.error.flatten()));
  const partner = await deps.partners.findPartner(tenant.value, parsed.data.id);
  if (partner === null) return err(notFound('Partner was not found'));
  const saved = await deps.partners.savePartner(tenant.value, { ...partner, status: parsed.data.status });
  return saved.ok ? ok({ partner: saved.value }) : saved;
};
const validateCode = async (tenantId: string, code: PartnerCode, program: PartnerProgram, deps: PartnerManagementDeps) => {
  if (code.discountPct > program.commissionPct) return err(validation('Code discount cannot exceed the program commission', { reason: 'discount_exceeds_commission' }));
  if (code.validFrom !== null && code.validTo !== null && Date.parse(code.validFrom) >= Date.parse(code.validTo)) return err(validation('Code expiry must be after its start', { reason: 'invalid_date_range' }));
  const partner = await deps.partners.findPartner(tenantId, code.partnerId);
  if (partner === null || partner.programId !== program.id) return err(validation('Partner must belong to this program', { reason: 'partner_program_mismatch' }));
  if (await deps.coupons.findByCode(tenantId, code.code) !== null) return err(validation('A coupon with this code already exists', { reason: 'coupon_code_taken' }));
  const duplicate = await deps.partners.findCodeByCode(tenantId, code.code);
  if (duplicate !== null && duplicate.id !== code.id) return err(validation('A partner code with this code already exists', { reason: 'partner_code_taken' }));
  for (const id of code.status === 'active' ? code.salesLinkIds : []) {
    const link = await deps.salesLinks.findById(tenantId, id);
    if (link === null) return err(validation('Every offer must belong to this workspace', { reason: 'sales_link_workspace_mismatch' }));
    if (!link.allowsCodes) return err(validation(`Discount codes are disabled for offer: ${link.title}`, { reason: 'sales_link_codes_disabled', salesLinkTitle: link.title }));
  }
  return ok(undefined);
};
const materialiseCode = async (tenantId: string, code: PartnerCode, deps: PartnerManagementDeps) => {
  if (code.status === 'archived' && code.stripePromotionCodeId !== null) {
    if (deps.payments.deactivateCouponPromotion === undefined) return err(validation('Promotion-code deactivation is unavailable'));
    const deactivated = await deps.payments.deactivateCouponPromotion({ tenantId, stripePromotionCodeId: code.stripePromotionCodeId });
    if (!deactivated.ok) return deactivated;
  }
  if (code.discountPct === 0 || code.status === 'archived') return ok(code);
  if (deps.payments.ensureCouponPromotion === undefined) return err(validation('Coupon materialisation is unavailable'));
  const result = await deps.payments.ensureCouponPromotion({ tenantId, couponId: `${code.id}:${code.revision}`, code: code.code, kind: 'percent', value: code.discountPct, currency: 'PLN', recurringDuration: 'first_invoice', stripeCouponId: code.stripeCouponId, stripePromotionCodeId: code.stripePromotionCodeId });
  return result.ok ? ok({ ...code, ...result.value }) : result;
};
export const createPartnerCode = async (ctx: Ctx, input: unknown, deps: PartnerManagementDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'partner:write');
  if (!tenant.ok) return tenant;
  const parsed = partnerCodeInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid partner code', parsed.error.flatten()));
  const program = await deps.partners.findProgram(tenant.value, parsed.data.programId);
  if (program === null) return err(notFound('Partner program was not found'));
  const code: PartnerCode = { ...parsed.data, id: deps.ids.nextId(), tenantId: tenant.value, createdAt: deps.clock.nowIso(), revision: 1, stripeCouponId: null, stripePromotionCodeId: null };
  const valid = await validateCode(tenant.value, code, program, deps);
  if (!valid.ok) return valid;
  const materialised = await materialiseCode(tenant.value, code, deps);
  if (!materialised.ok) return materialised;
  let persisted = false;
  try {
    const saved = await deps.partners.saveCode(tenant.value, materialised.value, null);
    persisted = saved.ok;
    return saved.ok ? ok({ code: saved.value }) : saved;
  } finally {
    if (!persisted && materialised.value.stripePromotionCodeId !== null && deps.payments.deactivateCouponPromotion !== undefined) {
      const cleaned = await deps.payments.deactivateCouponPromotion({ tenantId: tenant.value, stripePromotionCodeId: materialised.value.stripePromotionCodeId });
      if (!cleaned.ok) throw new Error(cleaned.error.message);
    }
  }
};
export const updatePartnerCode = async (ctx: Ctx, input: unknown, deps: PartnerManagementDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'partner:write');
  if (!tenant.ok) return tenant;
  const parsed = partnerCodeUpdateSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid partner code', parsed.error.flatten()));
  const existing = await deps.partners.findCode(tenant.value, parsed.data.id);
  const program = await deps.partners.findProgram(tenant.value, parsed.data.programId);
  if (existing === null || program === null) return err(notFound('Partner code or program was not found'));
  if (existing.programId !== parsed.data.programId || existing.partnerId !== parsed.data.partnerId) return err(validation('An existing code cannot be reassigned', { reason: 'code_reassignment' }));
  const { expectedRevision, ...fields } = parsed.data;
  if (existing.revision !== expectedRevision) return err(appError('conflict', 'Partner code changed; reload before saving'));
  const changedDiscount = existing.discountPct !== fields.discountPct || existing.code !== fields.code || (existing.status === 'archived' && fields.status === 'active');
  const code = { ...existing, ...fields, revision: expectedRevision + 1, ...(changedDiscount ? { stripeCouponId: null, stripePromotionCodeId: null } : {}) };
  const valid = await validateCode(tenant.value, code, program, deps);
  if (!valid.ok) return valid;
  const retiringPromotion = existing.status === 'active' && (changedDiscount || code.status === 'archived') ? existing.stripePromotionCodeId : null;
  if (retiringPromotion !== null && (deps.payments.deactivateCouponPromotion === undefined || deps.payments.activateCouponPromotion === undefined)) return err(validation('Promotion-code lifecycle operations are unavailable'));
  let retired = false;
  let persisted = false;
  let replacementPromotion: string | null = null;
  try {
    if (retiringPromotion !== null && deps.payments.deactivateCouponPromotion !== undefined) {
      const deactivated = await deps.payments.deactivateCouponPromotion({ tenantId: tenant.value, stripePromotionCodeId: retiringPromotion });
      if (!deactivated.ok) return deactivated;
      retired = true;
    }
    const materialised = code.status === 'archived' ? ok(code) : await materialiseCode(tenant.value, code, deps);
    if (!materialised.ok) return materialised;
    replacementPromotion = materialised.value.stripePromotionCodeId;
    const saved = await deps.partners.saveCode(tenant.value, materialised.value, expectedRevision);
    persisted = saved.ok;
    return saved.ok ? ok({ code: saved.value }) : saved;
  } finally {
    if (!persisted) {
      if (replacementPromotion !== null && replacementPromotion !== existing.stripePromotionCodeId && deps.payments.deactivateCouponPromotion !== undefined) {
        const cleaned = await deps.payments.deactivateCouponPromotion({ tenantId: tenant.value, stripePromotionCodeId: replacementPromotion });
        if (!cleaned.ok) throw new Error(cleaned.error.message);
      }
      const current = await deps.partners.findCode(tenant.value, existing.id);
      if (retired && retiringPromotion !== null && current?.status === 'active' && current.stripePromotionCodeId === retiringPromotion && deps.payments.activateCouponPromotion !== undefined) {
        const restored = await deps.payments.activateCouponPromotion({ tenantId: tenant.value, stripePromotionCodeId: retiringPromotion });
        if (!restored.ok) throw new Error(restored.error.message);
        const latest = await deps.partners.findCode(tenant.value, existing.id);
        if ((latest?.status !== 'active' || latest.stripePromotionCodeId !== retiringPromotion) && deps.payments.deactivateCouponPromotion !== undefined) {
          const deactivated = await deps.payments.deactivateCouponPromotion({ tenantId: tenant.value, stripePromotionCodeId: retiringPromotion });
          if (!deactivated.ok) throw new Error(deactivated.error.message);
        }
      }
    }
  }
};

export const reconcilePartnerCodeReservations = async (ctx: Ctx, input: { id: string }, deps: PartnerManagementDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'partner:write');
  if (!tenant.ok) return tenant;
  const code = await deps.partners.findCode(tenant.value, input.id);
  if (code === null) return err(notFound('Partner code was not found'));
  return reconcilePartnerReservations(tenant.value, code.id, { partners: deps.partners, payment: deps.payments, clock: deps.clock });
};
