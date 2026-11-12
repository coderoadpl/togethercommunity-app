import {
  err,
  integrationUnavailable,
  ok,
  transactionalSesConfigurationSetName,
  type AppError,
  type Result,
} from '#core/domain/index.js';
import type { SesMarketingCredentials, SesOnboardingControlPlane } from '../ports.js';

export const ensureTransactionalSesConfiguration = async (
  credentials: SesMarketingCredentials,
  settings: { configurationSet: string | null; snsTopicArn: string | null },
  controlPlane: Pick<SesOnboardingControlPlane, 'ensureConfigurationSet' | 'ensureEventDestination'>,
): Promise<Result<string, AppError>> => {
  if (settings.configurationSet === null || settings.snsTopicArn === null) {
    return err(integrationUnavailable('Transactional SES event infrastructure is not configured; complete SES onboarding and retry'));
  }
  const configuration = await controlPlane.ensureConfigurationSet(
    credentials,
    transactionalSesConfigurationSetName(settings.configurationSet),
  );
  if (!configuration.ok) return configuration;
  const destination = await controlPlane.ensureEventDestination(credentials, {
    configurationSet: configuration.value.name,
    topicArn: settings.snsTopicArn,
    engagementTracking: false,
  });
  return destination.ok ? ok(configuration.value.name) : destination;
};
