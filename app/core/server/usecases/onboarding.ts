import {
  computeCreatorOnboarding,
  ok,
  type AppError,
  type CreatorOnboarding,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseRepository,
  EffectivePaymentConfig,
  EffectivePaymentConfigReader,
  MemberRepository,
  OnboardingStateRepository,
  ProductPriceRepository,
  ProductRepository,
  TenantSecretRepository,
} from '../ports.js';
import { paymentConfigReader, paymentsReady } from './payment-config.js';

export interface OnboardingDeps {
  products: Pick<ProductRepository, 'listByTenant'>;
  prices: Pick<ProductPriceRepository, 'listActiveByProducts'>;
  courses: Pick<CourseRepository, 'list'>;
  lessons: Pick<CourseLessonRepository, 'list'>;
  members: Pick<MemberRepository, 'listWithProductIds'>;
  tenantSecrets: Pick<TenantSecretRepository, 'findByKey'>;
  paymentConfig?: EffectivePaymentConfigReader | undefined;
  onboardingState: OnboardingStateRepository;
  devEndpoints: { simulatedPayments: boolean };
  clock: Clock;
}

// The workspace step has always counted a stored key alone; an inherited key counts only once its events can be verified.
const livePaymentsConfigured = (config: EffectivePaymentConfig): boolean =>
  config.source === 'workspace' ? config.keyPresent : paymentsReady(config);

export const getCreatorOnboarding = async (
  ctx: Ctx,
  deps: OnboardingDeps,
): Promise<Result<CreatorOnboarding, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:onboarding:read');
  if (!tenant.ok) return tenant;
  const tenantId = tenant.value;

  const [products, courses, lessons, members, livePayments, dismissedAt] = await Promise.all([
    deps.products.listByTenant(tenantId),
    deps.courses.list(tenantId),
    deps.lessons.list(tenantId),
    deps.members.listWithProductIds(tenantId, deps.clock.nowIso()),
    paymentConfigReader(deps.paymentConfig, deps.tenantSecrets).read(tenantId, 'live'),
    deps.onboardingState.findDismissedAt(tenantId),
  ]);
  const activePrices =
    products.length === 0
      ? []
      : await deps.prices.listActiveByProducts(
          tenantId,
          products.map((product) => product.id),
        );

  return ok(
    computeCreatorOnboarding(
      {
        hasCourseWithLesson: courses.length > 0 && lessons.length > 0,
        hasProductWithActivePrice: activePrices.length > 0,
        hasPublishedProduct: products.some((product) => product.published),
        hasMember: members.length > 0,
        paymentsConfigured: deps.devEndpoints.simulatedPayments || livePaymentsConfigured(livePayments),
      },
      dismissedAt !== null,
    ),
  );
};

export const dismissCreatorOnboarding = async (
  ctx: Ctx,
  deps: OnboardingDeps,
): Promise<Result<CreatorOnboarding, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:onboarding:write');
  if (!tenant.ok) return tenant;
  await deps.onboardingState.dismiss(tenant.value, deps.clock.nowIso());
  return getCreatorOnboarding(ctx, deps);
};
