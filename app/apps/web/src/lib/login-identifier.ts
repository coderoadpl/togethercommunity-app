const STORAGE_KEY = 'together-login-identifier';

export const rememberedLoginIdentifier = (): string => {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

export const rememberLoginIdentifier = (identifier: string): void => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, identifier);
  } catch {
    // blocked site data etc. — the identifier just will not be remembered
  }
};

export const forgetLoginIdentifier = (): void => {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // blocked site data etc. — nothing was remembered to begin with
  }
};
