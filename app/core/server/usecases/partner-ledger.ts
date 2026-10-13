import { commissionForLine, commissionSchema, type CheckoutSnapshot, type Order } from '#core/domain/index.js';
import type { PartnerRepository } from '../partner-ports.js';
import type { IdGenerator } from '../ports.js';

export const recordOrderCommissions = async (
  order: Order,
  partners: Pick<PartnerRepository, 'findCode' | 'findProgram' | 'createCommissions'>,
  ids: IdGenerator,
  input?: { paidAt?: string; terms?: NonNullable<CheckoutSnapshot['partnerTerms']> },
): Promise<void> => {
  if (order.mode === 'test' || order.status !== 'paid' || order.partnerCodeId == null) return;
  const code = await partners.findCode(order.tenantId, order.partnerCodeId);
  if (code === null) throw new Error('Attributed partner code is missing');
  const program = await partners.findProgram(order.tenantId, code.programId);
  if (program === null) throw new Error('Attributed partner program is missing');
  const terms = input?.terms ?? { commissionPct: program.commissionPct, discountPct: code.discountPct, graceDays: program.graceDays };
  const paidAt = input?.paidAt ?? order.createdAt;
  const payableAt = new Date(Date.parse(paidAt) + terms.graceDays * 86_400_000).toISOString();
  const commissions = (order.lines ?? []).filter((line) => line.productType !== 'physical').map((line) => commissionSchema.parse({
    id: ids.nextId(), tenantId: order.tenantId, orderId: order.id,
    orderLineId: `${order.id}:${line.productId}`, programId: program.id,
    partnerId: code.partnerId, partnerCodeId: code.id, baseCents: line.netCents,
    pct: Math.max(0, terms.commissionPct - terms.discountPct),
    amountCents: commissionForLine(line.netCents, terms.commissionPct, terms.discountPct),
    status: 'pending', payableAt, voidedReason: null, payoutId: null, createdAt: paidAt,
  }));
  await partners.createCommissions(order.tenantId, commissions);
};
