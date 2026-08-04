import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

export const passwordFixture = (value: string): string =>
  value.padEnd(PASSWORD_MIN_LENGTH, 'x');
