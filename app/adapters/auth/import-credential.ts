import { normalizeEmail } from '#core/domain/index.js';

import type { Auth } from './create-auth.js';
import { isLegacyPasswordHash } from './legacy-password.js';

const CREDENTIAL_PROVIDER_ID = 'credential';

export type ImportedCredentialAction = 'create' | 'update' | 'keep' | 'keep-native' | 'none';

export interface ImportedUserInput {
  email: string;
  name: string | null;
  passwordMarker: string | null;
}

export interface ImportedUserState {
  userId: string | null;
  userAction: 'create' | 'keep';
  credentialAction: ImportedCredentialAction;
}

export interface ImportedUserOutcome {
  userId: string;
  userAction: 'create' | 'keep';
  credentialAction: ImportedCredentialAction;
}

export interface ImportAuthGateway {
  inspectImportedUser(input: ImportedUserInput): Promise<ImportedUserState>;
  ensureImportedUser(input: ImportedUserInput): Promise<ImportedUserOutcome>;
}

const importedDisplayName = (input: ImportedUserInput): string => {
  const name = input.name?.trim() ?? '';
  if (name.length > 0) return name;
  return input.email.split('@')[0] ?? input.email;
};

const credentialActionFor = (
  hasCredentialAccount: boolean,
  storedPassword: string | null,
  marker: string | null,
): ImportedCredentialAction => {
  if (marker === null) return 'none';
  if (!hasCredentialAccount) return 'create';
  if (storedPassword === marker) return 'keep';
  if (storedPassword === null || isLegacyPasswordHash(storedPassword)) return 'update';
  return 'keep-native';
};

export const createImportAuthGateway = (auth: Auth): ImportAuthGateway => {
  const findUserWithCredential = async (email: string) => {
    const { internalAdapter } = await auth.$context;
    const found = await internalAdapter.findUserByEmail(email, { includeAccounts: true });
    if (!found) return null;
    const credential =
      found.accounts.find((entry) => entry.providerId === CREDENTIAL_PROVIDER_ID) ?? null;
    return { user: found.user, credential };
  };

  return {
    inspectImportedUser: async (input) => {
      const email = normalizeEmail(input.email);
      const found = await findUserWithCredential(email);
      if (!found) {
        return {
          userId: null,
          userAction: 'create',
          credentialAction: input.passwordMarker === null ? 'none' : 'create',
        };
      }
      return {
        userId: found.user.id,
        userAction: 'keep',
        credentialAction: credentialActionFor(
          found.credential !== null,
          found.credential?.password ?? null,
          input.passwordMarker,
        ),
      };
    },
    ensureImportedUser: async (input) => {
      const email = normalizeEmail(input.email);
      const { internalAdapter } = await auth.$context;
      let found = await findUserWithCredential(email);
      let userAction: 'create' | 'keep' = 'keep';
      if (!found) {
        try {
          await internalAdapter.createUser({
            name: importedDisplayName(input),
            email,
            emailVerified: true,
          });
          userAction = 'create';
        } catch (cause) {
          // A concurrent writer may have won the unique-email race; re-read before failing.
          if ((await findUserWithCredential(email)) === null) throw cause;
        }
        found = await findUserWithCredential(email);
        if (!found) throw new Error(`User "${email}" is missing right after creation`);
      }
      const credentialAction = credentialActionFor(
        found.credential !== null,
        found.credential?.password ?? null,
        input.passwordMarker,
      );
      if (input.passwordMarker !== null && credentialAction === 'create') {
        await internalAdapter.linkAccount({
          userId: found.user.id,
          providerId: CREDENTIAL_PROVIDER_ID,
          accountId: found.user.id,
          password: input.passwordMarker,
        });
      }
      if (input.passwordMarker !== null && credentialAction === 'update') {
        await internalAdapter.updatePassword(found.user.id, input.passwordMarker);
      }
      return { userId: found.user.id, userAction, credentialAction };
    },
  };
};
