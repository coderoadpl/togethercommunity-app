import type { PaymentSourceReader, TenantSecretResolver, WorkspaceTenantSecretResolver } from '../ports.js';

export const workspaceOnlyPaymentSource: PaymentSourceReader = { read: async () => ({ source: 'workspace' }) };

const workspaceOnlySecretResolver = (resolver: TenantSecretResolver): WorkspaceTenantSecretResolver => ({
  scope: 'workspace',
  resolve: (tenantId, key) => resolver.resolve(tenantId, key),
});

export const withWorkspaceOnlyResolver = <Config extends { resolver: TenantSecretResolver; clientFactory?: (restrictedKey: string) => unknown }>(
  config: Config,
): NoInfer<Config> & { workspaceResolver: WorkspaceTenantSecretResolver } => ({ ...config, workspaceResolver: workspaceOnlySecretResolver(config.resolver) });
