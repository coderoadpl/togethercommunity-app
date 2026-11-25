import {
  appError,
  err,
  internal,
  ok,
  SMOKE_TENANT_ID,
  SMOKE_TENANT_SLUG,
  SmokeTenantReseedRefused,
  stripeModeFromKey,
  type AppError,
  type ErrorCode,
  type Result,
  type WipedTable,
} from '#core/domain/index.js';

import type { Clock, IdGenerator, PlatformAuditRepository, SmokeTenantReseedPort } from '../ports.js';
import { configureStripeSlot, type ConfigureStripeDeps } from './configure-stripe-slot.js';

export interface SmokeTenantTestPaymentsDeps {
  restrictedKey: string;
  configure: ConfigureStripeDeps;
}

export interface SmokeTenantReseedDeps {
  reseed: SmokeTenantReseedPort;
  platformAudit: PlatformAuditRepository;
  environment: string;
  ids: IdGenerator;
  clock: Clock;
  testPayments?: SmokeTenantTestPaymentsDeps;
}

type SmokeTenantTestPaymentsStatus = 'configured' | 'not-configured' | 'failed';

export interface SmokeTenantReseedResult {
  tenantId: string;
  environment: string;
  durationMs: number;
  wiped: WipedTable[];
  testPayments: SmokeTenantTestPaymentsStatus;
}

const OPERATOR_ACTOR = { userId: 'operator-secret', email: 'operator@together.invalid' };

type TestPaymentsOutcome =
  | { status: 'configured' }
  | { status: 'not-configured' }
  | { status: 'failed'; code: ErrorCode };

/**
 * Provider errors may echo the webhook URL or request details, so only the
 * error code leaves this function.
 */
const configureTestPayments = async (
  testPayments: SmokeTenantTestPaymentsDeps | undefined,
): Promise<TestPaymentsOutcome> => {
  if (testPayments === undefined) return { status: 'not-configured' };
  if (stripeModeFromKey(testPayments.restrictedKey) !== 'test') return { status: 'failed', code: 'validation' };
  try {
    const configured = await configureStripeSlot(
      { tenantId: SMOKE_TENANT_ID, tenantSlug: SMOKE_TENANT_SLUG, mode: 'test', restrictedKey: testPayments.restrictedKey },
      testPayments.configure,
    );
    return configured.ok ? { status: 'configured' } : { status: 'failed', code: configured.error.code };
  } catch {
    return { status: 'failed', code: 'internal' };
  }
};

const testPaymentsDetail = (outcome: TestPaymentsOutcome): string | null => {
  if (outcome.status === 'not-configured') return null;
  if (outcome.status === 'configured') return 'test payments configured';
  return `test payments failed: ${outcome.code}`;
};

/**
 * Runs on production by design: the smoke tenant is synthetic, so this path
 * deliberately skips `productionResetRefusal`. The adapter refuses instead when
 * the tenant no longer looks like the seeded fixture.
 */
export const reseedSmokeTenant = async (
  deps: SmokeTenantReseedDeps,
): Promise<Result<SmokeTenantReseedResult, AppError>> => {
  const startedAt = Date.parse(deps.clock.nowIso());
  const audit = (
    status: 'succeeded' | 'failed',
    detail: string | null,
    durationMs: number,
  ): Promise<void> => deps.platformAudit.record({
    id: deps.ids.nextId(),
    action: 'reseed-acme',
    actorUserId: OPERATOR_ACTOR.userId,
    actorEmail: OPERATOR_ACTOR.email,
    environment: deps.environment,
    status,
    detail,
    durationMs,
    createdAt: deps.clock.nowIso(),
  });

  let reseeded: { tenantId: string; wiped: WipedTable[] };
  try {
    reseeded = await deps.reseed.run();
  } catch (error) {
    const durationMs = Math.max(0, Date.parse(deps.clock.nowIso()) - startedAt);
    const message = error instanceof Error ? error.message : String(error);
    await audit('failed', message, durationMs);
    return err(error instanceof SmokeTenantReseedRefused
      ? appError('conflict', message)
      : internal('Smoke tenant reseed failed'));
  }
  const testPayments = await configureTestPayments(deps.testPayments);
  const durationMs = Math.max(0, Date.parse(deps.clock.nowIso()) - startedAt);
  await audit('succeeded', testPaymentsDetail(testPayments), durationMs);
  return ok({
    tenantId: reseeded.tenantId,
    environment: deps.environment,
    durationMs,
    wiped: reseeded.wiped,
    testPayments: testPayments.status,
  });
};
