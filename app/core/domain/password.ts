export const PASSWORD_MIN_LENGTH = 8;

export const passwordMeetsMinimumLength = (password: string): boolean =>
  password.length >= PASSWORD_MIN_LENGTH;
