import { createHash, timingSafeEqual } from 'node:crypto';

import type { Env } from './env.js';

const PROTECTION_BYPASS_PARAMETER = 'x-vercel-protection-bypass';

const SHA256_HEX = /^[0-9a-f]{64}$/;

const keyDigest = (restrictedKey: string): Buffer => createHash('sha256').update(restrictedKey).digest();

/**
 * The query is a project-wide credential and the endpoint lands in whichever
 * provider account owns the supplied key, so only the one key the deployment
 * names by digest may carry it.
 */
export const stripeTestWebhookQuery = (
  env: Pick<Env, 'APP_ENV' | 'VERCEL_ENV' | 'STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS' | 'STRIPE_TEST_WEBHOOK_BYPASS_KEY_SHA256' | 'VERCEL_AUTOMATION_BYPASS_SECRET'>,
): ((restrictedKey: string) => string | null) | null => {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const digest = env.STRIPE_TEST_WEBHOOK_BYPASS_KEY_SHA256?.toLowerCase();
  if (
    !env.STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS
    || env.APP_ENV !== 'staging'
    || env.VERCEL_ENV === 'production'
    || secret === undefined
    || digest === undefined
    || !SHA256_HEX.test(digest)
  ) return null;
  const allowed = Buffer.from(digest, 'hex');
  const query = new URLSearchParams({ [PROTECTION_BYPASS_PARAMETER]: secret }).toString();
  return (restrictedKey) => (timingSafeEqual(keyDigest(restrictedKey), allowed) ? query : null);
};
