import { normalizeEmail } from '#core/domain/index.js';

import type { Auth } from './create-auth.js';

interface ImportedUserInput {
  email: string;
  name: string | null;
}

export interface ImportedUserState {
  userId: string | null;
  userAction: 'create' | 'keep';
}

export interface ImportedUserOutcome {
  userId: string;
  userAction: 'create' | 'keep';
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

export const createImportAuthGateway = (auth: Auth): ImportAuthGateway => {
  const findImportedUser = async (email: string) => {
    const { internalAdapter } = await auth.$context;
    const found = await internalAdapter.findUserByEmail(email);
    if (!found) return null;
    return found.user;
  };

  return {
    inspectImportedUser: async (input) => {
      const email = normalizeEmail(input.email);
      const found = await findImportedUser(email);
      if (!found) {
        return {
          userId: null,
          userAction: 'create',
        };
      }
      return {
        userId: found.id,
        userAction: 'keep',
      };
    },
    ensureImportedUser: async (input) => {
      const email = normalizeEmail(input.email);
      const { internalAdapter } = await auth.$context;
      let found = await findImportedUser(email);
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
          if ((await findImportedUser(email)) === null) throw cause;
        }
        found = await findImportedUser(email);
        if (!found) throw new Error(`User "${email}" is missing right after creation`);
      }
      return { userId: found.id, userAction };
    },
  };
};
