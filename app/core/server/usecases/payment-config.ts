import { stripeModeFromKey, type PaymentSources, type StripeMode, type TenantSecret, type TenantSecretKey } from '#core/domain/index.js';

import type { EffectivePaymentConfig, EffectivePaymentConfigReader, SecretCrypto, TenantSecretRepository } from '../ports.js';

type WorkspaceSecrets = Pick<TenantSecretRepository, 'findByKey'>;
type KeyDecrypter = Pick<SecretCrypto, 'decrypt'>;

export const STRIPE_KEY_SLOT = {
  live: 'stripe.restrictedKey',
  test: 'stripe.testRestrictedKey',
} as const satisfies Record<StripeMode, TenantSecretKey>;

const STRIPE_WEBHOOK_SECRET_SLOT = {
  live: 'stripe.webhookSecret',
  test: 'stripe.testWebhookSecret',
} as const satisfies Record<StripeMode, TenantSecretKey>;

export const stripeKeyModeOf = (
  stored: Pick<TenantSecret, 'ciphertext' | 'iv' | 'authTag'>,
  crypto: KeyDecrypter | undefined,
): StripeMode | null => {
  const decrypted = crypto?.decrypt(stored);
  return decrypted?.ok === true ? stripeModeFromKey(decrypted.value) : null;
};

export const createWorkspacePaymentConfigReader = (
  secrets: WorkspaceSecrets,
  crypto?: KeyDecrypter,
): EffectivePaymentConfigReader => ({
  read: async (tenantId, mode) => {
    const [key, webhookSecret] = await Promise.all([
      secrets.findByKey(tenantId, STRIPE_KEY_SLOT[mode]),
      secrets.findByKey(tenantId, STRIPE_WEBHOOK_SECRET_SLOT[mode]),
    ]);
    return {
      source: 'workspace',
      keyPresent: key !== null,
      webhookReady: webhookSecret !== null,
      keyMode: key === null ? null : stripeKeyModeOf(key, crypto),
    };
  },
});

export const workspaceSecretsFromRows = (tenantRows: readonly TenantSecret[]): WorkspaceSecrets => ({
  findByKey: async (_tenantId, key) => tenantRows.find((row) => row.key === key) ?? null,
});

// Without the effective reader nothing can be inherited, so the workspace rule is the whole answer.
export const paymentConfigReader = (
  effective: EffectivePaymentConfigReader | undefined,
  workspace: WorkspaceSecrets,
  crypto?: KeyDecrypter,
): EffectivePaymentConfigReader => effective ?? createWorkspacePaymentConfigReader(workspace, crypto);

export const paymentsReady = (config: EffectivePaymentConfig): boolean => config.keyPresent && config.webhookReady;

export const checkoutPaymentsReady = (config: EffectivePaymentConfig, mode: StripeMode): boolean =>
  paymentsReady(config) && (config.keyMode === null || config.keyMode === mode);

// Absent until a group is inherited, so every answer for a workspace without a source row stays byte-identical.
export const paymentSourcesOf = (live: EffectivePaymentConfig, test: EffectivePaymentConfig): PaymentSources | null =>
  live.source === 'workspace' && test.source === 'workspace' ? null : { live: live.source, test: test.source };
