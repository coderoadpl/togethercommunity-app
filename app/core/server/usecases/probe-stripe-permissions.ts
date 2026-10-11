import {
  err,
  integrationUnavailable,
  ok,
  resolveCheckoutBranding,
  stripeProbePermissionsInputSchema,
  validation,
  type AppError,
  type Result,
  type StripeProbePermissionsInput,
  type StripeProbePermissionsOutput,
} from '#core/domain/index.js';
import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, PaymentProvider, TenantRepository } from '../ports.js';
import { resolveTenantOrigin, type TenantOriginDeps } from '../tenant-url.js';

export interface ProbeStripePermissionsDeps extends TenantOriginDeps {
  payment: PaymentProvider;
  clock: Clock;
  tenants: Pick<TenantRepository, 'findSettings'>;
}

export const probeStripePermissions = async (
  ctx: Ctx,
  input: StripeProbePermissionsInput,
  deps: ProbeStripePermissionsDeps,
): Promise<Result<StripeProbePermissionsOutput, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write');
  if (!tenant.ok) return tenant;
  const parsed = stripeProbePermissionsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid Stripe permission probe', parsed.error.flatten()));
  if (deps.payment.probeStripePermissions === undefined) {
    return err(integrationUnavailable('Stripe permission probing is unavailable'));
  }
  const origin = await resolveTenantOrigin({ id: tenant.value, slug: ctx.identity.tenantSlug }, deps);
  const settings = await deps.tenants.findSettings(tenant.value);
  const checkoutBranding = settings === null ? undefined : resolveCheckoutBranding(settings, origin);
  const checkedAt = deps.clock.nowIso();
  const checks = await deps.payment.probeStripePermissions({
    tenantId: tenant.value, mode: parsed.data.mode, origin,
    ...(checkoutBranding === undefined ? {} : { checkoutBranding }),
  });
  if (!checks.ok) return checks;
  return ok({ mode: parsed.data.mode, checks: checks.value, allOk: checks.value.every((check) => check.status === 'ok'), checkedAt });
};
