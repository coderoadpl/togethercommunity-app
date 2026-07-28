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
  MemberRepository,
  OnboardingStateRepository,
  ProductPriceRepository,
  ProductRepository,
  TenantSecretRepository,
} from '../ports.js';

export interface OnboardingDeps {
  products: Pick<ProductRepository, 'listByTenant'>;
  prices: Pick<ProductPriceRepository, 'listActiveByProducts'>;
  courses: Pick<CourseRepository, 'list'>;
  lessons: Pick<CourseLessonRepository, 'list'>;
  members: Pick<MemberRepository, 'listWithProductIds'>;
  tenantSecrets: Pick<TenantSecretRepository, 'findByKey'>;
  onboardingState: OnboardingStateRepository;
  devEndpoints: { simulatedPayments: boolean };
  clock: Clock;
}

export const getCreatorOnboarding = async (
  ctx: Ctx,
  deps: OnboardingDeps,
): Promise<Result<CreatorOnboarding, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:onboarding:read');
  if (!tenant.ok) return tenant;
  const tenantId = tenant.value;

  const [products, courses, lessons, members, stripeKey, dismissedAt] = await Promise.all([
    deps.products.listByTenant(tenantId),
    deps.courses.list(tenantId),
    deps.lessons.list(tenantId),
    deps.members.listWithProductIds(tenantId, deps.clock.nowIso()),
    deps.tenantSecrets.findByKey(tenantId, 'stripe.restrictedKey'),
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
        paymentsConfigured: deps.devEndpoints.simulatedPayments || stripeKey !== null,
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
