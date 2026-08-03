import { z } from 'zod';

const ONBOARDING_STEP_IDS = [
  'course_with_lesson',
  'product_with_price',
  'published_product',
  'first_member',
  'payments_configured',
] as const;

const onboardingStepIdSchema = z.enum(ONBOARDING_STEP_IDS);

export type OnboardingStepId = z.infer<typeof onboardingStepIdSchema>;

/** Panel route each step deep-links to; a UI hint owned by the domain so all clients agree. */
const ONBOARDING_STEP_TARGETS: Record<OnboardingStepId, string> = {
  course_with_lesson: '/panel/courses',
  product_with_price: '/panel/products',
  published_product: '/panel/products',
  first_member: '/panel/members',
  payments_configured: '/panel/integrations',
};

const onboardingStepSchema = z.object({
  id: onboardingStepIdSchema,
  done: z.boolean(),
  target: z.string(),
});

export const creatorOnboardingSchema = z.object({
  steps: z.array(onboardingStepSchema),
  dismissed: z.boolean(),
});

export type CreatorOnboarding = z.infer<typeof creatorOnboardingSchema>;

/** Facts observed from existing tenant data; onboarding stores nothing except the dismissal. */
export interface OnboardingFacts {
  hasCourseWithLesson: boolean;
  hasProductWithActivePrice: boolean;
  hasPublishedProduct: boolean;
  hasMember: boolean;
  paymentsConfigured: boolean;
}

export const computeCreatorOnboarding = (
  facts: OnboardingFacts,
  dismissed: boolean,
): CreatorOnboarding => {
  const doneById: Record<OnboardingStepId, boolean> = {
    course_with_lesson: facts.hasCourseWithLesson,
    product_with_price: facts.hasProductWithActivePrice,
    published_product: facts.hasPublishedProduct,
    first_member: facts.hasMember,
    payments_configured: facts.paymentsConfigured,
  };
  return {
    steps: ONBOARDING_STEP_IDS.map((id) => ({
      id,
      done: doneById[id],
      target: ONBOARDING_STEP_TARGETS[id],
    })),
    dismissed,
  };
};
