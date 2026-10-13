import { err, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import type { PartnerRepository } from '../partner-ports.js';
import type { Clock, PaymentProvider } from '../ports.js';

export const reconcilePartnerReservations = async (
  tenantId: string,
  codeId: string,
  deps: { partners: PartnerRepository; payment: Pick<PaymentProvider, 'retrieveCheckoutSession'>; clock: Clock },
): Promise<Result<{ codeId: string; checked: number; released: { checkoutSnapshotId: string; sessionId: string }[]; retained: number }, AppError>> => {
  const retrieve = deps.payment.retrieveCheckoutSession;
  if (retrieve === undefined) return err(validation('Checkout reservation reconciliation is unavailable'));
  const reservations = await deps.partners.listCheckoutReservations(tenantId, codeId);
  const releasable: { checkoutSnapshotId: string; sessionId: string }[] = [];
  const released: { checkoutSnapshotId: string; sessionId: string }[] = [];
  let checked = 0;
  for (const reservation of reservations) {
    if (reservation.sessionId === null) continue;
    const session = await retrieve({ tenantId, sessionId: reservation.sessionId, mode: 'live' });
    if (!session.ok) return session;
    checked += 1;
    if (session.value.status !== 'expired' && !(session.value.status === 'complete' && session.value.paymentStatus === 'unpaid')) continue;
    releasable.push({ checkoutSnapshotId: reservation.checkoutSnapshotId, sessionId: reservation.sessionId });
  }
  for (const reservation of releasable) {
    if (await deps.partners.releaseCheckout(tenantId, reservation.checkoutSnapshotId, deps.clock.nowIso())) released.push(reservation);
  }
  return ok({ codeId, checked, released, retained: reservations.length - released.length });
};
