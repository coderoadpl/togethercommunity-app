import {
  shipxErrorDetailsSchema,
  shipxErrorStateSchema,
  shipxRejectionErrorSchema,
  type ErrorCode,
  type ShipxErrorDetails,
  type ShipxErrorState,
} from '#core/domain/index.js';

import { errorCodeOf, errorDetailsOf, localizePanelError } from './errors.js';
import type { Messages } from './messages.js';

const stateMessage = (state: ShipxErrorState, code: ErrorCode | null, t: Messages): string => {
  const failures = t.shipx.failures;
  switch (state.state) {
    case 'pending':
      return state.shipmentId === null ? failures.slow : t.shipx.paymentPending;
    case 'unconfirmed':
      return code === 'conflict' ? failures.unconfirmedNotFound : failures.unconfirmed;
    case 'lost_lock':
      return failures.lostLock;
    case 'lease_held':
      return failures.leaseHeld;
    case 'manual_shipped':
      return failures.manualShipped({ trackingNumber: state.trackingNumber });
    case 'environment_mismatch':
      return failures.environmentMismatch({
        environment: t.shipx.environments[state.environment],
        settingsEnvironment: t.shipx.environments[state.settingsEnvironment],
      });
    case 'organization_mismatch':
      return failures.organizationMismatch;
    case 'setup_missing':
      return t.shipx.unavailableReasons[state.reason];
    case 'receiver_invalid':
      return failures.receiverInvalid[state.field];
  }
};

const rejectionMessage = (details: ShipxErrorDetails, t: Messages): string => {
  const known = shipxRejectionErrorSchema.safeParse(details.error);
  if (known.success) return t.shipx.failures.rejected[known.data];
  return details.status === 401 ? t.shipx.failures.tokenRejected : t.shipx.failures.rejectedStatus({ status: details.status });
};

const vendorDetail = (details: ShipxErrorDetails): string | null => {
  const fields = Object.entries(details.fields).map(([field, keys]) => `${field}: ${keys.join(', ')}`);
  const parts = details.description === null ? fields : [details.description, ...fields];
  return parts.length === 0 ? null : parts.join('; ');
};

export const localizeShipxError = (error: unknown, t: Messages): { message: string; detail: string | null } => {
  const code = errorCodeOf(error);
  const details = errorDetailsOf(error);
  const state = shipxErrorStateSchema.safeParse(details);
  if (state.success) return { message: stateMessage(state.data, code, t), detail: null };
  const rejection = code === 'shipx_rejected' ? shipxErrorDetailsSchema.safeParse(details) : null;
  if (rejection?.success !== true) return { message: localizePanelError(error, t), detail: null };
  return { message: rejectionMessage(rejection.data, t), detail: vendorDetail(rejection.data) };
};
