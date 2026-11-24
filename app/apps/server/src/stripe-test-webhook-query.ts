import type { Env } from './env.js';

const PROTECTION_BYPASS_PARAMETER = 'x-vercel-protection-bypass';

export const stripeTestWebhookQuery = (
  env: Pick<Env, 'APP_ENV' | 'STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS' | 'VERCEL_AUTOMATION_BYPASS_SECRET'>,
): string | null => {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!env.STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS || env.APP_ENV !== 'staging' || secret === undefined) return null;
  return new URLSearchParams({ [PROTECTION_BYPASS_PARAMETER]: secret }).toString();
};
