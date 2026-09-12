import { z } from 'zod';

import { marketingSignupFormSchema, marketingSignupFormInputSchema, marketingSignupFormUpdateSchema, marketingSignupFormCountersSchema } from '#core/domain/index.js';

const detailSchema = z.object({ form: marketingSignupFormSchema, counters: marketingSignupFormCountersSchema });
export const marketingSignupContracts = {
  listMarketingSignupForms: { input: z.object({}).strict(), output: z.object({ forms: z.array(detailSchema) }) },
  getMarketingSignupForm: { input: z.object({ slug: z.string().min(1) }).strict(), output: detailSchema },
  createMarketingSignupForm: { input: marketingSignupFormInputSchema, output: z.object({ form: marketingSignupFormSchema }) },
  updateMarketingSignupForm: { input: marketingSignupFormUpdateSchema, output: z.object({ form: marketingSignupFormSchema }) },
} as const;
export const MARKETING_SIGNUP_ROUTES = {
  listMarketingSignupForms: { method: 'GET', path: '/api/marketing/forms' },
  createMarketingSignupForm: { method: 'POST', path: '/api/marketing/forms' },
  getMarketingSignupForm: { method: 'GET', path: '/api/marketing/forms/:slug' },
  updateMarketingSignupForm: { method: 'POST', path: '/api/marketing/forms/:slug' },
  submitMarketingSignupForm: { method: 'POST', path: '/api/public/marketing/forms/:slug/submit' },
} as const;
