export const PASSWORD_MIN_LENGTH = 15;

export const passwordMeetsMinimumLength = (password: string): boolean =>
  password.length >= PASSWORD_MIN_LENGTH;
