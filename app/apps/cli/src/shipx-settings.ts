import {
  err,
  ok,
  SHIPX_ENVIRONMENTS,
  SHIPX_SENDING_METHODS,
  validation,
  type AppError,
  type Result,
  type ShipxEnvironment,
  type ShipxSettingsView,
} from '#core/domain/index.js';

import { secretInput } from './secret-input.js';

export const SHIPX_SENDING_METHOD_HELP = `How the sender hands over parcels: ${SHIPX_SENDING_METHODS.join(", ")}`;

export interface ShipxSlotOptions {
  slot?: ShipxEnvironment | undefined;
  organizationId?: string | undefined;
  tokenEnv?: string | undefined;
  tokenStdin?: boolean | undefined;
  clearCredentials?: boolean | undefined;
}

type ShipxSlotPatch = Partial<Record<ShipxEnvironment, { organizationId?: string; token?: string; clearCredentials?: true }>>;

export const shipxSlotPatch = async (options: ShipxSlotOptions): Promise<Result<ShipxSlotPatch, AppError>> => {
  if (options.tokenEnv !== undefined && options.tokenStdin === true) return err(validation('Provide only one of --token-env and --token-stdin'));
  const tokenGiven = options.tokenEnv !== undefined || options.tokenStdin === true;
  const credentialsGiven = options.organizationId !== undefined || tokenGiven || options.clearCredentials === true;
  if (options.slot === undefined) {
    return credentialsGiven ? err(validation('Name the ShipX connection with --slot sandbox or --slot production')) : ok({});
  }
  if (!credentialsGiven) return err(validation('--slot needs --organization-id, --token-env, --token-stdin or --clear-credentials'));
  if (options.clearCredentials === true && (options.organizationId !== undefined || tokenGiven)) {
    return err(validation('Provide either new credentials or --clear-credentials, not both'));
  }
  const token = tokenGiven ? await secretInput(options.tokenEnv, 'ShipX token') : ok(undefined);
  if (!token.ok) return token;
  return ok({ [options.slot]: {
    ...(options.organizationId === undefined ? {} : { organizationId: options.organizationId }),
    ...(token.value === undefined ? {} : { token: token.value }),
    ...(options.clearCredentials === true ? { clearCredentials: true } : {}),
  } });
};

export const shipxSettingsLines = (view: ShipxSettingsView): string => [
  ...SHIPX_ENVIRONMENTS.map((slot) => {
    const connection = view[slot];
    return `${slot}: ${connection.configured ? 'connected' : 'not connected'}, organization id ${connection.organizationId?.maskedPreview ?? '(not set)'}, token ${connection.token?.maskedPreview ?? '(not set)'}`;
  }),
  `sending method: ${view.sendingMethod}`,
  `sender: ${view.sender === null ? '(not set; InPost uses the organization data)' : `${view.sender.name}, ${view.sender.street} ${view.sender.buildingNumber}, ${view.sender.postCode} ${view.sender.city}`}`,
].join('\n');
