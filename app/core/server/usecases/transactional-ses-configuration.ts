import {
  err,
  integrationUnavailable,
  ok,
  transactionalSesConfigurationSetName,
  TRANSACTIONAL_SES_CONFIGURATION_FAILURE,
  type AppError,
  type Result,
} from '#core/domain/index.js';
import type { SesMarketingCredentials, SesOnboardingControlPlane } from '../ports.js';

export const ensureTransactionalSesConfiguration = async (
  credentials: SesMarketingCredentials,
  settings: { configurationSet: string | null; snsTopicArn: string | null },
  controlPlane: Pick<SesOnboardingControlPlane, 'ensureConfigurationSet' | 'ensureEventDestination'>,
): Promise<Result<string, AppError>> => {
  const failure = (message: string) => err(integrationUnavailable(`${TRANSACTIONAL_SES_CONFIGURATION_FAILURE}${message}`));
  if (settings.configurationSet === null || settings.snsTopicArn === null) {
    return failure('Complete SES onboarding and retry');
  }
  const configuration = await controlPlane.ensureConfigurationSet(
    credentials,
    transactionalSesConfigurationSetName(settings.configurationSet),
  );
  if (!configuration.ok) return failure(configuration.error.message);
  const destination = await controlPlane.ensureEventDestination(credentials, {
    configurationSet: configuration.value.name,
    topicArn: settings.snsTopicArn,
    engagementTracking: false,
  });
  return destination.ok ? ok(configuration.value.name) : failure(destination.error.message);
};
