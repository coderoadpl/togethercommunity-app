import type {
  EmailPort,
  MarketingSesCredentialResolver,
  TenantSecretResolver,
  TenantSesSettingsRepository,
  TransactionalEmailTransportResolver,
} from '@core/server/index.js';

import { createSesEmailPort } from './ses.js';
import { createSmtpEmailPort, type SmtpEmailSettings } from './smtp.js';

const fromLine = (name: string, address: string): string => `${name} <${address}>`;

export const createTenantSesTransactionalResolver = (
  settings: TenantSesSettingsRepository,
  credentials: MarketingSesCredentialResolver,
  emailFor: (input: {
    from: string;
    region: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
    configurationSet: string | null;
  }) => EmailPort = createSesEmailPort,
): TransactionalEmailTransportResolver => ({
  resolve: async (tenantId) => {
    const tenantSettings = await settings.findByTenant(tenantId);
    if (tenantSettings?.identityVerifiedAt === null || tenantSettings === null) return null;
    const resolved = await credentials.resolve(tenantId);
    if (!resolved.ok) return null;
    return emailFor({
      from: fromLine(tenantSettings.fromName, tenantSettings.fromAddress),
      region: resolved.value.region,
      credentials: {
        accessKeyId: resolved.value.accessKeyId,
        secretAccessKey: resolved.value.secretAccessKey,
      },
      configurationSet: tenantSettings.configurationSet,
    });
  },
});

const smtpSettings = async (
  tenantId: string,
  resolver: TenantSecretResolver,
): Promise<Omit<SmtpEmailSettings, 'from'> | null> => {
  const [host, port, user, password, secure] = await Promise.all([
    resolver.resolve(tenantId, 'smtp.host'),
    resolver.resolve(tenantId, 'smtp.port'),
    resolver.resolve(tenantId, 'smtp.user'),
    resolver.resolve(tenantId, 'smtp.password'),
    resolver.resolve(tenantId, 'smtp.secure'),
  ]);
  if (!host.ok || !port.ok || !user.ok || !password.ok || !secure.ok) return null;
  const portNumber = Number(port.value);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) return null;
  if (secure.value !== 'true' && secure.value !== 'false') return null;
  return {
    host: host.value,
    port: portNumber,
    user: user.value,
    password: password.value,
    secure: secure.value === 'true',
  };
};

export const createSmtpTransactionalResolver = (
  settings: TenantSesSettingsRepository,
  secrets: TenantSecretResolver,
  emailFor: (input: SmtpEmailSettings) => EmailPort = createSmtpEmailPort,
): TransactionalEmailTransportResolver => ({
  resolve: async (tenantId) => {
    const [tenantSettings, smtp] = await Promise.all([
      settings.findByTenant(tenantId),
      smtpSettings(tenantId, secrets),
    ]);
    if (tenantSettings === null || smtp === null) return null;
    return emailFor({
      ...smtp,
      from: fromLine(tenantSettings.fromName, tenantSettings.fromAddress),
    });
  },
});
