import type { AppError, Result } from '#core/domain/index.js';

import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { sendMarketingMessages, type MarketingMessageInput, type MarketingSendResult, type SendDeps } from './marketing-email.js';

export const enqueueMarketingMessages = async (
  ctx: Ctx,
  inputs: MarketingMessageInput[],
  deps: SendDeps,
): Promise<Result<MarketingSendResult[], AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:message:send');
  return tenantId.ok ? sendMarketingMessages(ctx, inputs, deps) : tenantId;
};
