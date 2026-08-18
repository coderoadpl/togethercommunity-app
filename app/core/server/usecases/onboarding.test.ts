import { describe, expect, it } from 'vitest';

import type {
  Course,
  CourseLesson,
  Identity,
  MemberWithProductIds,
  OnboardingStepId,
  Product,
  ProductPrice,
  StaffRole,
  TenantSecret,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { dismissCreatorOnboarding, getCreatorOnboarding, type OnboardingDeps } from './onboarding.js';

const NOW = '2026-07-01T00:00:00.000Z';

const ctx = (staffRole: StaffRole | null = 'owner', tenantId: string | null = 't1'): Ctx => ({
  identity: {
    userId: 'u1',
    email: 'owner@together.dev',
    name: 'Owner',
    emailVerified: true,
    tenantId,
    tenantSlug: tenantId ? 'acme' : null,
    tenantName: tenantId ? 'Acme' : null,
    staffRole,
    memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  } satisfies Identity,
});

const product = (id: string, published: boolean): Product => ({
  id,
  tenantId: 't1',
  type: 'course',
  slug: id,
  title: `Product ${id}`,
  description: '',
  coverUrl: null,
  priceCents: 9900,
  currency: 'PLN',
  published,
  accessItems: [],
  legacyId: null,
  createdAt: NOW,
});

const price = (id: string, productId: string, active: boolean): ProductPrice => ({
  id,
  tenantId: 't1',
  productId,
  kind: 'one_time',
  interval: null,
  amountCents: 9900,
  currency: 'PLN',
  active,
  createdAt: NOW,
});

const course = (id: string): Course => ({
  id,
  tenantId: 't1',
  name: `Course ${id}`,
  description: '',
  imageUrl: null,
  moduleOrder: [],
  publiclyVisible: false,
  legacyId: null,
  createdAt: NOW,
});

const lesson = (id: string): CourseLesson => ({
  id,
  tenantId: 't1',
  name: `Lesson ${id}`,
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: NOW,
});

const member = (id: string): MemberWithProductIds => ({
  id,
  email: `${id}@together.dev`,
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: NOW,
  deletedAt: null,
    bannedAt: null,
    bannedReason: null,
  productIds: [],
  activeProductIds: [],
});

const stripeSecret = (): TenantSecret => ({
  id: 'secret-1',
  tenantId: 't1',
  key: 'stripe.restrictedKey',
  ciphertext: 'cipher',
  iv: 'iv',
  authTag: 'tag',
  maskedPreview: '••••2345',
  updatedAt: NOW,
});

interface HarnessData {
  products?: Product[];
  prices?: ProductPrice[];
  courses?: Course[];
  lessons?: CourseLesson[];
  members?: MemberWithProductIds[];
  secrets?: TenantSecret[];
  dismissedAt?: string | null;
  simulatedPayments?: boolean;
}

const harness = (data: HarnessData = {}): { deps: OnboardingDeps; dismissals: string[] } => {
  let dismissedAt = data.dismissedAt ?? null;
  const dismissals: string[] = [];
  const deps: OnboardingDeps = {
    products: { listByTenant: async () => data.products ?? [] },
    prices: {
      listActiveByProducts: async (_tenantId, productIds) =>
        (data.prices ?? []).filter((p) => p.active && productIds.includes(p.productId)),
    },
    courses: { list: async () => data.courses ?? [] },
    lessons: { list: async () => data.lessons ?? [] },
    members: { listWithProductIds: async () => data.members ?? [] },
    tenantSecrets: {
      findByKey: async (_tenantId, key) => (data.secrets ?? []).find((s) => s.key === key) ?? null,
    },
    onboardingState: {
      findDismissedAt: async () => dismissedAt,
      dismiss: async (_tenantId, at) => {
        dismissedAt = at;
        dismissals.push(at);
      },
    },
    devEndpoints: { simulatedPayments: data.simulatedPayments ?? false },
    clock: { nowIso: () => NOW },
  };
  return { deps, dismissals };
};

const doneById = (steps: { id: OnboardingStepId; done: boolean }[]): Record<string, boolean> =>
  Object.fromEntries(steps.map((step) => [step.id, step.done]));

describe('getCreatorOnboarding', () => {
  it('reports every step open for an empty tenant', async () => {
    const result = await getCreatorOnboarding(ctx(), harness().deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dismissed).toBe(false);
    expect(result.value.steps).toHaveLength(5);
    expect(result.value.steps.every((step) => !step.done)).toBe(true);
    expect(result.value.steps.map((step) => step.target)).toEqual([
      '/panel/courses/new',
      '/panel/products/new#prices',
      '/panel/products#product-actions',
      '/panel/members#invite-members',
      '/panel/integrations#payments',
    ]);
  });

  it('computes each step from existing tenant data', async () => {
    const { deps } = harness({
      products: [product('p1', false)],
      prices: [price('pr1', 'p1', true)],
      courses: [course('c1')],
      lessons: [lesson('l1')],
    });
    const result = await getCreatorOnboarding(ctx(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(doneById(result.value.steps)).toEqual({
      course_with_lesson: true,
      product_with_price: true,
      published_product: false,
      first_member: false,
      payments_configured: false,
    });
  });

  it('ignores inactive prices and lessonless courses', async () => {
    const { deps } = harness({
      products: [product('p1', false)],
      prices: [price('pr1', 'p1', false)],
      courses: [course('c1')],
    });
    const result = await getCreatorOnboarding(ctx(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(doneById(result.value.steps)).toEqual({
      course_with_lesson: false,
      product_with_price: false,
      published_product: false,
      first_member: false,
      payments_configured: false,
    });
  });

  it('marks everything done for a fully set-up tenant with a Stripe key', async () => {
    const { deps } = harness({
      products: [product('p1', true)],
      prices: [price('pr1', 'p1', true)],
      courses: [course('c1')],
      lessons: [lesson('l1')],
      members: [member('m1')],
      secrets: [stripeSecret()],
    });
    const result = await getCreatorOnboarding(ctx(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.steps.every((step) => step.done)).toBe(true);
  });

  it('treats simulated payments as configured payments', async () => {
    const result = await getCreatorOnboarding(ctx(), harness({ simulatedPayments: true }).deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(doneById(result.value.steps).payments_configured).toBe(true);
  });

  it('rejects non-staff callers', async () => {
    const result = await getCreatorOnboarding(ctx(null), harness().deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('forbidden');
  });

  it('requires a tenant', async () => {
    const result = await getCreatorOnboarding(ctx('owner', null), harness().deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('tenant_not_found');
  });
});

describe('dismissCreatorOnboarding', () => {
  it('stores the dismissal and returns the onboarding as dismissed', async () => {
    const { deps, dismissals } = harness();
    const result = await dismissCreatorOnboarding(ctx(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dismissed).toBe(true);
    expect(dismissals).toEqual([NOW]);

    const readBack = await getCreatorOnboarding(ctx(), deps);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) return;
    expect(readBack.value.dismissed).toBe(true);
  });

  it('rejects non-staff callers without touching state', async () => {
    const { deps, dismissals } = harness();
    const result = await dismissCreatorOnboarding(ctx(null), deps);
    expect(result.ok).toBe(false);
    expect(dismissals).toEqual([]);
  });
});
